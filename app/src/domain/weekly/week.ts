import { localDayOf, resolveTimeZone, zonedMidnightUtc, type LocalDay } from "../time";
import { addDaysToDayKey, parseDayKey } from "../weight/trend";

export interface WeekWindow {
  /** "YYYY-MM-DD", the LOCAL Sunday. Equals weekly_summaries.week_start. */
  weekStart: string;
  /** Local Sunday 00:00. */
  start: Date;
  /** The next local Sunday 00:00 (exclusive); 167, 168 or 169 hours later. */
  end: Date;
  /** The 7 local days: days[0].key === weekStart, days[6] is Saturday. */
  days: readonly LocalDay[];
}

/** The window of the week that starts on the local Sunday `weekStart` (a date key). Built day by day through zonedMidnightUtc, never `n * DAY_MS`. */
function windowFromSunday(weekStart: string, timeZone: string): WeekWindow {
  const days: LocalDay[] = [];
  for (let i = 0; i < 7; i++) {
    const parts = parseDayKey(addDaysToDayKey(weekStart, i));
    // weekStart always comes from a real local date key, so this cannot be null; the guard keeps the function total.
    if (!parts) throw new RangeError(`not a date key: ${weekStart}`);
    days.push(localDayOf(zonedMidnightUtc(parts.year, parts.month, parts.day, timeZone), timeZone));
  }
  return { weekStart, start: days[0].start, end: days[6].end, days };
}

/**
 * The week containing `instant`, Sunday to Saturday in the profile's zone. Day arithmetic goes through localDayOf and
 * zonedMidnightUtc, never `n * DAY_MS`, so a DST week is 167 or 169 hours and still seven days. A garbage zone is
 * Asia/Jerusalem (resolveTimeZone). An invalid instant throws a RangeError: callers validate `now` first (the moment
 * function answers NONE invalid_input).
 */
export function weekWindowOf(instant: Date, timeZone: string): WeekWindow {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) throw new RangeError("invalid instant");
  const tz = resolveTimeZone(timeZone);
  const key = localDayOf(instant, tz).key;
  // The local weekday of a day is the weekday of its calendar date (0 is Sunday).
  const parts = parseDayKey(key);
  if (!parts) throw new RangeError(`not a date key: ${key}`);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return windowFromSunday(addDaysToDayKey(key, -weekday), tz);
}

/** `weeks` may be negative: -1 is the previous week. Built from the date of `week.start`, so DST weeks stay whole. */
export function shiftWeek(week: WeekWindow, weeks: number, timeZone: string): WeekWindow {
  const whole = Number.isFinite(weeks) ? Math.trunc(weeks) : 0;
  return windowFromSunday(addDaysToDayKey(week.weekStart, whole * 7), resolveTimeZone(timeZone));
}
