import type { z } from "zod";
import {
  coachReplySchema,
  experimentWordingSchema,
  insightSchema,
  mealUnderstandingSchema,
  patternCandidatesSchema,
  transcriptSchema,
  weeklyLineSchema,
} from "./schemas";
import type {
  AIProvider,
  AIRecorder,
  AiCallRecord,
  CallContext,
  CoachMessage,
  InsightContext,
  MealInput,
  ProviderReply,
  VoiceInput,
} from "./types";
import { ProviderError } from "./types";

export interface Attempt {
  provider: string;
  error: string;
}

export type GatewayResult<T> =
  | { ok: true; value: T; provider: string; model: string }
  | { ok: false; reason: "no_providers" | "all_providers_failed" | "budget_exhausted"; attempts: Attempt[] };

export interface GatewayOptions {
  /** Per attempt. Keeps the "Start Report -> Meal Saved" metric honest. */
  timeoutMs?: number;
  /** Extra tries on the same provider when its output fails validation. */
  retriesOnInvalidOutput?: number;
  /** Total time across all attempts of one call. */
  totalBudgetMs?: number;
  /** Told about every provider attempt (the usage ledger). Its failures never change a result. */
  recorder?: AIRecorder;
  /** Injected in tests; only used to measure elapsed time. */
  clock?: () => number;
}

/** Per call override (a photo gets a longer attempt than text). */
export interface CallOptions {
  timeoutMs?: number;
  /** Extra tries on the same provider when its output fails validation; overrides the gateway default for this call. */
  retries?: number;
  /** Total time across all attempts of this call; overrides the gateway default. */
  totalBudgetMs?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_TOTAL_BUDGET_MS = 28_000;
/** An attempt that cannot get at least this long is not started. */
const MIN_ATTEMPT_MS = 2_000;
/** Serverless may freeze right after the response, so the ledger write is awaited, but not for long. */
const RECORDER_CAP_MS = 1_500;

class AttemptTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "AttemptTimeout";
  }
}

/** Rejects with `AttemptTimeout` after `ms` and aborts `controller`, so the provider's fetch does not dangle. */
function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AttemptTimeout());
    }, ms);
  });
  // If the timeout wins, the abort rejection of the provider call must not surface as unhandled.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Provider-neutral entry point to AI. It tries providers in order, validates every answer
 * against a schema, and never throws: a failure becomes `{ ok: false }` so the UI can offer
 * the manual path ("write it instead"), as the product requires.
 */
export class AIGateway {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly totalBudgetMs: number;
  private readonly recorder: AIRecorder | undefined;
  private readonly clock: () => number;

  constructor(
    private readonly providers: readonly AIProvider[],
    options: GatewayOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retriesOnInvalidOutput ?? 1;
    this.totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    this.recorder = options.recorder;
    this.clock = options.clock ?? Date.now;
  }

  analyzeMeal(input: MealInput, options?: CallOptions) {
    // The ledger names the operation by what was sent: with a photo it is analyzeMeal, without one analyzeText.
    return this.run(input.image ? "analyzeMeal" : "analyzeText", (p, ctx) => p.analyzeMeal(input, ctx), mealUnderstandingSchema, options);
  }

  analyzeText(input: { text: string; locale: MealInput["locale"] }, options?: CallOptions) {
    return this.run("analyzeText", (p, ctx) => p.analyzeText(input, ctx), mealUnderstandingSchema, options);
  }

  transcribeVoice(input: VoiceInput, options?: CallOptions) {
    return this.run(null, (p, ctx) => p.transcribeVoice(input, ctx), transcriptSchema, options);
  }

  generateInsight(context: InsightContext, options?: CallOptions) {
    return this.run(null, (p, ctx) => p.generateInsight(context, ctx), insightSchema, options);
  }

  /**
   * Rewords an approved experiment sentence (the wording operation of the First Week build). `context.facts` is the
   * closed shape of prompts/wording.ts. Recorded in the ledger as "wordExperiment", one row per attempt.
   */
  wordExperiment(context: InsightContext, options?: CallOptions) {
    return this.run("wordExperiment", (p, ctx) => p.generateInsight(context, ctx), experimentWordingSchema, options);
  }

