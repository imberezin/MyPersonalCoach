import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_WORDING } from "@/domain/experiments/wording/constants";
import { validateWording, type WordingCheck } from "@/domain/experiments/wording/validate";
import type { OpeningLineKey, OpeningMode } from "@/domain/weekly/types";
import { weeklyLineExtraOk } from "@/domain/weekly/wording/extra";
import { decideWeeklyLineGate, type WeeklyLineGateReason } from "@/domain/weekly/wording/gate";
import type { checkAiAllowance } from "@/lib/ai/allowance";
import type { AiRuntime } from "@/lib/ai/factory";
import type { logAppError } from "@/lib/ai/ledger";
import { WEEKLY_LINE_PURPOSE, assertWeeklyLineFacts } from "@/lib/ai/prompts/weeklyLine";
import type { InsightContext } from "@/lib/ai/types";

export type WeeklyLineFallbackReason =
  | WeeklyLineGateReason
  | "provider_failed"
  | "no_providers"
  | "budget_exhausted"
  | "invalid_output"
  | `rejected_${WordingCheck}`
  /** The weekly-only second check: a weight, body or praise word the approved sentence lacks, or too much changed. */
  | "rejected_weekly_extra";

export type WeeklyLineOutcome =
  | { source: "ai"; text: string; provider: string; model: string }
  /** `text` is byte-equal to the approved sentence the caller passed. */
  | { source: "catalog"; text: string; reason: WeeklyLineFallbackReason };

export interface WeeklyLineDeps {
  runtime: AiRuntime;
  /** The signed-in user's client (row level security applies): it only reads the ai_requests counts. */
  supabase: SupabaseClient;
  userId: string;
  now: Date;
  timeZone: string;
  checkAllowance: typeof checkAiAllowance;
  logError: typeof logAppError;
}

export interface WeeklyLineInput {
  /** The mode of the story. Only LEARN opens the gate; the other modes keep the fixed catalog sentence. */
  mode: OpeningMode;
  /** The key of the story's line. Not sent to a provider: the gate and the stored row use the mode and the key. */
  lineKey: OpeningLineKey;
  /** The catalog sentence of the key in the current locale. Nothing else reaches the prompt. */
  approvedText: string;
  locale: "he" | "en";
  /** The First Week's available days of the week being opened (the same measure as the experiment wording). */
  availableDays: number;
}

/**
 * The orchestrator of the weekly opening line, called by the Server Action behind an explicit press and nowhere else
 * (the only importer of `wordWeeklyLine`). It NEVER throws: ANY failure, at any step (a closed gate, an unreadable
 * allowance, no provider, a timeout, a bad answer, a rejected check), returns the catalog sentence verbatim with the
 * reason, and the person sees the approved text.
 *
 * Order, as `produceExperimentWording`: a pre-check of the gate with a placeholder allowance and an infinite cap (so
 * only the switch, the provider configuration, the mode and the days can close it) -> the allowance read, only if that
 * passed -> the real gate with the real daily cap -> the gateway call (timeouts and budget from AI_WORDING) -> the
 * validator -> the weekly-only extra check (forbidden words, tighter numbers).
 *
 * It logs codes only (area "ai", message "weekly_line_rejected" with the check, or "weekly_line_failed" with the
 * kind): never the candidate and never the approved sentence.
 */
export async function produceWeeklyLineWording(deps: WeeklyLineDeps, input: WeeklyLineInput): Promise<WeeklyLineOutcome> {
  const catalog = (reason: WeeklyLineFallbackReason): WeeklyLineOutcome => ({ source: "catalog", text: input.approvedText, reason });

  try {
    const { runtime } = deps;

    const pre = decideWeeklyLineGate({
      mode: input.mode,
      availableDays: input.availableDays,
      ai: { configured: runtime.configured, dailyCap: Number.POSITIVE_INFINITY, allowance: { allowed: true, usedToday: 0 } },
    });
    if (!pre.open) return catalog(pre.reason);

    const allowance = await readAllowance(deps);
    const gate = decideWeeklyLineGate({
      mode: input.mode,
      availableDays: input.availableDays,
      ai: { configured: runtime.configured, dailyCap: runtime.config.caps.dailyCalls, allowance },
    });
    if (!gate.open) return catalog(gate.reason);

    const context: InsightContext = {
      locale: input.locale,
      facts: {
        purpose: WEEKLY_LINE_PURPOSE,
        approved_text: input.approvedText,
        max_chars: AI_WORDING.maxChars[input.locale],
        tone: "calm",
      },
    };
    // A malformed request is a programming error: refuse it here, before a provider attempt is made and recorded.
    assertWeeklyLineFacts(context);

    const result = await runtime.gateway.wordWeeklyLine(context, {
      timeoutMs: AI_WORDING.attemptTimeoutMs,
      totalBudgetMs: AI_WORDING.totalBudgetMs,
      retries: AI_WORDING.retries,
    });
    if (!result.ok) {
      const reason: WeeklyLineFallbackReason =
        result.reason === "no_providers"
          ? "no_providers"
          : result.reason === "budget_exhausted"
            ? "budget_exhausted"
            : result.attempts.length > 0 && result.attempts.every((attempt) => attempt.error === "invalid_output")
              ? "invalid_output"
              : "provider_failed";
      await report(deps, "weekly_line_failed", { kind: reason });
      return catalog(reason);
    }

    const verdict = validateWording({ candidate: result.value.text, approved: input.approvedText, locale: input.locale });
    if (!verdict.ok) {
      await report(deps, "weekly_line_rejected", { check: verdict.check });
      return catalog(`rejected_${verdict.check}`);
    }
    // The First Week validator has no list for a weight claim, praise or a verdict on the person: the weekly line adds one
    // (and tighter numbers), so that the model can reword the sentence but never say anything new about the person.
    if (!weeklyLineExtraOk({ candidate: verdict.text, approved: input.approvedText })) {
      await report(deps, "weekly_line_rejected", { check: "weekly_extra" });
      return catalog("rejected_weekly_extra");
    }
    return { source: "ai", text: verdict.text, provider: result.provider, model: result.model };
  } catch {
    await report(deps, "weekly_line_failed", { kind: "provider_failed" });
    return catalog("provider_failed");
  }
}

/** The allowance, or `null` (not read) when the read itself throws: the gate then closes with allowance_ledger_unavailable. */
async function readAllowance(deps: WeeklyLineDeps) {
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
async function report(deps: WeeklyLineDeps, message: "weekly_line_rejected" | "weekly_line_failed", context: { check: WordingCheck | "weekly_extra" } | { kind: string }): Promise<void> {
  try {
    await deps.logError({ userId: deps.userId, area: "ai", message, context });
  } catch {
    // The log is best effort.
  }
}
