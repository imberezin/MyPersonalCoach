import type { InterventionKey } from "../interventions/library";
import type { ExperimentStatus } from "../experiments/types";
import type { PatternFeedback, PatternKind, PatternView } from "../patterns/types";

/**
 * Weekly Learning (week 2 and on): the vocabulary. Constants, switches and the shapes the roles share. The rules are in
 * week.ts (the local week), moment.ts (when the weekly moment is ready), derive.ts and story.ts (the facts and the story),
 * weightFacts.ts (the weekly weight line, sliced from the Weight item's trend), experiment.ts (the weekly experiment) and
 * line.ts (the stored opening line). Pure: no I/O, no clock.
 */

/** One-line kill switches. false = that piece is silent (Home card, /week, every weekly action are all behind `enabled`). */
export const WEEKLY_FLOW = {
  enabled: true,
  /** The inline "does this sound right" question on /week and answerWeeklyPatternAction. */
  patternQuestionEnabled: true,
  /** Goal-led experiments when no pattern exists. SHIPS OFF until the owner approves their exact sentences (Q2). */
  starterExperimentsEnabled: false,
  /** The optional AI opening line. */
  aiLineEnabled: true,
  /** The one weight-trend line, the milestone celebration and the weigh-in invitation. */
  weightLineEnabled: true,
} as const;

export const WEEKLY_TIMING = {
  /** Sunday 05:00 local, the existing Morning start (HOME_TIMING.morningStartMinute; weekly/types.test.ts pins the equality). */
  readyMinute: 300,
  /** The card shows until readiness + this many local days. */
  cardVisibleDays: 3,
  /** A window with fewer available days is skipped in silence. */
  minAvailableDaysInWindow: 4,
  snoozeHours: 24,
  /** A confirmed aggregated report counts only from this many hours before the week's end (the seam, 4.2). */
  aggregatedReportLeadHours: 36,
} as const;

export const WEEKLY_THRESHOLDS = {
  /** Meal days that make a week "meaningful" on their own. */
  minMealDays: 3,
  /** Available days with no meal that make the next meal a return (= FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal; a test pins the equality). */
  returnGapAvailableDays: 3,
  /** An experiment is asked about once it has run this long, at the next weekly moment. */
  trialDays: 3,
  /** = INTERVENTION_RULES.cooldownDays (a test pins the equality). */
  offerCooldownDays: 14,
} as const;

/** The only weight constant of this item. The trend itself (weekly points, the four-complete-weeks direction rule, the steady band, the stale rule, the two-in-a-row milestones) is the Weight item's and is imported, never recomputed. */
export const WEEKLY_WEIGHT = {
  /** The soft weigh-in invitation needs no entry for this many days. */
  inviteAfterDays: 14,
} as const;

export const WEEKLY_LIMITS = {
  /** Meals read for the week; exactly this many back = truncated = unknown. */
  meals: 300,
  /** Offline rows read; exactly this many back = truncated = unknown. */
  periods: 120,
  periodsLookbackDays: 28,
  /** Experiment rows read (the newest). */
  experiments: 20,
  /** Snooze events read (newest first). */
  snooze: 10,
} as const;

export const WEEKLY_ROUTES = { week: "/week" } as const;
/** "Not now" on the card: stored as an events row; nothing else. */
export const WEEKLY_SNOOZE = { event: "weekly_card_snoozed" } as const;
/** `?failed=1` on /week after a write that did not go through. */
export const WEEKLY_QUERY = { failed: "failed" } as const;

/** = weekly_summaries.opening_mode. The enum stays RESET (the column forces it); copy never says "reset" (Brand section 19). */
export type OpeningMode = "CELEBRATE" | "LEARN" | "RECOVER" | "RESET";
export type OpeningLineKey = "celebrateMilestone" | "celebrateGoal" | "celebrateExperiment" | "recover" | "learn" | "quiet";
/** The five answers of the result question, the closed form field. */
export type ExperimentResult = "helpful" | "somewhat" | "not_really" | "unknown" | "not_tried";
export type Helpfulness = "HELPFUL" | "SOMEWHAT" | "NOT_REALLY" | "UNKNOWN";

/** The database form of an answer. "not_tried" is NOT "unknown": helpfulness stays null (not applicable). */
export const RESULT_TO_DB: Readonly<Record<ExperimentResult, { tried: "YES" | "NO"; helpfulness: Helpfulness | null }>> = {
  helpful: { tried: "YES", helpfulness: "HELPFUL" },
  somewhat: { tried: "YES", helpfulness: "SOMEWHAT" },
  not_really: { tried: "YES", helpfulness: "NOT_REALLY" },
  unknown: { tried: "YES", helpfulness: "UNKNOWN" },
  not_tried: { tried: "NO", helpfulness: null },
};

const RESULTS = Object.keys(RESULT_TO_DB) as ExperimentResult[];

/** Closed parse of the `result` form value: one of the five answers, else null (including "", arrays, files and the wrong case). */
export function resultFromAnswer(answer: unknown): ExperimentResult | null {
  return typeof answer === "string" ? (RESULTS.find((r) => r === answer) ?? null) : null;
}

/** One experiment row as the weekly engine needs it (the First Week's ExperimentFact has no key, result or start). `key` is null for a value outside the library. */
export interface ExperimentRecord {
  id: string;
  status: ExperimentStatus;
  key: InterventionKey | null;
  variantId: string | null;
  sourcePatternId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  helpfulness: Helpfulness | null;
  tried: "YES" | "NO" | null;
}

/** One pattern as the weekly engine reads it (the same shape as the First Week's PatternFact). `view` is the LIVE level, never the stored status. */
export interface PatternSignal {
  kind: PatternKind;
  patternId: string | null;
  view: PatternView;
  feedback: PatternFeedback | null;
  feedbackAt: Date | null;
}

/** The weekly weight line (5.5). NONE = no line. Never carries a number; an increase (UP) is worded and styled like a decrease. */
export type WeightLine = { kind: "NONE" } | { kind: "FIRST" } | { kind: "BUILDING" } | { kind: "DOWN" } | { kind: "STEADY" } | { kind: "UP" };

/**
 * What Home needs while the card window is open. `card: true` = show the card. `card: false` = the card was already opened or
 * snoozed, so Home shows only the quiet "Your week" link (a link, never a second card). null = nothing (outside the window,
 * not due, a week with no report, or unknown).
 */
export interface WeeklyHomeFact {
  weekStart: string;
  card: boolean;
}
