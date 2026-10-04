import type { LifecycleState } from "../firstWeek";
import { isAvailableDay, type OfflinePeriod } from "../offline";
import { localDayOf, localMinuteOfDay, resolveTimeZone, zonedInstantUtc } from "../time";
import { addDaysToDayKey, parseDayKey } from "../weight/trend";
import { WEEKLY_FLOW, WEEKLY_TIMING } from "./types";
import { shiftWeek, weekWindowOf, type WeekWindow } from "./week";

const HOUR_MS = 3_600_000;

const isValid = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/** The instant of a wall-clock minute (0..1439) on the local day with the given date key. */
function instantOfLocalMinute(dayKey: string, minute: number, timeZone: string): Date {
  const parts = parseDayKey(dayKey);
  // dayKey comes from localDayOf, so it is always a real date; the guard keeps the function total.
  if (!parts) return new Date(Number.NaN);
  return zonedInstantUtc(parts.year, parts.month, parts.day, Math.floor(minute / 60), minute % 60, timeZone);
}

/**
 * The readiness instant of a week: `week.end + readyMinute` local (a DST Sunday needs no special case: it is a wall-clock
 * time on the day that starts at `week.end`), or earlier when the aggregated Motzei Shabbat report was confirmed (the seam:
 * that report does not exist yet, so the loader passes null). A confirmation counts only when it is valid and not earlier
 * than `aggregatedReportLeadHours` before the week's end; the result is then the earlier of the two.
 */
export function weeklyReadyAt(a: { week: WeekWindow; timeZone: string; aggregatedReportConfirmedAt: Date | null }): Date {
  const timeZone = resolveTimeZone(a.timeZone);
  const base = instantOfLocalMinute(localDayOf(a.week.end, timeZone).key, WEEKLY_TIMING.readyMinute, timeZone);
  const confirmed = a.aggregatedReportConfirmedAt;
  if (!isValid(confirmed)) return base;
  if (confirmed.getTime() < a.week.end.getTime() - WEEKLY_TIMING.aggregatedReportLeadHours * HOUR_MS) return base;
  return confirmed.getTime() < base.getTime() ? confirmed : base;
}

/** The instant the card window closes: `cardVisibleDays` LOCAL days after the readiness, at the same wall-clock minute. */
function cardWindowEnd(readyAt: Date, timeZone: string): Date {
  const key = addDaysToDayKey(localDayOf(readyAt, timeZone).key, WEEKLY_TIMING.cardVisibleDays);
  return instantOfLocalMinute(key, localMinuteOfDay(readyAt, timeZone), timeZone);
}

/**
 * The LATEST of {this week, last week, the week before} whose readiness is at or before `now`. Today the current week never
 * qualifies (its base readiness is next Sunday), so this is last week from Sunday 05:00 and the week before it from Sunday
 * 00:00 to 05:00. null only for an invalid `now`.
 */
function candidateWeek(now: Date, timeZone: string, aggregatedReportConfirmedAt: Date | null): { week: WeekWindow; readyAt: Date } | null {
  if (!isValid(now)) return null;
  const current = weekWindowOf(now, timeZone);
  for (const back of [0, -1, -2]) {
    const week = back === 0 ? current : shiftWeek(current, back, timeZone);
    const readyAt = weeklyReadyAt({ week, timeZone, aggregatedReportConfirmedAt });
    if (readyAt.getTime() <= now.getTime()) return { week, readyAt };
  }
  return null;
}

export type WeeklyMoment =
  | { kind: "NONE"; reason: "switch_off" | "invalid_input" | "not_weekly_cycle" | "no_cycle_start" | "window_too_short" }
  | { kind: "READY"; week: WeekWindow; window: { start: Date; end: Date }; availableDays: number; readyAt: Date; cardVisible: boolean };

