import type { z } from "zod";
import {
  coachReplySchema,
  insightSchema,
  mealUnderstandingSchema,
  patternCandidatesSchema,
  transcriptSchema,
} from "./schemas";
import type { AIProvider, CoachMessage, InsightContext, MealInput, VoiceInput } from "./types";

export interface Attempt {
  provider: string;
  error: string;
}

export type GatewayResult<T> =
  | { ok: true; value: T; provider: string }
  | { ok: false; reason: "no_providers" | "all_providers_failed"; attempts: Attempt[] };

export interface GatewayOptions {
  /** Per call. Keeps the "Start Report -> Meal Saved" metric honest. */
  timeoutMs?: number;
  /** Extra tries on the same provider when its output fails validation. */
  retriesOnInvalidOutput?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
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

  constructor(
    private readonly providers: readonly AIProvider[],
    options: GatewayOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retriesOnInvalidOutput ?? 1;
  }

  analyzeMeal(input: MealInput) {
    return this.run((p) => p.analyzeMeal(input), mealUnderstandingSchema);
  }

  analyzeText(input: { text: string; locale: MealInput["locale"] }) {
    return this.run((p) => p.analyzeText(input), mealUnderstandingSchema);
  }

  transcribeVoice(input: VoiceInput) {
    return this.run((p) => p.transcribeVoice(input), transcriptSchema);
  }

  generateInsight(context: InsightContext) {
    return this.run((p) => p.generateInsight(context), insightSchema);
  }

  detectPatternCandidate(events: Parameters<AIProvider["detectPatternCandidate"]>[0]) {
    return this.run((p) => p.detectPatternCandidate(events), patternCandidatesSchema);
  }

  coach(messages: readonly CoachMessage[], context: InsightContext) {
    return this.run((p) => p.coach(messages, context), coachReplySchema);
  }

  private async run<S extends z.ZodType>(
    call: (provider: AIProvider) => Promise<unknown>,
    schema: S,
  ): Promise<GatewayResult<z.infer<S>>> {
    const attempts: Attempt[] = [];
    if (this.providers.length === 0) return { ok: false, reason: "no_providers", attempts };

    for (const provider of this.providers) {
      for (let tryNumber = 0; tryNumber <= this.retries; tryNumber++) {
        try {
          const raw = await withTimeout(call(provider), this.timeoutMs);
          const parsed = schema.safeParse(raw);
          if (parsed.success) return { ok: true, value: parsed.data, provider: provider.id };
          attempts.push({ provider: provider.id, error: "invalid_output" });
          // Invalid output: try the same provider again (up to `retries`), then move on.
        } catch (error) {
          attempts.push({ provider: provider.id, error: error instanceof Error ? error.message : "error" });
          break; // A thrown error or timeout: go straight to the next provider.
        }
      }
    }
    return { ok: false, reason: "all_providers_failed", attempts };
  }
}
