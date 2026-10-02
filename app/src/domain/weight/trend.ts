import { localDayOf, resolveTimeZone } from "../time";
import { WEIGHT_TREND, type WeightEntry } from "./types";

/**
 * The weekly average of what the person reported, and what can honestly be said about it. Weeks are calendar weeks in the
 * profile's zone, computed from the local date key (never 7 x 24 hours), so a DST change cannot move an entry across a week.
 * Pure: no I/O, no clock (every function takes `now`).
 */

const DAY_MS = 86_400_000;

export interface TrendPoint {
  /** Local date key of the week's first day, "YYYY-MM-DD". */
  weekStart: string;
  /** One decimal. */
  averageKg: number;
  entries: number;
  /** The week's start is strictly before the start of the week that contains `now` (the week has ended). Only complete points decide a direction, a plateau, a landmark or the Home moment. */
  complete: boolean;
}

export type TrendDirection = "DOWN" | "STEADY" | "UP";
export type TrendState = "NONE" | "START_ONLY" | "NOT_ENOUGH" | "LINE";

export interface WeightTrend {
  /** NONE: no baseline, no points. START_ONLY: a baseline, no points. NOT_ENOUGH: one point. LINE: two or more (the unfinished week counts as a point here: it is drawn). */
  state: TrendState;
  /** The newest maxChartWeeks of the weekly points, ascending (the chart and the numbers list); the last may be the unfinished week. */
  points: readonly TrendPoint[];
  baselineKg: number | null;
  /** The newest point of any kind. */
  latest: TrendPoint | null;
  /** The newest COMPLETE point: the one "since the start" and every sentence is about. */
  latestComplete: TrendPoint | null;
  /** `latest` is more than staleAfterWeeks weeks before the week of `now`. */
  stale: boolean;
  /** null with fewer than 4 complete points (within directionSpanWeeks of each other), OR when stale, OR when the newest complete point is itself stale (a fresh unfinished week over months-old history). */
  direction: TrendDirection | null;
  /** direction === "STEADY" (which already needs four complete weigh-in weeks). */
  plateau: boolean;
  /** Only state LINE with a baseline and a latestComplete, and neither `latest` nor `latestComplete` stale (an old average is never printed as if current). kg is absolute, one decimal. */
  sinceStart: { kind: "LOWER" | "SAME" | "HIGHER"; kg: number } | null;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function keyOfUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** A "YYYY-MM-DD" key as a UTC date at midnight, or null when it is not a real calendar date. */
function dateOfKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC rolls 2026-02-30 over to March: a real date round-trips.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/** The calendar parts of a "YYYY-MM-DD" key, or null when it is not a real calendar date. */
export function parseDayKey(key: string): { year: number; month: number; day: number } | null {
  const date = dateOfKey(key);
  return date ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() } : null;
}

/** Calendar arithmetic on a date key (no zone, so no DST). An invalid key comes back unchanged. */
export function addDaysToDayKey(key: string, days: number): string {
  const date = dateOfKey(key);
  if (!date) return key;
  return keyOfUtcDate(new Date(date.getTime() + days * DAY_MS));
}

/** The date key of the first day of the week (WEIGHT_TREND.weekStartsOn) that contains a date key. */
export function weekStartOfDayKey(key: string): string {
  const date = dateOfKey(key);
  if (!date) return key;
  const back = (date.getUTCDay() - WEIGHT_TREND.weekStartsOn + 7) % 7;
  return addDaysToDayKey(key, -back);
}

/** Whole calendar days from `a` to `b` (both date keys); 0 when either is not a date. */
function daysBetweenKeys(a: string, b: string): number {
  const da = dateOfKey(a);
  const db = dateOfKey(b);
  return da && db ? Math.round((db.getTime() - da.getTime()) / DAY_MS) : 0;
}

/** Whole weeks from one week start to another (the keys are week starts, so the days divide by 7). */
export function weeksBetween(fromWeekStart: string, toWeekStart: string): number {
  return Math.round(daysBetweenKeys(fromWeekStart, toWeekStart) / 7);
}

const toHundredths = (kg: number): number => Math.round(kg * 100);
const toTenths = (kg: number): number => Math.round(kg * 10);

/**
 * Ascending by week. Groups the entries by calendar week in `timeZone`, computed from the local date key by calendar
 * arithmetic. The mean is taken in integer hundredths and rounded half up to one decimal. Entries after `now`, with an
 * invalid date or a non-finite weight, and repeated ids are ignored. `complete` is derived from `now` here, once, so no
 * other function has to know the clock. It does not slice: the milestone code needs every week.
 */
