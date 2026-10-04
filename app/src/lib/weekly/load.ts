import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoalFocusKey } from "@/domain/onboarding/model";
import type { OfflinePeriod } from "@/domain/offline";
import { LATE_EVENING } from "@/domain/patterns";
import { DAY_MS, resolveTimeZone } from "@/domain/time";
import {
  WEEKLY_FLOW,
  WEEKLY_LIMITS,
  buildWeeklyStory,
  decideWeeklyExperiment,
  decideWeeklyMoment,
  shiftWeek,
  weeklyWeightFacts,
  type OpeningMode,
  type PatternSignal,
  type StoredWeeklyLine,
  type WeekWindow,
  type WeeklyExperimentDecision,
  type WeeklyMeal,
  type WeeklyMoment,
  type WeeklyStory,
} from "@/domain/weekly";
import { parseOfflinePeriodRows } from "@/lib/offline/rows";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadLateEveningSignal, type LateEveningSignal } from "@/lib/patterns/load";
import { loadWeightSeries } from "@/lib/weight/repo";
import { loadExperimentHistory, type OpenWeeklyExperiment } from "./history";

/**
 * "Your week", as a READ. It recomputes everything from the live data on every call; it never writes, never calls the AI
 * and never throws. Read as the signed-in user (RLS applies, no admin client). A bounded read that came back full
 * (meals, offline periods) is unknown, never guessed; the weight series and the pattern signal are a bonus (unknown, they
 * only mean "no weight line" and "no pattern") while every other failed read makes the whole story `unavailable`.
 */

/** `content.line` of the row, validated. Only a LEARN line is ever stored (section 9), so anything else, or anything malformed, is null. */
export type StoredLine = StoredWeeklyLine;

export type ReadyMoment = Extract<WeeklyMoment, { kind: "READY" }>;

export type WeeklyStoryLoad =
  /** The context is not ready, or the lifecycle is not WEEKLY_CYCLE. No query was made. */
  | { kind: "not_weekly_cycle" }
  /** A read failed, or a bounded read was truncated (meals, periods). */
  | { kind: "unavailable" }
  /** decideWeeklyMoment says NONE (including the switch being off). Nothing was read after the profile and the periods. */
  | { kind: "not_ready" }
  | {
      kind: "ready";
      moment: ReadyMoment;
      story: WeeklyStory;
      experiment: { decision: WeeklyExperimentDecision; open: OpenWeeklyExperiment | null };
      row: { openingMode: OpeningMode; viewedAt: Date | null; line: StoredLine | null } | null;
      /** The First Week's type; null = unknown, treated as "no pattern". */
      signal: LateEveningSignal | null;
      patterns: readonly PatternSignal[];
      goalFocus: readonly GoalFocusKey[];
      availableDays: number;
    };

const OPENING_MODES: readonly OpeningMode[] = ["CELEBRATE", "LEARN", "RECOVER", "RESET"];
/** The longest line the AI path may store (section 9). */
const MAX_LINE_CHARS = 400;

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Rows with no id, an unreadable time or no boolean `aggregated` are dropped, not guessed. */
function toMeals(rows: unknown[]): WeeklyMeal[] {
  const meals: WeeklyMeal[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { id, occurred_at, aggregated } = row as Record<string, unknown>;
    const occurredAt = toDate(occurred_at);
    if (typeof id === "string" && id !== "" && occurredAt !== null && typeof aggregated === "boolean") meals.push({ id, occurredAt, aggregated });
  }
  return meals;
}

/** The stored AI line when `content.line` is exactly what upgradeWeeklyLine writes for a LEARN week; otherwise null. */
function parseStoredLine(content: unknown): StoredLine | null {
  if (typeof content !== "object" || content === null) return null;
  const line = (content as Record<string, unknown>).line;
  if (typeof line !== "object" || line === null) return null;
  const { text, locale, mode, key } = line as Record<string, unknown>;
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_LINE_CHARS) return null;
  if (locale !== "he" && locale !== "en") return null;
  if (mode !== "LEARN" || key !== "learn") return null;
  return { text, locale, mode, key };
}

