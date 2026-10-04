import type { OfflinePeriod } from "../offline";
import { decideEarlySignal } from "../patterns/earlySignal";
import { LATE_EVENING, type PatternKind, type PatternRow } from "../patterns/types";
import { DAY_MS } from "../time";
import { findReturn, mealDaysIn, type WeeklyMeal } from "./derive";
import {
  WEEKLY_FLOW,
  WEEKLY_THRESHOLDS,
  WEEKLY_WEIGHT,
  type ExperimentRecord,
  type ExperimentResult,
  type OpeningLineKey,
  type OpeningMode,
  type PatternSignal,
  type WeightLine,
} from "./types";
import type { WeeklyWeightFacts } from "./weightFacts";

export type OpeningReason = "little_data" | "milestone" | "experiment_helpful" | "returned" | "data";

/**
 * The five-way decision. `meaningful`, `milestone`, `experimentHelpful` and `returned` come from the story builder;
 * `periodsComplete` false disables RECOVER (a return is never claimed on shaky days). Precedence:
 * RESET (not enough meaningful information) > CELEBRATE (a landmark, then an experiment that really helped) > RECOVER > LEARN.
 * The enum stays RESET because the column forces it; the copy says "a quiet week" (Brand section 19).
 */
export function chooseOpeningMode(a: {
  meaningful: boolean;
  milestone: { index: number; isGoal: boolean } | null;
  experimentHelpful: boolean;
  returned: boolean;
  periodsComplete: boolean;
}): { mode: OpeningMode; reason: OpeningReason; lineKey: OpeningLineKey } {
  if (!a.meaningful) return { mode: "RESET", reason: "little_data", lineKey: "quiet" };
  if (a.milestone !== null) {
    return { mode: "CELEBRATE", reason: "milestone", lineKey: a.milestone.isGoal ? "celebrateGoal" : "celebrateMilestone" };
  }
  if (a.experimentHelpful) return { mode: "CELEBRATE", reason: "experiment_helpful", lineKey: "celebrateExperiment" };
  if (a.returned && a.periodsComplete) return { mode: "RECOVER", reason: "returned", lineKey: "recover" };
  return { mode: "LEARN", reason: "data", lineKey: "learn" };
}

/** What happened this week, with no number: a line says that something happened, not how many times. */
export type HappenedLine =
  | { kind: "MEALS" }
  | { kind: "WEIGHED" }
  | { kind: "RETURNED" }
  | { kind: "EXPERIMENT_STARTED" }
  | { kind: "EXPERIMENT_TRIED" };

export type LearnedLine =
  /** ESTABLISHED = CANDIDATE or VALIDATED. */
  | { kind: "LATE_EVENING"; level: "EARLY_SIGNAL" | "ESTABLISHED" }
  | { kind: "EXPERIMENT"; result: ExperimentResult }
  | { kind: "NOT_YET" };

export interface WeeklyStory {
  mode: OpeningMode;
  reason: OpeningReason;
  lineKey: OpeningLineKey;
  /** Contains no number; may be empty (the section is then omitted). */
  happened: readonly HappenedLine[];
  /** Never empty (NOT_YET when nothing else). */
  learned: readonly LearnedLine[];
  /** NONE = no line. */
  weight: WeightLine;
  patternQuestion: { kind: "NONE" } | { kind: "ASK"; patternKind: PatternKind };
  invite: { weighIn: boolean };
}

const isValid = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

const within = (at: Date | null, range: { start: Date; end: Date }): boolean =>
  isValid(at) && at.getTime() >= range.start.getTime() && at.getTime() < range.end.getTime();

/** The answer of a DONE experiment, in the form of the five H5 answers. */
function resultOf(record: ExperimentRecord): ExperimentResult {
  if (record.tried === "NO") return "not_tried";
  switch (record.helpfulness) {
    case "HELPFUL":
      return "helpful";
    case "SOMEWHAT":
      return "somewhat";
    case "NOT_REALLY":
      return "not_really";
    default:
      return "unknown";
  }
}

/**
 * Pure, total, never mutates its input, and the story it returns holds no number at all. The weight facts are computed by the
 * caller (weeklyWeightFacts, from the Weight item's trend), so this builder has no weight math.
 *
 * Every experiment fact belongs to exactly ONE story. A result is answered at the READING moment, which is after the
 * summarised week ended, so RESULT facts use the ANSWER WINDOW `[week.end, next week.end)` and START facts use
 * `[window.start, week.end)`: the same "really helped" cannot celebrate twice, "you started something small" cannot appear
 * for a week in which nothing was started, and an old answer cannot turn a quiet week into a meaningful one.
 */
