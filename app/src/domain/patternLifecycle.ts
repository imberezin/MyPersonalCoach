import { DAY_MS, localDayOf } from "./time";

/** Tunable constants. A pattern needs evidence; one event is only an observation. */
export const PATTERN_THRESHOLDS = {
  earlySignal: 2,
  candidate: 3,
  validated: 5,
  validatedMinSpanDays: 14,
  /** Occurrences needed before a user's "yes" can validate a candidate. */
  userConfirmedMin: 3,
} as const;

export type PatternStatus = "NONE" | "EARLY_SIGNAL" | "CANDIDATE" | "VALIDATED";

/**
 * Observation -> Early Signal -> Candidate -> Validated.
 *  - Early Signal: 2 occurrences.
 *  - Candidate: 3 occurrences on different days.
 *  - Validated: 5 occurrences over at least two weeks, or a Candidate the user confirms
 *    (with at least 3 occurrences).
 * User confirmation alone is never sufficient.
 */
export function classifyPattern(occurrences: readonly Date[], timeZone: string, userConfirmed = false): PatternStatus {
  const t = PATTERN_THRESHOLDS;
  const count = occurrences.length;
  if (count < t.earlySignal) return "NONE";

  const distinctDays = new Set(occurrences.map((o) => localDayOf(o, timeZone).key)).size;
  const times = occurrences.map((o) => o.getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / DAY_MS;

  const isCandidate = count >= t.candidate && distinctDays >= t.candidate;
  if (!isCandidate) return "EARLY_SIGNAL";

  const strongEvidence = count >= t.validated && spanDays >= t.validatedMinSpanDays;
  const confirmedCandidate = userConfirmed && count >= t.userConfirmedMin;
  return strongEvidence || confirmedCandidate ? "VALIDATED" : "CANDIDATE";
}
