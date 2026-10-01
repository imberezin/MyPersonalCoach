/**
 * When a meal happened. The AI never computes a date or a time of record: it returns hints
 * ("yesterday", "08:30") and this module resolves them to an instant in the user's time zone.
 * Pure, never throws.
 */
import { resolveTimeZone } from "../home/resolve";
import { localDayOf, localMinuteOfDay, zonedInstantUtc } from "../time";
import { MEAL_TYPE_DEFAULT_MINUTE, inferMealType } from "./mealType";
import { formatLocalTime, parseLocalTime } from "./portion";
import type { MealType, TimeHint } from "./types";

/** 5 minutes ahead (clocks differ a little), 48 hours back. */
export const OCCURRED_AT_LIMITS = { maxFutureMs: 300_000, maxPastMs: 172_800_000 } as const;

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** The calendar date ("YYYY-MM-DD" key of localDayOf) of the local day containing `instant`, shifted by whole days. */
function localDate(instant: Date, timeZone: string, shiftDays: number): CalendarDay {
  const [year, month, day] = localDayOf(instant, timeZone).key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + shiftDays));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function atWallClock(date: CalendarDay, minuteOfDay: number, timeZone: string): Date {
  return zonedInstantUtc(date.year, date.month, date.day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, timeZone);
}

/**
 * The AI gave hints, not instants. Rules: day = timeHint.day ?? today. With a clock time: that
 * wall-clock time on that local day (zonedInstantUtc); if day is today and that instant is more than
 * maxFutureMs after `now` (nobody ate in the future) it moves to yesterday. Without a clock time:
 * today -> now; yesterday -> yesterday at MEAL_TYPE_DEFAULT_MINUTE[type] (type = mealTypeHint ?? "other").
 * mealType = mealTypeHint ?? inferMealType(localMinuteOfDay(occurredAt)). Never throws; an invalid zone
 * falls back through resolveTimeZone.
 */
export function proposeMeal(
  hints: { mealTypeHint: MealType | null; timeHint: TimeHint | null },
  ctx: { now: Date; timeZone: string },
): { mealType: MealType; occurredAt: Date } {
  const timeZone = resolveTimeZone(ctx.timeZone);
  const { now } = ctx;
  const day = hints.timeHint?.day ?? "today";
  const clock = hints.timeHint?.minuteOfDay ?? null;

  let occurredAt: Date;
  if (clock !== null) {
    occurredAt = atWallClock(localDate(now, timeZone, day === "yesterday" ? -1 : 0), clock, timeZone);
    if (day === "today" && occurredAt.getTime() - now.getTime() > OCCURRED_AT_LIMITS.maxFutureMs) {
      occurredAt = atWallClock(localDate(now, timeZone, -1), clock, timeZone);
    }
  } else if (day === "yesterday") {
    occurredAt = atWallClock(localDate(now, timeZone, -1), MEAL_TYPE_DEFAULT_MINUTE[hints.mealTypeHint ?? "other"], timeZone);
  } else {
    occurredAt = new Date(now.getTime());
  }

  return { mealType: hints.mealTypeHint ?? inferMealType(localMinuteOfDay(occurredAt, timeZone)), occurredAt };
}

/** Whether a meal time can be saved: at most 5 minutes ahead and at most 48 hours back (both inclusive). */
export function checkOccurredAt(at: Date, now: Date): "ok" | "future" | "too_old" {
  const diff = at.getTime() - now.getTime();
  // An invalid date is never saved; "too_old" is the calmer of the two refusals.
  if (Number.isNaN(diff)) return "too_old";
  if (diff > OCCURRED_AT_LIMITS.maxFutureMs) return "future";
  if (-diff > OCCURRED_AT_LIMITS.maxPastMs) return "too_old";
  return "ok";
}

/** The local day of `at` relative to `now` ("today", "yesterday" or "other") and its wall-clock time "HH:MM". */
export function localDayAndTime(at: Date, now: Date, timeZone: string): { day: "today" | "yesterday" | "other"; time: string } {
  const zone = resolveTimeZone(timeZone);
  const today = localDayOf(now, zone);
  const yesterday = localDayOf(new Date(today.start.getTime() - 1), zone);
  const key = localDayOf(at, zone).key;
  return {
    day: key === today.key ? "today" : key === yesterday.key ? "yesterday" : "other",
    time: formatLocalTime(localMinuteOfDay(at, zone)),
  };
}

/** The instant of a form's day and time ("HH:MM"). null for a time that is not valid. */
export function instantFromDayAndTime(day: "today" | "yesterday", time: string, now: Date, timeZone: string): Date | null {
  const minute = parseLocalTime(time);
  if (minute === null) return null;
  const zone = resolveTimeZone(timeZone);
  return atWallClock(localDate(now, zone, day === "yesterday" ? -1 : 0), minute, zone);
}