export function weeklyPoints(entries: readonly WeightEntry[], timeZone: string, now: Date): TrendPoint[] {
  if (Number.isNaN(now.getTime())) return [];
  const tz = resolveTimeZone(timeZone);
  const currentWeek = weekStartOfDayKey(localDayOf(now, tz).key);

  const seen = new Set<string>();
  const weeks = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
    const at = entry.measuredAt instanceof Date ? entry.measuredAt.getTime() : Number.NaN;
    if (!Number.isFinite(entry.weightKg) || Number.isNaN(at) || at > now.getTime()) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const week = weekStartOfDayKey(localDayOf(entry.measuredAt, tz).key);
    const bucket = weeks.get(week) ?? { sum: 0, count: 0 };
    bucket.sum += toHundredths(entry.weightKg);
    bucket.count += 1;
    weeks.set(week, bucket);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStart, { sum, count }]) => ({
      weekStart,
      // Round half up in integer arithmetic: mean hundredths / 10, plus one half.
      averageKg: Math.floor((sum + 5 * count) / (10 * count)) / 10,
      entries: count,
      complete: weekStart < currentWeek,
    }));
}

/**
 * The direction of the weekly average. Looks only at COMPLETE points; the newest WEIGHT_TREND.directionWeeks (4) of them,
 * skipping weeks without a weigh-in (a gap is not a zero: the four are the person's own weigh-in weeks). null with fewer, and
 * null when the four are spread over more than WEIGHT_TREND.directionSpanWeeks weeks (spring weeks and autumn weeks are not
 * "the last weeks").
 * Works in integer tenths: d = (newest + second newest) - (third + fourth), so |d| >= 10 means the two-week means differ by
 * at least directionBandKg (0.5 kg): d <= -10 is DOWN, d >= +10 is UP, anything else STEADY.
 * Why not a slope: with one weigh-in a week each "weekly average" is a single reading, and a least-squares slope over four
 * readings flips between DOWN, STEADY and UP on ordinary scatter of a few tenths of a kilogram, which would fire the UP
 * sentence often and almost never reach STEADY. Comparing two-week means against a 0.5 kg band tolerates that scatter.
 */
export function weeklyDirection(points: readonly TrendPoint[]): TrendDirection | null {
  const complete = points.filter((p) => p.complete).sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  if (complete.length < WEIGHT_TREND.directionWeeks) return null;

  const chosen = complete.slice(-WEIGHT_TREND.directionWeeks);
  if (weeksBetween(chosen[0].weekStart, chosen[chosen.length - 1].weekStart) > WEIGHT_TREND.directionSpanWeeks) return null;

  const [fourth, third, second, newest] = chosen.map((p) => toTenths(p.averageKg));
  const d = newest + second - (third + fourth);
  // The band is on the two-week MEAN; d is a difference of two-week SUMS, so it is twice as large, in tenths.
  const band = Math.round(WEIGHT_TREND.directionBandKg * 2 * 10);
  if (d <= -band) return "DOWN";
  if (d >= band) return "UP";
  return "STEADY";
}

/**
 * The trend object the Progress screen and Weekly Learning read. It reads completeness only from the points' own `complete`
 * flags (and uses `now` only for `stale`), so a caller that slices the points up to an earlier week gets that week's answer.
 */
export function buildWeightTrend(input: {
  points: readonly TrendPoint[];
  baselineKg: number | null;
  timeZone: string;
  now: Date;
}): WeightTrend {
  const baselineKg = input.baselineKg !== null && Number.isFinite(input.baselineKg) ? input.baselineKg : null;
  const all = input.points;
  const latest = all.length > 0 ? all[all.length - 1] : null;
  const latestComplete = [...all].reverse().find((p) => p.complete) ?? null;

  const state: TrendState =
    all.length === 0 ? (baselineKg !== null ? "START_ONLY" : "NONE") : all.length === 1 ? "NOT_ENOUGH" : "LINE";

  let stale = false;
  // The completed history can be old while `latest` is fresh (one reading this week after a long break). Every sentence is
  // about completed weeks, so an old `latestComplete` silences them as well; `stale` and the chart are about `latest` only.
  let completeStale = false;
  if (!Number.isNaN(input.now.getTime())) {
    const currentWeek = weekStartOfDayKey(localDayOf(input.now, resolveTimeZone(input.timeZone)).key);
    if (latest !== null) stale = weeksBetween(latest.weekStart, currentWeek) > WEIGHT_TREND.staleAfterWeeks;
    if (latestComplete !== null) completeStale = weeksBetween(latestComplete.weekStart, currentWeek) > WEIGHT_TREND.staleAfterWeeks;
  }
  const silent = stale || completeStale;

  const direction = silent ? null : weeklyDirection(all);

  let sinceStart: WeightTrend["sinceStart"] = null;
  if (state === "LINE" && baselineKg !== null && latestComplete !== null && !silent) {
    const deltaTenths = toTenths(latestComplete.averageKg) - toTenths(baselineKg);
    const sameBandTenths = Math.round(WEIGHT_TREND.sameBandKg * 10);
    const kind = Math.abs(deltaTenths) < sameBandTenths ? "SAME" : deltaTenths < 0 ? "LOWER" : "HIGHER";
    sinceStart = { kind, kg: Math.abs(deltaTenths) / 10 };
  }

  return {
    state,
    points: all.slice(-WEIGHT_TREND.maxChartWeeks),
    baselineKg,
    latest,
    latestComplete,
    stale,
    direction,
    plateau: direction === "STEADY",
    sinceStart,
  };
}
