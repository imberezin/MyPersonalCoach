import { classifyPattern, PATTERN_THRESHOLDS } from "../patternLifecycle";
import { resolveTimeZone } from "../time";
import type { PatternFeedback, PatternRow, PatternView } from "./types";

const isValid = (d: Date): boolean => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * The LIVE level of a pattern, from the live occurrences and the person's own row. Every decision (Home, B6, B5,
 * the AI gate) asks this; the stored `status` is a mirror kept for humans and Weekly Learning and is IGNORED
 * here, except the person's own "Not related to me".
 *
 * REJECTED iff the row says so (status REJECTED, or the person's answer `reject`). Otherwise
 * classifyPattern(occurrences, tz, confirmed), where `confirmed` is true iff the person answered "Sounds right"
 * AND the answer was given while the level was already CANDIDATE, that is `feedbackAt` is not before the time of
 * the candidate-th occurrence. A yes given at the 2-evening Early Signal is therefore NOT counted when a third
 * evening arrives later: Validated means "Candidate + a yes the person gave to the Candidate", and the person
 * never saw the Candidate-level claim. (A meal dated retroactively after the answer can still make an old yes
 * count; accepted, no decision depends on it beyond the offer/AI gate, which a Candidate already opens.)
 */
export function effectivePatternStatus(input: {
  occurrences: readonly Date[];
  timeZone: string;
  row: PatternRow | null;
}): PatternView {
  const { row } = input;
  if (row && (row.status === "REJECTED" || row.feedback === "reject")) return "REJECTED";

  const timeZone = resolveTimeZone(input.timeZone);
  const occurrences = input.occurrences.filter(isValid).sort((a, b) => a.getTime() - b.getTime());

  let confirmed = false;
  if (row && row.feedback === "confirm" && row.feedbackAt !== null && isValid(row.feedbackAt)) {
    const candidateOccurrence = occurrences[PATTERN_THRESHOLDS.candidate - 1];
    confirmed = candidateOccurrence !== undefined && row.feedbackAt.getTime() >= candidateOccurrence.getTime();
  }
  return classifyPattern(occurrences, timeZone, confirmed);
}

/** NONE and EARLY_SIGNAL both store as OBSERVATION (the column has no EARLY_SIGNAL); REJECTED is never written by the sync. */
export function toDbStatus(view: Exclude<PatternView, "REJECTED">): "OBSERVATION" | "CANDIDATE" | "VALIDATED" {
  switch (view) {
    case "NONE":
    case "EARLY_SIGNAL":
      return "OBSERVATION";
    case "CANDIDATE":
      return "CANDIDATE";
    case "VALIDATED":
      return "VALIDATED";
    default:
      return view satisfies never;
  }
}

const FEEDBACK: readonly PatternFeedback[] = ["confirm", "unsure", "reject"];

/** Closed parse of a form value: "confirm" | "unsure" | "reject" | null (anything else, including "", arrays and files). */
export function feedbackFromAnswer(answer: unknown): PatternFeedback | null {
  return typeof answer === "string" ? (FEEDBACK.find((f) => f === answer) ?? null) : null;
}
