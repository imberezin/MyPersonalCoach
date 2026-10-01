/** What the confirm screen (D6) shows, built from a stored understanding. Pure; no I/O, no copy. */
import { mealOf, revisionOf } from "./draft";
import { localDayAndTime } from "./occurredAt";
import type { MealType, Portion, Understanding } from "./types";

export interface ConfirmView {
  id: string;
  /** The user's own words kept as a list; no AI looked at it. */
  manual: boolean;
  /** A development test result; the screen says so, so it can never pass for a real analysis. */
  fake: boolean;
  items: { name: string; portion: Portion | null; uncertain: boolean }[];
  unclear: string[];
  /** At least one portion was estimated, so the screen adds the "amounts are estimates" line. */
  anyEstimated: boolean;
  mealType: MealType;
  day: "today" | "yesterday" | "other";
  time: string;
  /** Fingerprint of exactly what is shown; the form carries it back so a stale page is noticed. */
  revision: string;
}

export function buildConfirmView(u: Understanding, ctx: { now: Date; timeZone: string }): ConfirmView {
  const meal = mealOf(u);
  const { day, time } = localDayAndTime(meal.occurredAt, ctx.now, ctx.timeZone);
  return {
    id: u.id,
    manual: u.provider === "manual",
    fake: u.provider === "fake",
    items: meal.items.map((i) => ({ name: i.name, portion: i.portion, uncertain: i.uncertain })),
    unclear: u.unclear,
    anyEstimated: meal.items.some((i) => i.portion?.estimated === true),
    mealType: meal.mealType,
    day,
    time,
    revision: revisionOf(meal),
  };
}
