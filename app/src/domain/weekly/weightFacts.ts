import { milestoneProgress } from "../weight/milestoneProgress";
import { buildWeightTrend, weeklyPoints } from "../weight/trend";
import type { WeightEntry } from "../weight/types";
import { WEEKLY_FLOW, type WeightLine } from "./types";

/**
 * The weekly weight facts. This item has NO weekly average, NO direction rule and NO milestone test of its own: the Weight
 * item owns them (src/domain/weight) and Progress shows the same numbers. This module only SLICES their output at the
 * summarised week, so the line and the landmark are "as of that week", not "as of now".
 */
export interface WeeklyWeightFacts {
  /** false = the series is unknown or truncated (or the switch is off): no line, no milestone, no invitation. */
  known: boolean;
  line: WeightLine;
  milestone: { index: number; isGoal: boolean } | null;
  /** An entry exists from the WINDOW start to the week's end (and not after `now`). */
  weighedThisWeek: boolean;
  /** The newest entry at or before `now`. */
  lastEntryAt: Date | null;
  /** Start weight known, or any entry exists (the invitation's precondition). */
  hasBaselineOrEntry: boolean;
}

const UNKNOWN: WeeklyWeightFacts = {
  known: false,
  line: { kind: "NONE" },
  milestone: null,
  weighedThisWeek: false,
  lastEntryAt: null,
  hasBaselineOrEntry: false,
};

const isValid = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Pure and total. `entries` is loadWeightSeries' answer (null = the read failed); `truncated` means the history is longer
 * than what was read, so no "reached" and no direction can be claimed.
 *
 * - Points: weeklyPoints over the WHOLE calendar weeks, cut to the weeks up to the summarised one (`upTo`), each point KEEPING
 *   its own `complete` flag, so a weigh-in already made in the NEW week can never colour the summarised week.
 * - weighedThisWeek counts entries from `windowStart` (the window of the story, = week.start except in the first eligible
 *   week, where a weigh-in made before the "Let's continue" press already belongs to the First Week summary). The weekly
 *   AVERAGE still uses the whole calendar week, exactly as Progress shows it.
 * - Line: no counted weigh-in -> NONE. One weekly point -> FIRST. A direction (the Weight item's: it needs four complete
 *   weigh-in weeks and is null when stale) -> DOWN / STEADY / UP exactly as the trend says. Otherwise (two or three points,
 *   or stale) -> BUILDING.
 * - Milestone: only when weighed this week; the step with the HIGHEST index >= 1 whose `confirmedWeekStart` (the SECOND of the
 *   two consecutive complete weekly averages at or below it, the week that made it true) is this week. `reachedWeekStart` is
 *   the first week of the pair and is not used: keyed on it, the celebration would never match.
 */
export function weeklyWeightFacts(input: {
  entries: readonly WeightEntry[] | null;
  truncated: boolean;
  week: { weekStart: string; start: Date; end: Date };
  windowStart: Date;
  timeZone: string;
  now: Date;
  profile: { startWeightKg: number | null; goalWeightKg: number | null; goalType: "numeric" | "behavioral" | "none" };
}): WeeklyWeightFacts {
  const { entries, week, windowStart, now, profile } = input;
  if (!WEEKLY_FLOW.weightLineEnabled || entries === null || input.truncated || !isValid(now)) return UNKNOWN;

  const nowMs = now.getTime();
  const usable = entries.filter((e) => isValid(e.measuredAt) && Number.isFinite(e.weightKg) && e.measuredAt.getTime() <= nowMs);
  const lastEntryAt = usable.reduce<Date | null>((newest, e) => (newest === null || e.measuredAt.getTime() > newest.getTime() ? e.measuredAt : newest), null);
  const weighedThisWeek = usable.some((e) => e.measuredAt.getTime() >= windowStart.getTime() && e.measuredAt.getTime() < week.end.getTime());
  const hasBaselineOrEntry = profile.startWeightKg !== null || entries.length > 0;

  const base: WeeklyWeightFacts = { known: true, line: { kind: "NONE" }, milestone: null, weighedThisWeek, lastEntryAt, hasBaselineOrEntry };
  if (!weighedThisWeek) return base;

  const upTo = weeklyPoints(entries, input.timeZone, now).filter((p) => p.weekStart <= week.weekStart);

  const trend = buildWeightTrend({ points: upTo, baselineKg: profile.startWeightKg, timeZone: input.timeZone, now });
  let line: WeightLine = { kind: "BUILDING" };
  if (trend.state === "NOT_ENOUGH") line = { kind: "FIRST" };
  else if (trend.direction !== null) line = { kind: trend.direction };

  let milestone: WeeklyWeightFacts["milestone"] = null;
  const progress = milestoneProgress({
    startKg: profile.startWeightKg,
    goalKg: profile.goalWeightKg,
    goalType: profile.goalType,
    weeklyPoints: upTo,
    complete: true,
  });
  if (progress.kind === "LIST") {
    const confirmed = progress.steps.filter((s) => s.index >= 1 && s.confirmedWeekStart === week.weekStart);
    const highest = confirmed.reduce<(typeof confirmed)[number] | null>((best, s) => (best === null || s.index > best.index ? s : best), null);
    if (highest) milestone = { index: highest.index, isGoal: highest.kind === "GOAL" };
  }

  return { ...base, line, milestone };
}
