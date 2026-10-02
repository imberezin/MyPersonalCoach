import { AI_WORDING } from "./constants";

/** The reasons the gate can be closed, in the order the conditions are checked. */
export const WORDING_GATE_REASONS = [
  "switch_off",
  "ai_unconfigured",
  "pattern_not_established",
  "too_few_occurrences",
  "too_few_days",
  "allowance_daily_cap",
  "allowance_rate_limited",
  "allowance_ledger_unavailable",
  "allowance_reserve",
] as const;

export type WordingGateReason = (typeof WORDING_GATE_REASONS)[number];

export type WordingGate = { open: true } | { open: false; reason: WordingGateReason };

/** Lets the action tell "the gate was closed" from "the AI path failed". */
export function isWordingGateReason(reason: string): reason is WordingGateReason {
  return (WORDING_GATE_REASONS as readonly string[]).includes(reason);
}

/** Structural twin of PatternView: this module does not import the domain patterns module, and that type is assignable to this one. */
export type PatternLevel = "NONE" | "EARLY_SIGNAL" | "CANDIDATE" | "VALIDATED" | "REJECTED";

/** Structural twin of AiAllowance (the domain imports nothing from lib/). */
export interface AllowanceFact {
  allowed: boolean;
  usedToday?: number;
  reason?: "daily_cap" | "rate_limited" | "ledger_unavailable";
}

const closed = (reason: WordingGateReason): WordingGate => ({ open: false, reason });

/**
 * Pure. Open iff AI_WORDING.enabled AND ai.configured AND the view is CANDIDATE or VALIDATED AND occurrences >=
 * minOccurrences AND distinctDays >= minDistinctDays AND availableDays >= minAvailableDays AND the allowance is
 * non-null and allowed AND usedToday + reserveCalls <= dailyCap. The FIRST failing condition names the reason,
 * in the order of WORDING_GATE_REASONS. `allowance: null` (not read) is closed with allowance_ledger_unavailable.
 * Every comparison is written so that a NaN or a missing number closes the gate.
 */
export function decideWordingGate(input: {
  view: PatternLevel;
  occurrences: number;
  distinctDays: number;
  availableDays: number;
  ai: { configured: boolean; dailyCap: number; allowance: AllowanceFact | null };
}): WordingGate {
  if (!AI_WORDING.enabled) return closed("switch_off");
  if (input.ai.configured !== true) return closed("ai_unconfigured");
  if (input.view !== "CANDIDATE" && input.view !== "VALIDATED") return closed("pattern_not_established");
  if (!(input.occurrences >= AI_WORDING.minOccurrences)) return closed("too_few_occurrences");
  if (!(input.distinctDays >= AI_WORDING.minDistinctDays)) return closed("too_few_days");
  if (!(input.availableDays >= AI_WORDING.minAvailableDays)) return closed("too_few_days");

  const allowance = input.ai.allowance;
  if (allowance === null || allowance === undefined) return closed("allowance_ledger_unavailable");
  if (allowance.allowed !== true) {
    if (allowance.reason === "daily_cap") return closed("allowance_daily_cap");
    if (allowance.reason === "rate_limited") return closed("allowance_rate_limited");
    return closed("allowance_ledger_unavailable");
  }
  const usedToday = allowance.usedToday ?? 0;
  if (!(usedToday + AI_WORDING.reserveCalls <= input.ai.dailyCap)) return closed("allowance_reserve");
  return { open: true };
}