/**
 * Pure. Order: WEEKLY_FLOW.enabled false -> switch_off; invalid `now` -> invalid_input; lifecycle !== WEEKLY_CYCLE ->
 * not_weekly_cycle; firstWeekEndedAt null or invalid -> no_cycle_start. The candidate is the latest of {this week, last week,
 * the week before} whose weeklyReadyAt is at or before now. window = [max(week.start, end of the local day of
 * firstWeekEndedAt), week.end): the transition day belongs to the First Week summary and is never in a weekly fact.
 * availableDays = the local days of the window for which isAvailableDay holds; fewer than minAvailableDaysInWindow ->
 * window_too_short (and no fallback to an older week: the person continues on the next Sunday). cardVisible = now is
 * before readiness + cardVisibleDays local days.
 */
export function decideWeeklyMoment(input: {
  now: Date;
  timeZone: string;
  lifecycle: LifecycleState | null;
  firstWeekEndedAt: Date | null;
  periods: readonly OfflinePeriod[];
  aggregatedReportConfirmedAt: Date | null;
}): WeeklyMoment {
  if (!WEEKLY_FLOW.enabled) return { kind: "NONE", reason: "switch_off" };
  if (!isValid(input.now)) return { kind: "NONE", reason: "invalid_input" };
  if (input.lifecycle !== "WEEKLY_CYCLE") return { kind: "NONE", reason: "not_weekly_cycle" };
  if (!isValid(input.firstWeekEndedAt)) return { kind: "NONE", reason: "no_cycle_start" };

  const timeZone = resolveTimeZone(input.timeZone);
  const candidate = candidateWeek(input.now, timeZone, input.aggregatedReportConfirmedAt);
  if (!candidate) return { kind: "NONE", reason: "invalid_input" };
  const { week, readyAt } = candidate;

  const transitionDayEnd = localDayOf(input.firstWeekEndedAt, timeZone).end;
  const windowStart = transitionDayEnd.getTime() > week.start.getTime() ? transitionDayEnd : week.start;
  const availableDays = week.days.filter((day) => day.start.getTime() >= windowStart.getTime() && isAvailableDay(input.periods, day)).length;
  if (availableDays < WEEKLY_TIMING.minAvailableDaysInWindow) return { kind: "NONE", reason: "window_too_short" };

  return {
    kind: "READY",
    week,
    window: { start: windowStart, end: week.end },
    availableDays,
    readyAt,
    cardVisible: input.now.getTime() < cardWindowEnd(readyAt, timeZone).getTime(),
  };
}

/**
 * Home's cheap pre-check (no data needed): the candidate week and its readiness when the CARD window is open at `now`, else
 * null. The loader makes no query when this is null, so Wednesday 05:00 to Sunday 05:00 a Home render pays nothing.
 */
export function weeklyCardPrecheck(input: {
  now: Date;
  timeZone: string;
  aggregatedReportConfirmedAt: Date | null;
}): { week: WeekWindow; readyAt: Date } | null {
  if (!WEEKLY_FLOW.enabled) return null;
  const timeZone = resolveTimeZone(input.timeZone);
  const candidate = candidateWeek(input.now, timeZone, input.aggregatedReportConfirmedAt);
  if (!candidate) return null;
  return input.now.getTime() < cardWindowEnd(candidate.readyAt, timeZone).getTime() ? candidate : null;
}

/**
 * A card is snoozed iff an event whose payload.week equals `weekStart` satisfies `now - snoozeHours < occurredAt <= now`
 * (an event exactly `snoozeHours` old has expired). Total: a non-string `week`, an invalid date and a future date are ignored.
 */
export function activeWeeklySnooze(input: {
  events: readonly { week: unknown; occurredAt: Date }[];
  weekStart: string;
  now: Date;
}): boolean {
  const now = isValid(input.now) ? input.now.getTime() : Number.NaN;
  if (Number.isNaN(now)) return false;
  const since = now - WEEKLY_TIMING.snoozeHours * HOUR_MS;
  return input.events.some((event) => {
    const at = isValid(event?.occurredAt) ? event.occurredAt.getTime() : Number.NaN;
    return event?.week === input.weekStart && !Number.isNaN(at) && at > since && at <= now;
  });
}
