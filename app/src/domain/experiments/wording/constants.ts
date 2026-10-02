import { PATTERN_THRESHOLDS } from "../../patternLifecycle";

/**
 * Every number of the AI wording gate and validator, in ONE object (decision 4 of the First Week
 * build). The wording operation only rewords the approved library sentence of an experiment the
 * engine already chose; when the gate is closed or any check fails, the library text is shown as
 * it is. Nothing else in the code base holds a copy of these values.
 */
export const AI_WORDING = {
  /** Master kill switch: false = the library's text, never a provider call. */
  enabled: true,
  /** A REFERENCE to the pattern threshold, not a copy: a threshold change moves the AI gate too (a test pins the equality). */
  minOccurrences: PATTERN_THRESHOLDS.candidate,
  /** Occurrences on different days. Equal to minOccurrences by construction of the detector, still checked separately. */
  minDistinctDays: PATTERN_THRESHOLDS.candidate,
  /** First Week available days (FirstWeekProgress.availableDays, capped at 15). */
  minAvailableDays: 4,
  /** Daily provider attempts that must remain for meal reports after this one. */
  reserveCalls: 10,
  /** Hard length cap of the reworded text. */
  maxChars: { he: 140, en: 180 },
  /** Share of the approved text's content tokens that must survive. */
  minTokenOverlap: 0.5,
  /** Content tokens the reworded text may add (tone words only: a whole extra instruction does not fit). */
  maxNewTokens: 4,
  attemptTimeoutMs: 8_000,
  totalBudgetMs: 9_000,
  /** An invalid answer is not retried: the library's text is shown. */
  retries: 0,
} as const;