function parseRow(raw: unknown): { openingMode: OpeningMode; viewedAt: Date | null; line: StoredLine | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { opening_mode, content, viewed_at } = raw as Record<string, unknown>;
  const openingMode = OPENING_MODES.find((m) => m === opening_mode);
  if (openingMode === undefined) return null;
  return { openingMode, viewedAt: toDate(viewed_at), line: parseStoredLine(content) };
}

/**
 * The week the weekly moment would be about at `now`, asked of the domain itself so there is one definition of "the
 * candidate week" (readiness, the three weeks looked at). It is needed before any read, to bound the offline-periods query.
 * With no offline periods and a transition long ago the window always holds seven available days, so the answer is READY
 * whenever the switch is on and `now` is valid.
 */
function candidateWeekOf(now: Date, timeZone: string): WeekWindow | null {
  const moment = decideWeeklyMoment({
    now,
    timeZone,
    lifecycle: "WEEKLY_CYCLE",
    firstWeekEndedAt: new Date(0),
    periods: [],
    aggregatedReportConfirmedAt: null,
  });
  return moment.kind === "READY" ? moment.week : null;
}

/** Stage 1: the transition stamp and the offline periods that overlap the candidate week (and the days before it, for returns). null = unknown. */
async function readMomentInputs(
  supabase: SupabaseClient,
  userId: string,
  week: WeekWindow,
): Promise<{ firstWeekEndedAt: Date | null; periods: OfflinePeriod[] } | null> {
  const periodsFrom = new Date(week.start.getTime() - WEEKLY_LIMITS.periodsLookbackDays * DAY_MS).toISOString();
  const [profile, periods] = await Promise.all([
    supabase.from("profiles").select("first_week_ended_at").eq("user_id", userId).limit(1),
    supabase
      .from("offline_periods")
      .select("type, start_at, end_at")
      .eq("user_id", userId)
      .gt("end_at", periodsFrom)
      .lte("start_at", week.end.toISOString())
      .order("start_at", { ascending: true })
      .limit(WEEKLY_LIMITS.periods),
  ]);
  if (profile.error || periods.error) {
    console.error("Weekly: loading the moment failed", profile.error?.code ?? periods.error?.code ?? "no_code");
    return null;
  }
  if (!Array.isArray(profile.data) || !Array.isArray(periods.data)) return null;
  // Exactly the limit back means more may exist: unknown beats a count of available days that could be wrong.
  if (periods.data.length >= WEEKLY_LIMITS.periods) return null;
  return {
    firstWeekEndedAt: toDate((profile.data[0] as Record<string, unknown> | undefined)?.first_week_ended_at),
    periods: parseOfflinePeriodRows(periods.data),
  };
}

/** Whether some SHABBAT period overlaps the week. The automatic rows run out; after the last one a Saturday would read as an available day. */
function shabbatCovers(periods: readonly OfflinePeriod[], week: WeekWindow): boolean {
  return periods.some((p) => p.type === "SHABBAT" && p.start.getTime() < week.end.getTime() && p.end.getTime() > week.start.getTime());
}

/**
 * Order: not ready / not WEEKLY_CYCLE / switch off -> no query at all. Stage 1: the transition stamp and the offline periods
 * in parallel, then the pure moment: NONE -> `not_ready` with ZERO further reads (no meal, weight or history query).
 * Stage 2, only when READY, in parallel: the week's meals, the last meal before the window, the weight series, the weekly
 * row, the experiment history and the late-evening signal; then the pure facts, the story and the experiment decision (the
 * story's mode feeds it). Never throws, never writes, never calls the AI.
 */
