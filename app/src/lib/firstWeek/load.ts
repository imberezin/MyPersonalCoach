import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIRST_WEEK } from "@/domain/firstWeek";
import { selectFirstExperiment, type ExperimentSelection, type PatternFact } from "@/domain/experiments";
import {
  FIRST_WEEK_LIMITS,
  FIRST_WEEK_SNOOZE,
  NOT_SNOOZED,
  activeSnoozes,
  buildFirstWeekSummary,
  decideFirstWeekStep,
  deriveFirstWeekProgress,
  type FirstWeekProgress,
  type FirstWeekSnoozed,
  type FirstWeekSummary,
} from "@/domain/firstWeekFlow";
import type { OfflinePeriod } from "@/domain/offline";
import { LATE_EVENING } from "@/domain/patterns";
import { localDayOf, resolveTimeZone } from "@/domain/time";
import { loadExperiments, type OpenExperiment } from "@/lib/experiments/repo";
import { parseOfflinePeriodRows } from "@/lib/offline/rows";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadLateEveningSignal, type LateEveningSignal } from "@/lib/patterns/load";

/**
 * The First Week reads, all as the signed-in user (RLS applies, no admin client). Nothing here writes, nothing calls
 * the AI (it imports nothing from the AI layer), and nothing throws: a fact that cannot be read is null / "unknown".
 */

const HOUR_MS = 3_600_000;

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `confirmed_at` rows to dates; a row with an unreadable time is dropped, not guessed. */
function toTimes(rows: unknown[]): Date[] {
  const times: Date[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const at = toDate((row as Record<string, unknown>).confirmed_at);
    if (at) times.push(at);
  }
  return times;
}

interface ProgressInputs {
  startedAt: Date;
  periods: OfflinePeriod[];
  /** The newest FIRST_WEEK.minConfirmedMeals meals. */
  recentMealTimes: Date[];
}

/**
 * The reads behind the counts, in the two stages 3.4 describes: the profile date and the newest meals in parallel,
 * then the offline periods, which need the start date. null = unknown: any error or throw, a missing or invalid
 * `first_week_started_at`, or a periods read that came back truncated (exactly FIRST_WEEK_LIMITS.periodsQuery rows).
 */
async function loadProgressInputs(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  now: Date,
): Promise<ProgressInputs | null> {
  try {
    if (Number.isNaN(now.getTime())) return null;
    const zone = resolveTimeZone(timeZone);

    const [profile, meals] = await Promise.all([
      supabase.from("profiles").select("first_week_started_at").eq("user_id", userId).limit(1),
      supabase
        .from("meal_entries")
        .select("confirmed_at")
        .eq("user_id", userId)
        .order("confirmed_at", { ascending: false })
        .limit(FIRST_WEEK.minConfirmedMeals),
    ]);
    if (profile.error || meals.error) {
      console.error("First Week: loading the progress failed", profile.error?.code ?? meals.error?.code);
      return null;
    }
    if (!Array.isArray(profile.data) || !Array.isArray(meals.data)) return null;
    const startedAt = toDate((profile.data[0] as Record<string, unknown> | undefined)?.first_week_started_at);
    if (startedAt === null) return null;

    // From the START of the first local day, not from `startedAt`: a period that ended earlier on the day onboarding
    // finished still counts against that day.
    const { data, error } = await supabase
      .from("offline_periods")
      .select("type, start_at, end_at")
      .eq("user_id", userId)
      .gt("end_at", localDayOf(startedAt, zone).start.toISOString())
      .lte("start_at", now.toISOString())
      .order("start_at", { ascending: true })
      .limit(FIRST_WEEK_LIMITS.periodsQuery);
    if (error) {
      console.error("First Week: loading the offline periods failed", error.code);
      return null;
    }
    // Exactly the limit back means more may exist: unknown beats a count that could be wrong.
    if (!Array.isArray(data) || data.length >= FIRST_WEEK_LIMITS.periodsQuery) return null;

    return { startedAt, periods: parseOfflinePeriodRows(data), recentMealTimes: toTimes(meals.data) };
  } catch {
    console.error("First Week: loading the progress threw");
    return null;
  }
}

/**
 * Counts for the First Week rules, or null when anything needed could not be read (Home then shows its calm degraded
 * note and nothing else changes). Never throws.
 */
export async function loadFirstWeekProgress(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  now: Date,
): Promise<FirstWeekProgress | null> {
  const inputs = await loadProgressInputs(supabase, userId, timeZone, now);
  if (inputs === null) return null;
  return deriveFirstWeekProgress({ ...inputs, timeZone: resolveTimeZone(timeZone), now });
}

/**
 * Home only. Never throws, never null: any error, throw or garbage row is NOT_SNOOZED (a card coming back is calm; a
 * card hidden by a failed read would be invisible).
 */
export async function loadFirstWeekSnooze(supabase: SupabaseClient, userId: string, now: Date): Promise<FirstWeekSnoozed> {
  try {
    const since = new Date(now.getTime() - FIRST_WEEK_SNOOZE.hours * HOUR_MS).toISOString();
    const { data, error } = await supabase
      .from("events")
      .select("payload, occurred_at")
      .eq("user_id", userId)
      .eq("name", FIRST_WEEK_SNOOZE.event)
      .gt("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(FIRST_WEEK_LIMITS.snoozeQuery);
    if (error || !Array.isArray(data)) {
      if (error) console.error("First Week: loading the snoozes failed", error.code);
      return { ...NOT_SNOOZED };
    }

    const events: { card: unknown; occurredAt: Date }[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) continue;
      const { payload, occurred_at } = row as Record<string, unknown>;
      const occurredAt = toDate(occurred_at);
      if (occurredAt === null) continue;
      const card = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[FIRST_WEEK_SNOOZE.field] : undefined;
      events.push({ card, occurredAt });
    }
    return activeSnoozes({ events, now });
  } catch {
    console.error("First Week: loading the snoozes threw");
    return { ...NOT_SNOOZED };
  }
}

