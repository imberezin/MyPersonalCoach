import type { ExperimentSelection } from "../experiments/types";
import { FIRST_WEEK } from "../firstWeek";
import { countAvailableDays, type OfflinePeriod } from "../offline";
import type { PatternKind, PatternView } from "../patterns/types";
import { localDayOf, resolveTimeZone } from "../time";
import {
  FIRST_WEEK_RECOVERY,
  type DidLine,
  type FirstWeekSummary,
  type NoticedItem,
} from "./types";
import { buildWhy } from "./why";

const isValid = (d: Date): boolean => d instanceof Date && !Number.isNaN(d.getTime());

/** One item per pattern kind whose live level is Early Signal, Candidate or Validated. NONE and REJECTED yield nothing. */
function noticedItemFor(kind: PatternKind): NoticedItem {
  switch (kind) {
    case "late_evening_meals":
      return { kind: "LATE_EVENING_MEALS" };
    default:
      return kind satisfies never;
  }
}

function buildNoticed(signals: readonly { kind: PatternKind; view: PatternView }[]): FirstWeekSummary["noticed"] {
  const seen = new Set<PatternKind>();
  const items: NoticedItem[] = [];
  for (const { kind, view } of signals) {
    if (view !== "EARLY_SIGNAL" && view !== "CANDIDATE" && view !== "VALIDATED") continue;
    if (seen.has(kind)) continue;
    seen.add(kind);
    items.push(noticedItemFor(kind));
  }
  return items.length > 0 ? { kind: "OBSERVATIONS", items } : { kind: "NOT_ENOUGH_YET" };
}

/**
 * RETURNED: two consecutive confirmed meals with at least FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal whole
 * AVAILABLE days between them (offline days do not count, so a Shabbat in between is not a "gap"). Counted the
 * way the Home recovery card counts it: days that ended after the first meal's own day, up to the second meal.
 */
function hasReturned(sortedAsc: readonly Date[], periods: readonly OfflinePeriod[], timeZone: string): boolean {
  for (let i = 1; i < sortedAsc.length; i++) {
    const gap = countAvailableDays(
      periods,
      timeZone,
      localDayOf(sortedAsc[i - 1], timeZone).end,
      sortedAsc[i],
      FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal,
    );
    if (gap >= FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal) return true;
  }
  return false;
}

/**
 * B6, deterministic: every line is true or absent. Pure; it never reads a clock, a database or the AI, and its
 * result holds no number (the only free text is `why.motivation`, the person's own words, tidied and shortened by
 * buildWhy). The experiment's TEXT is not part of it: the view reads that from the stored row.
 */
export function buildFirstWeekSummary(input: {
  timeZone: string;
  /** confirmed_at of the earliest meals, any order (at most FIRST_WEEK_LIMITS.summaryMeals). */
  mealTimes: readonly Date[];
  periods: readonly OfflinePeriod[];
  /** The live pattern level per kind, already computed. A kind that is NONE or REJECTED yields no item. */
  signals: readonly { kind: PatternKind; view: PatternView }[];
  /** The result of selectFirstExperiment: OFFER / PENDING / ACTIVE map to next.*; NONE maps to NO_EXPERIMENT. */
  experiment: ExperimentSelection;
  /** The person's own onboarding answers (`goal_focus`, `motivation`), and whether a numeric goal exists. Display only; the weight target itself is not here. */
  goal: { focus: readonly string[]; motivation: string | null; numericGoal: boolean };
}): FirstWeekSummary {
  const timeZone = resolveTimeZone(input.timeZone);
  const meals = input.mealTimes.filter(isValid).sort((a, b) => a.getTime() - b.getTime());

  const tone: FirstWeekSummary["tone"] =
    meals.length === 0 ? "NO_MEALS" : meals.length < FIRST_WEEK.minConfirmedMeals ? "LITTLE" : "ENOUGH";

  const did: DidLine[] = [meals.length === 0 ? { kind: "NO_MEALS" } : { kind: "MEALS" }];
  if (input.experiment.kind === "ACTIVE") did.push({ kind: "EXPERIMENT" });

  const moment: FirstWeekSummary["moment"] = hasReturned(meals, input.periods, timeZone)
    ? { kind: "RETURNED" }
    : meals.length > 0
      ? { kind: "FIRST_REPORT" }
      : { kind: "NONE" };

  const next = ((): FirstWeekSummary["next"] => {
    switch (input.experiment.kind) {
      case "NONE":
        return { kind: "NO_EXPERIMENT" };
      case "OFFER":
        return { kind: "OFFER" };
      case "PENDING":
        return { kind: "PENDING" };
      case "ACTIVE":
        return { kind: "ACTIVE" };
      default:
        return input.experiment satisfies never;
    }
  })();

  return {
    tone,
    why: buildWhy(input.goal),
    did,
    noticed: buildNoticed(input.signals),
    moment,
    next,
  };
}
