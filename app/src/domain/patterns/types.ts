import type { PatternStatus } from "../patternLifecycle";

/**
 * Pattern detection: the vocabulary. The pure rules are in detect.ts (what counts as an occurrence), status.ts
 * (the live level) and earlySignal.ts (when the Home card is due); the database reads and the one evidence
 * writer are in src/lib/patterns. Pure: no I/O, no clock.
 */

/** One-line kill switches. false = that piece is silent. */
export const PATTERN_FLOW = {
  /** false: the loaders return "no signal" (null) and nothing downstream appears. */
  detectionEnabled: true,
  /** The Home card and answerEarlySignalAction. */
  earlySignalEnabled: true,
  /** The offer on B6, the B5 page, the three experiment actions. */
  experimentEnabled: true,
  /** refreshPatternsAfterMealChange. */
  syncOnMealChange: true,
} as const;

/** The one signal of the build (decision Q4). All tunable here and nowhere else. */
export const LATE_EVENING = {
  kind: "late_evening_meals",
  /** 21:00 local, inclusive. A wall-clock minute, so DST nights behave. */
  startMinute: 1260,
  /** Exclusive: the evening ends at local midnight; 00:00 to 04:59 is NOT counted (never inferred to belong to the evening before). */
  endMinute: 1440,
  lookbackDays: 30,
  /** Rows the loader reads; exactly this many back = truncated = unknown. */
  maxMeals: 400,
} as const;

/** A closed code, never free text; it widens with each new signal. */
export type PatternKind = typeof LATE_EVENING.kind;
/** = patterns.user_feedback */
export type PatternFeedback = "confirm" | "unsure" | "reject";

/** meal_entries.id / occurred_at */
export interface MealStamp {
  id: string;
  occurredAt: Date;
}
export interface Occurrence {
  mealId: string;
  occurredAt: Date;
  /** "YYYY-MM-DD" in the user's zone. */
  localDay: string;
}

/** The persisted row, as the loader parses it. `status` is a mirror and is read ONLY for REJECTED. */
export interface PatternRow {
  id: string;
  status: "OBSERVATION" | "CANDIDATE" | "VALIDATED" | "REJECTED";
  feedback: PatternFeedback | null;
  feedbackAt: Date | null;
}

/** NONE | EARLY_SIGNAL | CANDIDATE | VALIDATED | REJECTED */
export type PatternView = PatternStatus | "REJECTED";