  /**
   * Rewords the one approved opening sentence of the weekly story (Weekly Learning, a sibling of `wordExperiment`).
   * `context.facts` is the closed shape of prompts/weeklyLine.ts. Recorded in the ledger as "wordWeeklyLine", one row per attempt.
   */
  wordWeeklyLine(context: InsightContext, options?: CallOptions) {
    return this.run("wordWeeklyLine", (p, ctx) => p.generateInsight(context, ctx), weeklyLineSchema, options);
  }

  detectPatternCandidate(events: Parameters<AIProvider["detectPatternCandidate"]>[0], options?: CallOptions) {
    return this.run(null, (p, ctx) => p.detectPatternCandidate(events, ctx), patternCandidatesSchema, options);
  }

  coach(messages: readonly CoachMessage[], context: InsightContext, options?: CallOptions) {
    return this.run(null, (p, ctx) => p.coach(messages, context, ctx), coachReplySchema, options);
  }

  /** The recorder is called inside try/catch with a cap; whatever happens there never changes the result. */
  private async record(rec: AiCallRecord | null): Promise<void> {
    if (!this.recorder || !rec) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cap = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RECORDER_CAP_MS);
      });
      await Promise.race([Promise.resolve(this.recorder.record(rec)), cap]);
    } catch {
      // A ledger failure must not change the answer the user gets.
    } finally {
      clearTimeout(timer);
    }
  }

  private async run<S extends z.ZodType>(
    operation: AiCallRecord["operation"] | null,
    call: (provider: AIProvider, ctx: CallContext) => Promise<ProviderReply>,
    schema: S,
    options: CallOptions = {},
  ): Promise<GatewayResult<z.infer<S>>> {
    const attempts: Attempt[] = [];
    if (this.providers.length === 0) return { ok: false, reason: "no_providers", attempts };

    const attemptTimeout = options.timeoutMs ?? this.timeoutMs;
    const retries = options.retries ?? this.retries;
    const totalBudgetMs = options.totalBudgetMs ?? this.totalBudgetMs;
    const startedAt = this.clock();
    let budgetExhausted = false;

    // Only the meal operations and the two wording operations are in the ledger; the other operations record nothing.
    const recordOf = (
      provider: AIProvider,
      attemptStart: number,
      outcome: AiCallRecord["outcome"],
      extra: Partial<Pick<AiCallRecord, "model" | "inputTokens" | "outputTokens" | "errorKind">> = {},
    ): AiCallRecord | null =>
      operation === null
        ? null
        : {
            operation,
            provider: provider.id,
            model: null,
            latencyMs: Math.max(0, Math.round(this.clock() - attemptStart)),
            inputTokens: null,
            outputTokens: null,
            errorKind: null,
            outcome,
            ...extra,
          };

    for (const provider of this.providers) {
      for (let tryNumber = 0; tryNumber <= retries; tryNumber++) {
        const remaining = totalBudgetMs - (this.clock() - startedAt);
        if (remaining < MIN_ATTEMPT_MS) {
          budgetExhausted = true;
          break;
        }

        const controller = new AbortController();
        const attemptStart = this.clock();
        let reply: ProviderReply;
        try {
          reply = await withTimeout(call(provider, { signal: controller.signal }), Math.min(attemptTimeout, remaining), controller);
        } catch (error) {
          const timedOut = error instanceof AttemptTimeout;
          const errorKind = error instanceof ProviderError ? error.kind : null;
          attempts.push({ provider: provider.id, error: error instanceof Error ? error.message : "error" });
          await this.record(recordOf(provider, attemptStart, timedOut ? "timeout" : "error", { errorKind }));
          break; // A thrown error or timeout (rate limit, server error, ...): straight to the next provider.
        }

        const usage = { inputTokens: reply.usage?.inputTokens ?? null, outputTokens: reply.usage?.outputTokens ?? null };
        const parsed = schema.safeParse(reply.output);
        if (parsed.success) {
          await this.record(recordOf(provider, attemptStart, "ok", { model: reply.model, ...usage }));
          return { ok: true, value: parsed.data, provider: provider.id, model: reply.model };
        }
        attempts.push({ provider: provider.id, error: "invalid_output" });
        await this.record(recordOf(provider, attemptStart, "invalid_output", { model: reply.model, ...usage }));
        // Invalid output: try the same provider again (up to `retries`), then move on.
      }
      if (budgetExhausted) break;
    }
    return { ok: false, reason: budgetExhausted ? "budget_exhausted" : "all_providers_failed", attempts };
  }
}