export function buildWeeklyStory(input: {
  now: Date;
  timeZone: string;
  window: { start: Date; end: Date };
  week: { start: Date; end: Date };
  answerWindow: { start: Date; end: Date };
  periods: readonly OfflinePeriod[];
  periodsComplete: boolean;
  meals: readonly WeeklyMeal[];
  lastMealBefore: Date | null;
  weight: WeeklyWeightFacts;
  signals: readonly PatternSignal[];
  experiments: readonly ExperimentRecord[];
}): WeeklyStory {
  const { now, weight } = input;

  const mealDays = mealDaysIn({ meals: input.meals, periods: input.periods, timeZone: input.timeZone, window: input.window });
  const returned = findReturn({
    meals: input.meals,
    lastMealBefore: input.lastMealBefore,
    periods: input.periods,
    timeZone: input.timeZone,
    window: input.window,
    minGapAvailableDays: WEEKLY_THRESHOLDS.returnGapAvailableDays,
  });
  const returnedForSure = returned && input.periodsComplete;

  const answered = input.experiments.filter((e) => e.status === "DONE" && within(e.endedAt, input.answerWindow));
  const experimentHelpful = answered.some((e) => e.tried === "YES" && e.helpfulness === "HELPFUL");
  const startWindow = { start: input.window.start, end: input.week.end };

  const meaningful = mealDays >= WEEKLY_THRESHOLDS.minMealDays || weight.weighedThisWeek || answered.length > 0 || returnedForSure;
  const opening = chooseOpeningMode({
    meaningful,
    milestone: weight.milestone,
    experimentHelpful,
    returned,
    periodsComplete: input.periodsComplete,
  });

  const happened: HappenedLine[] = [];
  if (mealDays >= 1) happened.push({ kind: "MEALS" });
  if (weight.weighedThisWeek) happened.push({ kind: "WEIGHED" });
  if (returnedForSure) happened.push({ kind: "RETURNED" });
  if (answered.some((e) => e.tried === "YES")) happened.push({ kind: "EXPERIMENT_TRIED" });
  else if (input.experiments.some((e) => (e.status === "ACTIVE" || e.status === "DONE") && within(e.startedAt, startWindow))) {
    happened.push({ kind: "EXPERIMENT_STARTED" });
  }

  const lateEvening = input.signals.find((s) => s.kind === LATE_EVENING.kind);
  const learned: LearnedLine[] = [];
  if (lateEvening) {
    if (lateEvening.view === "EARLY_SIGNAL") learned.push({ kind: "LATE_EVENING", level: "EARLY_SIGNAL" });
    else if (lateEvening.view === "CANDIDATE" || lateEvening.view === "VALIDATED") learned.push({ kind: "LATE_EVENING", level: "ESTABLISHED" });
  }
  const newestAnswer = answered.reduce<ExperimentRecord | null>(
    (best, e) => (best === null || (e.endedAt as Date).getTime() > (best.endedAt as Date).getTime() ? e : best),
    null,
  );
  if (newestAnswer) learned.push({ kind: "EXPERIMENT", result: resultOf(newestAnswer) });
  if (learned.length === 0) learned.push({ kind: "NOT_YET" });

  // The Candidate question: the First Week's data-level rule (an unanswered Candidate asks; "Sounds right" and "Not related"
  // never again; "Not sure" returns after the library's cooldown).
  let patternQuestion: WeeklyStory["patternQuestion"] = { kind: "NONE" };
  if (WEEKLY_FLOW.patternQuestionEnabled && lateEvening && lateEvening.view === "CANDIDATE") {
    const row: PatternRow | null =
      lateEvening.patternId === null
        ? null
        : { id: lateEvening.patternId, status: "CANDIDATE", feedback: lateEvening.feedback, feedbackAt: lateEvening.feedbackAt };
    if (decideEarlySignal({ view: lateEvening.view, row, now }).due) patternQuestion = { kind: "ASK", patternKind: lateEvening.kind };
  }

  // A soft invitation, only in learning and celebrating weeks: no nudge to someone who is returning or has a quiet week.
  const silentLongEnough =
    weight.lastEntryAt === null || now.getTime() - weight.lastEntryAt.getTime() >= WEEKLY_WEIGHT.inviteAfterDays * DAY_MS;
  const weighIn =
    WEEKLY_FLOW.weightLineEnabled &&
    weight.known &&
    (opening.mode === "LEARN" || opening.mode === "CELEBRATE") &&
    weight.hasBaselineOrEntry &&
    silentLongEnough;

  return {
    mode: opening.mode,
    reason: opening.reason,
    lineKey: opening.lineKey,
    happened,
    learned,
    weight: weight.line,
    patternQuestion,
    invite: { weighIn },
  };
}
