import { localDayOf, resolveTimeZone } from "../time";
import { FIRST_WEEK_SNOOZE, NOT_SNOOZED, type FirstWeekSnoozed } from "./types";

const HOUR_MS = 3_600_000;

/**
 * Snooze events (already limited to the last FIRST_WEEK_SNOOZE.hours by the query) to the two flags. Total and
 * never throws: an unknown card, a missing or non-string `card`, an invalid date and a date in the future are
 * all ignored. A card is snoozed iff an event for it satisfies `now - hours < occurredAt <= now`; an event
 * exactly `hours` old has expired.
 */
export function activeSnoozes(input: {
  events: readonly { card: unknown; occurredAt: Date }[];
  now: Date;
}): FirstWeekSnoozed {
  const now = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (Number.isNaN(now)) return { ...NOT_SNOOZED };
  const since = now - FIRST_WEEK_SNOOZE.hours * HOUR_MS;

  let summary = false;
  let welcomeBack = false;
  for (const event of input.events) {
    const at = event?.occurredAt instanceof Date ? event.occurredAt.getTime() : Number.NaN;
    if (Number.isNaN(at) || at <= since || at > now) continue;
    if (event.card === "summary") summary = true;
    else if (event.card === "welcome_back") welcomeBack = true;
  }
  return { summary, welcomeBack };
}

/**
 * True iff the person pressed "Thanks" on the active-experiment card earlier on the SAME LOCAL DAY as `now`: the card then stays
 * away until local midnight. The same events as activeSnoozes (the read may be broader than the day: this keeps only the day),
 * total and never throws: another card, a missing or non-string `card`, an invalid date and a date in the future are ignored.
 * An event exactly at local midnight belongs to the new day. `timeZone` is validated here (a bad zone is Jerusalem, as everywhere).
 */
export function experimentCardSnoozed(input: {
  events: readonly { card: unknown; occurredAt: Date }[];
  now: Date;
  timeZone: string;
}): boolean {
  const now = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (Number.isNaN(now)) return false;
  const dayStart = localDayOf(input.now, resolveTimeZone(input.timeZone)).start.getTime();
  return input.events.some((event) => {
    const at = event?.occurredAt instanceof Date ? event.occurredAt.getTime() : Number.NaN;
    return event?.card === FIRST_WEEK_SNOOZE.experimentCard && !Number.isNaN(at) && at >= dayStart && at <= now;
  });
}
