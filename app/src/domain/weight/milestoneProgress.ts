import { computeMilestones } from "../milestones";
import { resolveTimeZone, zonedMidnightUtc } from "../time";
import { addDaysToDayKey, parseDayKey, type TrendPoint } from "./trend";
import { MILESTONE_MOMENT } from "./types";

/** Landmarks on the way from the start weight to the goal, and the Home moment they can earn. Pure: no I/O, no clock. */

export type MilestoneStepKind = "START" | "STEP" | "GOAL";
export type MilestoneStepState = "REACHED" | "NEXT" | "AHEAD";

export interface MilestoneStep {
  /** 0 = start. */
  index: number;
  kg: number;
  kind: MilestoneStepKind;
  state: MilestoneStepState;
  /** The FIRST week of the earliest qualifying pair ("the week the average first came to it"). */
  reachedWeekStart: string | null;
  /** The SECOND week of that pair: the week that made it true (the Home window and the acknowledgement hang on this one). */
  confirmedWeekStart: string | null;
}

export type MilestoneProgress =
  /** No numeric goal, goal not below the start weight, a number missing: the section does not exist. */
  | { kind: "NONE" }
  /** A numeric goal exists but the history was truncated: no "reached" can be claimed. */
  | { kind: "UNKNOWN" }
  | { kind: "LIST"; steps: readonly MilestoneStep[]; goalReached: boolean };

/** A landmark is "at or below" an average with a hair of tolerance, so 75.0 against 75 never depends on float noise. */
const EPSILON = 1e-9;

/**
 * steps = computeMilestones(startKg, goalKg). Step 0 (the start weight) is REACHED with no week. A step i >= 1 is REACHED when
 * TWO CONSECUTIVE COMPLETE weekly points both have averageKg <= its kg. "Consecutive" means adjacent in the list of complete
 * points (the person's own weigh-in weeks; a week without a weigh-in is skipped, never a zero), over ALL points (not the sliced
 * chart). The unfinished current week (`complete: false`) never takes part: it is drawn, it decides nothing. `reachedWeekStart`
 * and `confirmedWeekStart` are the first and second week of the EARLIEST qualifying pair. The first step that is not reached
 * is NEXT; the rest AHEAD. A reached landmark stays reached (the pair, once there, stays in the history). A goalType other than
 * "numeric" is NONE whatever the numbers say. `complete: false` (a truncated read) is UNKNOWN when the milestones exist, NONE
 * otherwise. goalReached = the last step is REACHED.
 * (Why two: with one weigh-in a week a single mistyped or unusually low morning reading would otherwise unlock the most
 * emotional moment of the product; deleting an entry retracts it, but only if the person notices.)
 */
export function milestoneProgress(input: {
  startKg: number | null;
  goalKg: number | null;
  goalType: "numeric" | "behavioral" | "none";
  weeklyPoints: readonly TrendPoint[];
  /** "The history was read in full" (not truncated); each point's own `complete` is the week flag. */
  complete: boolean;
}): MilestoneProgress {
  if (input.goalType !== "numeric" || input.startKg === null || input.goalKg === null) return { kind: "NONE" };
  const kgs = computeMilestones(input.startKg, input.goalKg);
  if (kgs.length === 0) return { kind: "NONE" };
  if (!input.complete) return { kind: "UNKNOWN" };

  const done = input.weeklyPoints
    .filter((p) => p.complete)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));

  // The earliest pair of adjacent complete weeks that are both at or below `kg`.
  const earliestPair = (kg: number): { first: string; second: string } | null => {
    for (let i = 0; i + MILESTONE_MOMENT.weeksInARow <= done.length; i++) {
      const pair = done.slice(i, i + MILESTONE_MOMENT.weeksInARow);
      if (pair.every((p) => p.averageKg <= kg + EPSILON)) return { first: pair[0].weekStart, second: pair[pair.length - 1].weekStart };
    }
    return null;
  };

  let nextAssigned = false;
  const steps: MilestoneStep[] = kgs.map((kg, index) => {
    const kind: MilestoneStepKind = index === 0 ? "START" : index === kgs.length - 1 ? "GOAL" : "STEP";
    const pair = index === 0 ? null : earliestPair(kg);
    const reached = index === 0 || pair !== null;
    let state: MilestoneStepState = "REACHED";
    if (!reached) {
      state = nextAssigned ? "AHEAD" : "NEXT";
      nextAssigned = true;
    }
    return { index, kg, kind, state, reachedWeekStart: pair?.first ?? null, confirmedWeekStart: pair?.second ?? null };
  });

  return { kind: "LIST", steps, goalReached: steps[steps.length - 1].state === "REACHED" };
}

export interface MilestoneMoment {
  /** The confirmedWeekStart of the step: the acknowledgement key. */
  week: string;
  isGoal: boolean;
}

/** The local midnight that starts a date key, or null when the key is not a date. */
function localMidnight(key: string, timeZone: string): Date | null {
  const parts = parseDayKey(key);
  return parts ? zonedMidnightUtc(parts.year, parts.month, parts.day, timeZone) : null;
}

/**
 * The achievement Home may show. Look only at the HIGHEST reached step with index >= 1 (an older, lower one is never dug up).
 * windowStart = the LOCAL midnight that starts the first day of the week AFTER its confirmedWeekStart (the first moment the
 * pair can be known: both weeks are complete); windowEnd = the local midnight MILESTONE_MOMENT.windowDays (14) CALENDAR days
 * after windowStart (calendar arithmetic in the profile's zone, never 14 x 24 h, so a DST change inside the window cannot
 * shift it). It is a moment when windowStart <= now < windowEnd (at windowEnd itself it is no longer fresh) and its `week`
 * is not in `acknowledged` (a set of week date keys). NONE and UNKNOWN progress give null.
 */
export function decideMilestoneMoment(input: {
  progress: MilestoneProgress;
  now: Date;
  timeZone: string;
  acknowledged: ReadonlySet<string>;
}): MilestoneMoment | null {
  if (input.progress.kind !== "LIST" || Number.isNaN(input.now.getTime())) return null;

  const highest = [...input.progress.steps].reverse().find((s) => s.index >= 1 && s.state === "REACHED");
  if (!highest || highest.confirmedWeekStart === null) return null;
  const week = highest.confirmedWeekStart;
  if (input.acknowledged.has(week)) return null;

  const tz = resolveTimeZone(input.timeZone);
  const startKey = addDaysToDayKey(week, 7);
  const windowStart = localMidnight(startKey, tz);
  const windowEnd = localMidnight(addDaysToDayKey(startKey, MILESTONE_MOMENT.windowDays), tz);
  if (!windowStart || !windowEnd) return null;

  const t = input.now.getTime();
  if (t < windowStart.getTime() || t >= windowEnd.getTime()) return null;
  return { week, isGoal: highest.kind === "GOAL" };
}