export async function loadWeeklyStory(context: OnboardingContext, now: Date = new Date()): Promise<WeeklyStoryLoad> {
  try {
    if (context.kind !== "ready" || context.row.lifecycle_state !== "WEEKLY_CYCLE") return { kind: "not_weekly_cycle" };
    if (!WEEKLY_FLOW.enabled) return { kind: "not_ready" };
    const { supabase, userId, row: profile } = context;
    const timeZone = resolveTimeZone(profile.timezone);

    const candidate = candidateWeekOf(now, timeZone);
    if (candidate === null) return { kind: "not_ready" };

    const stage1 = await readMomentInputs(supabase, userId, candidate);
    if (stage1 === null) return { kind: "unavailable" };

    const moment = decideWeeklyMoment({
      now,
      timeZone,
      lifecycle: "WEEKLY_CYCLE",
      firstWeekEndedAt: stage1.firstWeekEndedAt,
      periods: stage1.periods,
      aggregatedReportConfirmedAt: null,
    });
    if (moment.kind !== "READY") return { kind: "not_ready" };
    const { week, window } = moment;

    const [meals, lastBefore, series, weeklyRow, history, signal] = await Promise.all([
      supabase
        .from("meal_entries")
        .select("id, occurred_at, aggregated")
        .eq("user_id", userId)
        .gte("occurred_at", window.start.toISOString())
        .lt("occurred_at", week.end.toISOString())
        .order("occurred_at", { ascending: true })
        .limit(WEEKLY_LIMITS.meals),
      supabase
        .from("meal_entries")
        .select("occurred_at")
        .eq("user_id", userId)
        .eq("aggregated", false)
        .lt("occurred_at", window.start.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(1),
      loadWeightSeries(supabase, userId),
      supabase.from("weekly_summaries").select("opening_mode, content, viewed_at").eq("user_id", userId).eq("week_start", week.weekStart).limit(1),
      loadExperimentHistory(supabase, userId),
      loadLateEveningSignal(supabase, userId, timeZone, now),
    ]);

    if (meals.error || lastBefore.error || weeklyRow.error) {
      console.error("Weekly: loading the story failed", meals.error?.code ?? lastBefore.error?.code ?? weeklyRow.error?.code ?? "no_code");
      return { kind: "unavailable" };
    }
    if (!Array.isArray(meals.data) || !Array.isArray(lastBefore.data) || !Array.isArray(weeklyRow.data) || history === null) {
      return { kind: "unavailable" };
    }
    // Exactly the limit back means more may exist: unknown beats a story built from some of the week.
    if (meals.data.length >= WEEKLY_LIMITS.meals) return { kind: "unavailable" };

    const lastMealBefore = toDate((lastBefore.data[0] as Record<string, unknown> | undefined)?.occurred_at);
    const periodsComplete = !profile.observes_shabbat || shabbatCovers(stage1.periods, week);
    const weight = weeklyWeightFacts({
      entries: series === null ? null : series.entries,
      truncated: series === null ? false : series.truncated,
      week: { weekStart: week.weekStart, start: week.start, end: week.end },
      windowStart: window.start,
      timeZone,
      now,
      profile: { startWeightKg: profile.start_weight_kg, goalWeightKg: profile.goal_weight_kg, goalType: profile.goal_type },
    });
    const patterns: PatternSignal[] =
      signal === null
        ? []
        : [
            {
              kind: LATE_EVENING.kind,
              patternId: signal.row?.id ?? null,
              view: signal.view,
              feedback: signal.row?.feedback ?? null,
              feedbackAt: signal.row?.feedbackAt ?? null,
            },
          ];

    const story = buildWeeklyStory({
      now,
      timeZone,
      window,
      week: { start: week.start, end: week.end },
      answerWindow: { start: week.end, end: shiftWeek(week, 1, timeZone).end },
      periods: stage1.periods,
      periodsComplete,
      meals: toMeals(meals.data),
      lastMealBefore,
      weight,
      signals: patterns,
      experiments: history.records,
    });
    const decision = decideWeeklyExperiment({ now, mode: story.mode, patterns, history: history.records, goalFocus: profile.goal_focus });

    return {
      kind: "ready",
      moment,
      story,
      experiment: { decision, open: history.open },
      row: weeklyRow.data.length > 0 ? parseRow(weeklyRow.data[0]) : null,
      signal,
      patterns,
      goalFocus: profile.goal_focus,
      availableDays: moment.availableDays,
    };
  } catch {
    console.error("Weekly: loading the story threw");
    return { kind: "unavailable" };
  }
}
