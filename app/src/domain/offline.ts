import { localDayOf, type LocalDay } from "./time";

/** SHABBAT is the only type created in Phase 1. HOLIDAY and USER_DEFINED are next; VACATION is a future type. */
export type OfflineType = "SHABBAT" | "HOLIDAY" | "USER_DEFINED" | "VACATION";

export interface OfflinePeriod {
  type: OfflineType;
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** A day is available when less than this share of it is covered by an offline period. */
export const AVAILABLE_DAY_MAX_OFFLINE_FRACTION = 0.5;

/**
 * The single authority on "is this user offline right now?".
 * Notifications, reminders, the Behavior Engine, the reporting UI, streaks, adherence and
 * First Week counting all ask this, so the rule lives in exactly one place.
 */
export function isOffline(periods: readonly OfflinePeriod[], at: Date): boolean {
  const t = at.getTime();
  return periods.some((p) => t >= p.start.getTime() && t < p.end.getTime());
}

/** Share (0 to 1) of [rangeStart, rangeEnd) covered by the union of the offline periods. */
export function offlineFraction(periods: readonly OfflinePeriod[], rangeStart: Date, rangeEnd: Date): number {
  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();
  if (to <= from) return 0;

  const clipped = periods
    .map((p) => [Math.max(p.start.getTime(), from), Math.min(p.end.getTime(), to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let cursor = from;
  for (const [s, e] of clipped) {
    const start = Math.max(s, cursor);
    if (e > start) {
      covered += e - start;
      cursor = e;
    }
  }
  return covered / (to - from);
}

export function isAvailableDay(periods: readonly OfflinePeriod[], day: Pick<LocalDay, "start" | "end">): boolean {
  return offlineFraction(periods, day.start, day.end) < AVAILABLE_DAY_MAX_OFFLINE_FRACTION;
}

/**
 * The most local days one count walks, whatever it finds. `cap` bounds the COUNT, not the walk (a long offline
 * stretch, or a garbage `from` years in the past, would otherwise iterate day by day, each step building several
 * Intl formatters), so beyond this the answer is simply "at least what was counted so far".
 */
export const MAX_SCAN_DAYS = 400;

/**
 * Number of available days, counting whole local days from the day that contains `from`
 * (the day First Week began) up to the last day that has ended before `now`.
 * The day First Week began counts once it has ended. Days that are not yet over do not count.
 * Counting stops once `cap` available days are found (callers that only compare against a threshold pass it),
 * and never walks more than MAX_SCAN_DAYS days.
 */
export function countAvailableDays(
  periods: readonly OfflinePeriod[],
  timeZone: string,
  from: Date,
  now: Date,
  cap: number = Number.POSITIVE_INFINITY,
): number {
  let count = 0;
  let walked = 0;
  let day = localDayOf(from, timeZone);
  while (day.end.getTime() <= now.getTime() && count < cap && walked < MAX_SCAN_DAYS) {
    if (isAvailableDay(periods, day)) count++;
    walked++;
    day = localDayOf(day.end, timeZone);
  }
  return count;
}
