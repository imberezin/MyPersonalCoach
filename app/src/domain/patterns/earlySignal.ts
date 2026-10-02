import { INTERVENTION_RULES } from "../interventions/library";
import { DAY_MS } from "../time";
import type { PatternRow, PatternView } from "./types";

export const EARLY_SIGNAL = {
  /** The library's own constant, not a copy: "Not sure" at the Candidate level returns after this many days. */
  cooldownDays: INTERVENTION_RULES.cooldownDays,
} as const;

/** `level` is null iff the card is not due. */
export interface EarlySignalDecision {
  due: boolean;
  level: "EARLY_SIGNAL" | "CANDIDATE" | null;
}

/**
 * Data-level eligibility of the B4 Home card (the loader computes it; the resolver adds only the time-of-day
 * rules). Due iff the live view is EARLY_SIGNAL or CANDIDATE and
 *  - there is no answer yet (no row, or no feedback), or
 *  - the answer is "unsure" AND the view is CANDIDATE AND now >= feedbackAt + cooldown (feedbackAt null = not due:
 *    without it the cooldown cannot be shown to have passed).
 * "confirm" and "reject" are never due again; NONE, VALIDATED and REJECTED are never due. Pure.
 */
export function decideEarlySignal(input: { view: PatternView; row: PatternRow | null; now: Date }): EarlySignalDecision {
  const { view, row, now } = input;
  const notDue: EarlySignalDecision = { due: false, level: null };
  if (view !== "EARLY_SIGNAL" && view !== "CANDIDATE") return notDue;

  const feedback = row?.feedback ?? null;
  if (feedback === null) return { due: true, level: view };
  if (feedback !== "unsure" || view !== "CANDIDATE") return notDue;

  const answeredAt = row?.feedbackAt ?? null;
  if (answeredAt === null || Number.isNaN(answeredAt.getTime()) || Number.isNaN(now.getTime())) return notDue;
  return now.getTime() >= answeredAt.getTime() + EARLY_SIGNAL.cooldownDays * DAY_MS ? { due: true, level: "CANDIDATE" } : notDue;
}