/**
 * The meal times (`confirmed_at`, ascending, at most FIRST_WEEK_LIMITS.acknowledgementHistory) the Saved line is
 * decided from. null = unknown. The caller treats a full page as "history incomplete" (no line).
 */
export async function loadConfirmedMealTimes(supabase: SupabaseClient, userId: string): Promise<Date[] | null> {
  try {
    const { data, error } = await supabase
      .from("meal_entries")
      .select("confirmed_at")
      .eq("user_id", userId)
      .order("confirmed_at", { ascending: true })
      .limit(FIRST_WEEK_LIMITS.acknowledgementHistory);
    if (error) {
      console.error("First Week: loading the meal times failed", error.code);
      return null;
    }
    return Array.isArray(data) ? toTimes(data) : null;
  } catch {
    console.error("First Week: loading the meal times threw");
    return null;
  }
}

export type FirstWeekSummaryLoad =
  /** The context is not ready, or the lifecycle is not FIRST_WEEK. No query was made. */
  | { kind: "not_first_week" }
  /** A read failed. */
  | { kind: "unavailable" }
  /** The rules do not say SUMMARY_READY (right now). */
  | { kind: "not_ready" }
  | {
      kind: "ready";
      reason: "enough_data" | "max_days_reached";
      hadEnoughData: boolean;
      progress: FirstWeekProgress;
      summary: FirstWeekSummary;
      /** The selection the summary was built from, and what the view needs to show the open experiment's text (null unless OFFERED / ACTIVE). */
      experiment: { selection: ExperimentSelection; open: OpenExperiment | null };
      /** Everything the actions need to re-check: the live signal (null = unknown, treated as "no offer"). */
      signal: LateEveningSignal | null;
    };

/**
 * B6, as a READ: it recomputes everything from the live data on every call, never looks at the snoozes (the page and
 * the action work for a snoozed card too), never writes and never calls the AI.
 *
 * Order: not ready / not FIRST_WEEK -> no query at all; the progress reads; the rules; only when they say
 * SUMMARY_READY the (at most 500) earliest meal times, the live late-evening signal and the experiments, in parallel.
 * The signal and the experiments are a bonus: unknown, they only mean "no observation" and "no offer". The person's
 * goals come from `context.row` (already loaded: no extra query).
 */
export async function loadFirstWeekSummary(context: OnboardingContext, now: Date = new Date()): Promise<FirstWeekSummaryLoad> {
  try {
    if (context.kind !== "ready" || context.row.lifecycle_state !== "FIRST_WEEK") return { kind: "not_first_week" };
    const { supabase, userId, row } = context;
    const timeZone = resolveTimeZone(row.timezone);

    const inputs = await loadProgressInputs(supabase, userId, timeZone, now);
    if (inputs === null) return { kind: "unavailable" };
    const progress = deriveFirstWeekProgress({ ...inputs, timeZone, now });
    const step = decideFirstWeekStep(progress);
    if (step.kind !== "SUMMARY_READY") return { kind: "not_ready" };

    const [mealRows, signal, experiments] = await Promise.all([
      readSummaryMealTimes(supabase, userId),
      loadLateEveningSignal(supabase, userId, timeZone, now),
      loadExperiments(supabase, userId),
    ]);
    if (mealRows === null) return { kind: "unavailable" };

    const patterns: PatternFact[] =
      signal === null
        ? []
        : [
            {
              patternId: signal.row?.id ?? null,
              kind: LATE_EVENING.kind,
              view: signal.view,
              feedback: signal.row?.feedback ?? null,
              feedbackAt: signal.row?.feedbackAt ?? null,
            },
          ];
    // Unknown experiments: an open or a recently skipped one may exist, so offering would be a guess. The offer is a
    // bonus; the page still renders and says the plain "no experiment".
    const selection: ExperimentSelection =
      experiments === null
        ? { kind: "NONE", reason: "no_pattern" }
        : selectFirstExperiment({ patterns, experiments: experiments.facts, now });

    const summary = buildFirstWeekSummary({
      timeZone,
      mealTimes: mealRows,
      periods: inputs.periods,
      signals: signal === null ? [] : [{ kind: LATE_EVENING.kind, view: signal.view }],
      experiment: selection,
      // Only whether a numeric goal exists leaves the row; the target itself is never read past this line.
      goal: { focus: row.goal_focus, motivation: row.motivation, numericGoal: row.goal_type === "numeric" && row.goal_weight_kg !== null },
    });

    return {
      kind: "ready",
      reason: step.reason,
      hadEnoughData: step.hadEnoughData,
      progress,
      summary,
      experiment: { selection, open: experiments?.open ?? null },
      signal,
    };
  } catch {
    console.error("First Week: loading the summary threw");
    return { kind: "unavailable" };
  }
}

/** The earliest meal times for the B6 "moment" lines. `confirmed_at` only: the summary shows no counts. */
async function readSummaryMealTimes(supabase: SupabaseClient, userId: string): Promise<Date[] | null> {
  try {
    const { data, error } = await supabase
      .from("meal_entries")
      .select("confirmed_at")
      .eq("user_id", userId)
      .order("confirmed_at", { ascending: true })
      .limit(FIRST_WEEK_LIMITS.summaryMeals);
    if (error) {
      console.error("First Week: loading the summary meals failed", error.code);
      return null;
    }
    return Array.isArray(data) ? toTimes(data) : null;
  } catch {
    console.error("First Week: loading the summary meals threw");
    return null;
  }
}
