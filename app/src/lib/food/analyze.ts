import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FOOD_ROUTES,
  parseManualFoods,
  proposeMeal,
  type AnalyzeFailure,
  type AnalyzeFields,
  type AnalyzeResponse,
  type ReportMode,
  type UnderstoodItem,
} from "@/domain/food";
import { isOffline } from "@/domain/offline";
import type { AnalyticsEventName, EventPayload } from "@/lib/analytics/events";
import type { checkAiAllowance } from "@/lib/ai/allowance";
import type { AiRuntime } from "@/lib/ai/factory";
import type { logAppError } from "@/lib/ai/ledger";
import type { loadOfflinePeriods } from "@/lib/home/load";
import type { Locale } from "@/i18n/config";
import type { createUnderstanding, findByRequestId } from "./repo";

export interface AnalyzeInput {
  fields: AnalyzeFields;
  image: { bytes: Uint8Array; type: "jpeg" } | null;
}

export interface AnalyzeDeps {
  supabase: SupabaseClient;
  userId: string;
  timeZone: string;
  now: Date;
  /** It only fills `MealInput.locale`; the prompt itself stays Hebrew. */
  locale: Locale;
  /** The gateway is already wired to this user's recorder. */
  runtime: AiRuntime;
  loadOfflinePeriods: typeof loadOfflinePeriods;
  allowance: typeof checkAiAllowance;
  repo: { createUnderstanding: typeof createUnderstanding; findByRequestId: typeof findByRequestId };
  track: (name: AnalyticsEventName, payload: EventPayload) => Promise<void>;
  logError: typeof logAppError;
}

const fail = (reason: AnalyzeFailure): AnalyzeResponse => ({ ok: false, reason });

/**
 * The one long call behind `POST /api/food/analyze`, as a function the route is a thin shell around.
 * The order of the checks is the contract (blueprint 6.2): a retry of a report that already exists is
 * answered first and for free; then the quiet rule; then the start event; then the manual path (no AI,
 * no quota); then the AI path (configured, allowance, gateway); then the write.
 *
 * Every dependency is injected, so the order is testable with spies. A failure of the event sink or the
 * ledger never changes the answer, and nothing the user wrote is logged or put in an event.
 */
export async function runFoodAnalysis(deps: AnalyzeDeps, input: AnalyzeInput): Promise<AnalyzeResponse> {
  const { fields, image } = input;

  // 1. Shape: a photo report needs its picture; a written one must not carry one.
  if (fields.mode === "photo" ? image === null : image !== null) return fail("invalid_input");

  // 2. A repeat of a request that already produced a report. No event, no ledger row, no allowance
  //    read, no provider call; and before the quiet rule, because finishing an earlier report is never blocked.
  const existing = await deps.repo.findByRequestId(deps.supabase, fields.requestId);
  if (existing) return { ok: true, id: existing.id, redirectTo: FOOD_ROUTES.confirm(existing.id) };

  // 3. Shabbat or any other offline period. Unknown periods (a failed read) are not quiet: the read fails open.
  const periods = await deps.loadOfflinePeriods(deps.supabase, deps.userId, deps.now);
  if (periods && isOffline(periods, deps.now)) return fail("quiet_time");

  // 4. The "Start Report -> Meal Saved" clock starts here. The promise runs beside the real work and is
  //    awaited at the end, so it adds no latency before the provider call.
  const started = safely(() => deps.track("meal_report_started", { mode: fields.mode, composed_ms: fields.composedMs }));
  let result: AnalyzeResponse;
  try {
    result = await analyze(deps, fields, image);
  } finally {
    await started;
  }

  // 10. Every outcome that is not ok, except bad input (which is the caller's mistake, not a fallback).
  if (!result.ok) await safely(() => deps.track("meal_ai_fallback", { reason: result.reason, mode: fields.mode }));
  return result;
}

/** Steps 5 to 9. */
async function analyze(deps: AnalyzeDeps, fields: AnalyzeFields, image: AnalyzeInput["image"]): Promise<AnalyzeResponse> {
  const { mode } = fields;
  const kind: ReportMode = mode === "photo" ? "photo" : "text";
  const note = fields.text === "" ? null : fields.text;
  const ctx = { now: deps.now, timeZone: deps.timeZone };

  const store = async (understanding: {
    provider: string;
    model: string | null;
    promptVersion: string | null;
    items: UnderstoodItem[];
    unclear: string[];
    overallConfidence: number | null;
    hints: Parameters<typeof proposeMeal>[0];
  }): Promise<AnalyzeResponse> => {
    const created = await deps.repo.createUnderstanding(deps.supabase, {
      requestId: fields.requestId,
      kind,
      text: note,
      provider: understanding.provider,
      model: understanding.model,
      promptVersion: understanding.promptVersion,
      items: understanding.items,
      unclear: understanding.unclear,
      overallConfidence: understanding.overallConfidence,
      proposed: proposeMeal(understanding.hints, ctx),
    });
    if (!created.ok) {
      // A code only: the text, the foods and the provider's words never go to the log.
      await deps.logError({ userId: deps.userId, area: "food", message: "save_error", context: { mode, code: created.code } });
      return fail("save_error");
    }
    return { ok: true, id: created.value.id, redirectTo: FOOD_ROUTES.confirm(created.value.id) };
  };

  // 5. Manual: the user's own words as a list. No AI, no quota, never capped.
  if (mode === "manual") {
    const { items } = parseManualFoods(fields.text);
    if (items.length === 0) return fail("nothing_found");
    return store({
      provider: "manual",
      model: null,
      promptVersion: null,
      items,
      unclear: [],
      overallConfidence: null,
      hints: { mealTypeHint: null, timeHint: null },
    });
  }

  // 6. No provider can run, or the ledger cannot work (the admin key is missing).
  if (!deps.runtime.configured) return fail("ai_unavailable");

  // 7. The per-user allowance, read from the ledger. Fail closed.
  const { caps } = deps.runtime.config;
  const allowance = await deps.allowance(deps.supabase, {
    now: deps.now,
    timeZone: deps.timeZone,
    dailyCap: caps.dailyCalls,
    perMinuteCap: caps.perMinuteCalls,
  });
  if (!allowance.allowed) return fail(allowance.reason === "ledger_unavailable" ? "ai_unavailable" : allowance.reason);

  // 8. The provider call. A photo gets the longer attempt.
  const { timeoutsMs } = deps.runtime.config;
  const answer = await deps.runtime.gateway.analyzeMeal(
    {
      image: image ? { bytes: image.bytes, mime: "image/jpeg" } : undefined,
      text: note ?? undefined,
      locale: deps.locale,
    },
    { timeoutMs: image ? timeoutsMs.photo : timeoutsMs.text },
  );
  if (!answer.ok) return fail(answer.reason === "no_providers" ? "ai_unavailable" : "ai_error");

  // Valid, but nothing to confirm: the input was not about food, or no food could be made out.
  const { value } = answer;
  if (value.notFood || value.items.length === 0) return fail("nothing_found");

  // 9. Hints become an instant and a meal type in code; the RPC still de-duplicates a concurrent twin by requestId.
  return store({
    provider: answer.provider,
    model: answer.model,
    promptVersion: deps.runtime.promptVersion,
    items: value.items,
    unclear: value.unclear,
    overallConfidence: value.overallConfidence,
    hints: { mealTypeHint: value.mealTypeHint, timeHint: value.timeHint },
  });
}

/** Analytics and the ledger are best effort: whatever they do, the user's answer stands. */
async function safely(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch {
    // never throws into the flow
  }
}
