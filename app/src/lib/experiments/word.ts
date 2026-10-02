import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_WORDING } from "@/domain/experiments/wording/constants";
import {
  decideWordingGate,
  type PatternLevel,
  type WordingGateReason,
} from "@/domain/experiments/wording/gate";
import { validateWording, type WordingCheck } from "@/domain/experiments/wording/validate";
import type { InterventionKey } from "@/domain/interventions/library";
import type { checkAiAllowance } from "@/lib/ai/allowance";
import type { AiRuntime } from "@/lib/ai/factory";
import type { logAppError } from "@/lib/ai/ledger";
import { assertWordingFacts } from "@/lib/ai/prompts/wording";
import type { InsightContext } from "@/lib/ai/types";

export type WordingFallbackReason =
  | WordingGateReason
  | "provider_failed"
  | "no_providers"
  | "budget_exhausted"
  | "invalid_output"
  | `rejected_${WordingCheck}`;

export type WordingOutcome =
  | { source: "ai"; text: string; provider: string; model: string }
  /** `text` is byte-equal to the approved sentence the caller passed. */
  | { source: "library"; text: string; reason: WordingFallbackReason };

export interface WordingDeps {
  runtime: AiRuntime;
  /** The signed-in user's client (row level security applies): it only reads the ai_requests counts. */
  supabase: SupabaseClient;
  userId: string;
  now: Date;
  timeZone: string;
  checkAllowance: typeof checkAiAllowance;
  logError: typeof logAppError;
}

export interface WordingInput {
  /** The OFFER fields of selectFirstExperiment, structural: this module does not import the experiments domain. */
  offer: { key: InterventionKey; variantId: string; scope: "next_meal" };
  /** The library sentence of the key and variant in the current locale, parameters already substituted. */
  approvedText: string;
  locale: "he" | "en";
  signal: { view: PatternLevel; occurrences: number; distinctDays: number };
  availableDays: number;
}

/**
 * The orchestrator of the wording operation, called by the Server Action behind an explicit press and nowhere else.
 * It NEVER throws: ANY failure, at any step (a closed gate, an unreadable allowance, no provider, a timeout, a bad
 * answer, a rejected check), returns the library sentence verbatim with the reason, and the person sees the approved text.
 *
 * Order: a pre-check of the gate with a placeholder allowance and an infinite cap (so only the switch, the provider
 * configuration, the pattern level, the evenings and the days can close it) -> the allowance read, only if that passed
 * -> the real gate with the real daily cap -> the gateway call (timeouts and budget from AI_WORDING) -> the validator.
 *
 * It logs codes only (area "ai", message "wording_rejected" with the check, or "wording_failed" with the kind): never
 * the candidate and never the approved sentence.
 */
export async function produceExperimentWording(deps: WordingDeps, input: WordingInput): Promise<WordingOutcome> {
  const library = (reason: WordingFallbackReason): WordingOutcome => ({ source: "library", text: input.approvedText, reason });

  try {
    const { runtime } = deps;
    const fact = { view: input.signal.view, occurrences: input.signal.occurrences, distinctDays: input.signal.distinctDays, availableDays: input.availableDays };

    const pre = decideWordingGate({
      ...fact,
      ai: { configured: runtime.configured, dailyCap: Number.POSITIVE_INFINITY, allowance: { allowed: true, usedToday: 0 } },
    });
    if (!pre.open) return library(pre.reason);

    const allowance = await readAllowance(deps);
    const gate = decideWordingGate({
      ...fact,
      ai: { configured: runtime.configured, dailyCap: runtime.config.caps.dailyCalls, allowance },
    });
    if (!gate.open) return library(gate.reason);

    const context: InsightContext = {
      locale: input.locale,
      interventionKey: input.offer.key,
      variantId: input.offer.variantId,
      facts: { approved_text: input.approvedText, scope: input.offer.scope, max_chars: AI_WORDING.maxChars[input.locale], tone: "calm" },
    };
    // A malformed request is a programming error: refuse it here, before a provider attempt is made and recorded.
    assertWordingFacts(context);

    const result = await runtime.gateway.wordExperiment(context, {
      timeoutMs: AI_WORDING.attemptTimeoutMs,
      totalBudgetMs: AI_WORDING.totalBudgetMs,
      retries: AI_WORDING.retries,
    });
    if (!result.ok) {
      const reason: WordingFallbackReason =
        result.reason === "no_providers"
          ? "no_providers"
          : result.reason === "budget_exhausted"
            ? "budget_exhausted"
            : result.attempts.length > 0 && result.attempts.every((attempt) => attempt.error === "invalid_output")
              ? "invalid_output"
              : "provider_failed";
      await report(deps, "wording_failed", { kind: reason });
      return library(reason);
    }

    const verdict = validateWording({ candidate: result.value.text, approved: input.approvedText, locale: input.locale });
    if (!verdict.ok) {
      await report(deps, "wording_rejected", { check: verdict.check });
      return library(`rejected_${verdict.check}`);
    }
    return { source: "ai", text: verdict.text, provider: result.provider, model: result.model };
  } catch {
    await report(deps, "wording_failed", { kind: "provider_failed" });
    return library("provider_failed");
  }
}

/** The allowance, or `null` (not read) when the read itself throws: the gate then closes with allowance_ledger_unavailable. */
async function readAllowance(deps: WordingDeps) {
  try {
    return await deps.checkAllowance(deps.supabase, {
      now: deps.now,
      timeZone: deps.timeZone,
      dailyCap: deps.runtime.config.caps.dailyCalls,
      perMinuteCap: deps.runtime.config.caps.perMinuteCalls,
    });
  } catch {
    return null;
  }
}

/** A short code in `app_errors`. Never throws, and never carries text. */
async function report(deps: WordingDeps, message: "wording_rejected" | "wording_failed", context: { check: WordingCheck } | { kind: string }): Promise<void> {
  try {
    await deps.logError({ userId: deps.userId, area: "ai", message, context });
  } catch {
    // The log is best effort.
  }
}
