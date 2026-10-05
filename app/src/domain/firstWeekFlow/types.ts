import type { GoalFocusKey } from "../onboarding/model";

/**
 * The vocabulary of the First Week flow (B2 to B6, Recovery, the transition): constants, switches and the shapes
 * the roles share. Pure: no I/O, no clock. The thresholds of the rules themselves (5 / 15 days, 10 meals) stay in
 * ../firstWeek.ts; nothing here duplicates them.
 */

/** One-line kill switches. false = that piece is silent. Home reads them; the page and the actions read summaryEnabled too. */
export const FIRST_WEEK_FLOW = {
  /** Home card + /first-week + finishFirstWeekAction. false also keeps the account out of the one-way step. */
  summaryEnabled: true,
  /** Home "You're back" card. */
  welcomeBackEnabled: true,
  /** Saved screen B2/B3 line. */
  acknowledgementEnabled: true,
} as const;

export const FIRST_WEEK_RECOVERY = {
  /** Whole available days with no confirmed meal after which Home says "you're back". Tunable. */
  minAvailableDaysWithoutMeal: 3,
} as const;

export const FIRST_WEEK_LIMITS = {
  /** Offline rows read; exactly this many back = truncated = unknown. */
  periodsQuery: 120,
  /** Earliest meal times read for the B6 "moment" lines (no counts are shown). */
  summaryMeals: 500,
  /** Meal times read for the Saved line; this many back = history incomplete = no line. */
  acknowledgementHistory: 100,
  /** Number of rotating lines (firstWeek.ack.rotating.0..2). */
  acknowledgementRotation: 3,
  /** Snooze events read (newest first). */
  snoozeQuery: 10,
  /** "Why we started" quotes the person's own words up to this many characters (code points, the closing "…" included), cut at a word boundary. Onboarding allows 1000, the column 2000; the summary is a glance, not a reprint. */
  motivationChars: 280,
} as const;

export const FIRST_WEEK_ROUTES = { summary: "/first-week" } as const;

/** "Not now": a press hides that card for `hours`. Stored as an events row; nothing else is stored. */
export const FIRST_WEEK_SNOOZE = {
  event: "first_week_card_snoozed",
  hours: 24,
  /** The one form field of snoozeFirstWeekCardAction. */
  field: "card",
  cards: ["summary", "welcome_back"] as const,
  /**
   * The Home card of an ACTIVE experiment ("Thanks"). It rides the same event and the same form field, but it is not one of the
   * First Week's `cards` (those hide for FIRST_WEEK_SNOOZE.hours in FIRST_WEEK): this one is pressed in WEEKLY_CYCLE and hides the
   * card for the rest of the LOCAL day (experimentCardSnoozed).
   */
  experimentCard: "experiment",
} as const;
export type FirstWeekSnoozeCard = (typeof FIRST_WEEK_SNOOZE.cards)[number];
/** Every value the snooze form field may carry: the First Week's cards and the active-experiment card. */
export type HomeSnoozeCard = FirstWeekSnoozeCard | typeof FIRST_WEEK_SNOOZE.experimentCard;
export interface FirstWeekSnoozed {
  summary: boolean;
  welcomeBack: boolean;
}
export const NOT_SNOOZED: FirstWeekSnoozed = { summary: false, welcomeBack: false };

/** `?failed=1` on the summary page after a write that did not go through. */
export const FIRST_WEEK_QUERY = { failed: "failed" } as const;

export interface FirstWeekProgress {
  /** Whole AVAILABLE local days that have ended since the day First Week began; counting stops at FIRST_WEEK.maxAvailableDays. */
  availableDays: number;
  /** Confirmed meals, counted up to FIRST_WEEK.minConfirmedMeals (the loader asks for no more). */
  confirmedMeals: number;
  /** Whole available days that ended after the day of the newest confirmed meal, counted up to FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal. null = no confirmed meal exists. */
  availableDaysSinceLastMeal: number | null;
}

export type FirstWeekStep =
  | { kind: "SUMMARY_READY"; reason: "enough_data" | "max_days_reached"; hadEnoughData: boolean }
  | { kind: "WELCOME_BACK" }
  | { kind: "KEEP_GOING" };

export type Acknowledgement = { kind: "none" } | { kind: "first" } | { kind: "rotating"; index: 0 | 1 | 2 };

/** No numbers anywhere in the summary: a line says that something happened, not how many times. The one exception is `FirstWeekSummary.why.motivation`, the person's own words. */
export type DidLine =
  /** At least one confirmed meal exists. */
  | { kind: "MEALS" }
  | { kind: "NO_MEALS" }
  /** An experiment of this person is ACTIVE or DONE (the person pressed "I'll try"). */
  | { kind: "EXPERIMENT" };

/** What the detector noticed, one item per pattern kind whose live level is Early Signal, Candidate or Validated and which was not rejected. Never a count. */
export type NoticedItem = { kind: "LATE_EVENING_MEALS" };

export interface FirstWeekSummary {
  /** NO_MEALS: no meal at all. LITTLE: meals, but fewer than FIRST_WEEK.minConfirmedMeals. ENOUGH: otherwise. Only ENOUGH may claim "we already know each other a little". */
  tone: "ENOUGH" | "LITTLE" | "NO_MEALS";
  /**
   * "Why we started", from the person's own onboarding answers. NONE iff there is no answer at all. SOME otherwise:
   * `focus` is the goals the person chose, in GOAL_FOCUS_KEYS order, deduplicated, never `not_sure`; `notSure` is true
   * iff `not_sure` was the answer (a valid answer, shown kindly; never together with a chosen goal); `motivation` is
   * the person's words, tidied (control and bidi characters removed, whitespace collapsed) and cut at a word boundary
   * with a closing "…" when longer than FIRST_WEEK_LIMITS.motivationChars (null when empty). SOME with nothing in it
   * means the person set a numeric goal and said nothing else. The weight target itself is never part of it.
   */
  why: { kind: "NONE" } | { kind: "SOME"; focus: readonly GoalFocusKey[]; notSure: boolean; motivation: string | null };
  /** Never empty: NO_MEALS when there are no meals. */
  did: readonly DidLine[];
  /** OBSERVATIONS is never empty. */
  noticed: { kind: "NOT_ENOUGH_YET" } | { kind: "OBSERVATIONS"; items: readonly NoticedItem[] };
  moment: { kind: "RETURNED" } | { kind: "FIRST_REPORT" } | { kind: "NONE" };
  /** From selectFirstExperiment. */
  next: { kind: "NO_EXPERIMENT" } | { kind: "OFFER" } | { kind: "PENDING" } | { kind: "ACTIVE" };
}
