import { localDayOf, zonedInstantUtc } from "./time";

/**
 * "As of day N" for tests and the local seed script. TEST AND SEED SUPPORT ONLY: nothing on a production path
 * calls these, and they throw a RangeError on a bad input instead of guessing. Pure: no clock.
 */

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The wall-clock `time` ("HH:mm") on the 1-based local day `day` counted from the day that contains `startedAt` (day 1 is that day). */
function wallClockOfDay(startedAt: Date, day: number, time: string, timeZone: string): Date {
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) throw new RangeError("startedAt is not a valid date");
  if (!Number.isInteger(day) || day < 1) throw new RangeError(`day must be an integer >= 1, got ${day}`);
  const match = WALL_TIME.exec(time);
  if (!match) throw new RangeError(`time must be "HH:mm", got ${JSON.stringify(time)}`);

  const [y, m, d] = localDayOf(startedAt, timeZone).key.split("-").map(Number);
  // Calendar arithmetic on the local date (Date.UTC normalises the overflow), so a 23 h or 25 h day cannot shift it.
  const target = new Date(Date.UTC(y, m - 1, d + day - 1));
  return zonedInstantUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), Number(match[1]), Number(match[2]), timeZone);
}

/**
 * "As of day N": N whole local days have ended since the local day that contains `startedAt`; the result is the
 * wall-clock `time` (default "09:00") of day N+1 in `timeZone`. Day 0 is the first day itself, so
 * countAvailableDays(startedAt, result) is N for a span with no offline day.
 */
export function instantAfterDays(a: { startedAt: Date; days: number; time?: string; timeZone: string }): Date {
  if (!Number.isInteger(a.days) || a.days < 0) throw new RangeError(`days must be an integer >= 0, got ${a.days}`);
  return wallClockOfDay(a.startedAt, a.days + 1, a.time ?? "09:00", a.timeZone);
}

/** The wall-clock `time` of the 1-based day `day` (day 1 is the start day). Used to place meals ("day 3 at 21:30"). */
export function eveningOfDay(a: { startedAt: Date; day: number; time: string; timeZone: string }): Date {
  return wallClockOfDay(a.startedAt, a.day, a.time, a.timeZone);
}
