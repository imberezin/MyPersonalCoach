import { AI_WORDING } from "../../experiments/wording/constants";
import type { AllowanceFact } from "../../experiments/wording/gate";
import { WEEKLY_FLOW, type OpeningMode } from "../types";

/** The reasons the gate can be closed, in the order the conditions are checked. */
export const WEEKLY_LINE_GATE_REASONS = [
  "switch_off",
  "ai_unconfigured",
  "mode_fixed_text",
  "too_few_days",
  "allowance_daily_cap",
  "allowance_rate_limited",
  "allowance_ledger_unavailable",
  "allowance_reserve",
] as const;

export type WeeklyLineGateReason = (typeof WEEKLY_LINE_GATE_REASONS)[number];

export type WeeklyLineGate = { open: true } | { open: false; reason: WeeklyLineGateReason };

const closed = (reason: WeeklyLineGateReason): WeeklyLineGate => ({ open: false, reason });

/**
 * Pure. Whether the story's one opening sentence may be reworded by the AI. Open iff the weekly AI line is on
 * (WEEKLY_FLOW.enabled AND aiLineEnabled) AND the First Week's master wording switch is on AND ai.configured AND the
 * mode is LEARN AND availableDays >= the First Week's minimum AND the allowance is non-null and allowed AND
 * usedToday + reserveCalls <= dailyCap. The FIRST failing condition names the reason, in the order of
 * WEEKLY_LINE_GATE_REASONS. `allowance: null` (not read) is closed with allowance_ledger_unavailable.
 *
 * Only LEARN is open: a CELEBRATE sentence is derived from the person's weights, the RECOVER sentence is Brand wording
 * ("You came back...") and the quiet-week sentence must never drift, so those three keep the fixed catalog text.
 * The days, the reserve and the master switch are REFERENCES to AI_WORDING (one change moves both operations).
 * Every comparison is written so that a NaN or a missing number closes the gate.
 */
export function decideWeeklyLineGate(input: {
  mode: OpeningMode;
  availableDays: number;
  ai: { configured: boolean; dailyCap: number; allowance: AllowanceFact | null };
}): WeeklyLineGate {
  if (!WEEKLY_FLOW.enabled || !WEEKLY_FLOW.aiLineEnabled || !AI_WORDING.enabled) return closed("switch_off");
  if (input.ai.configured !== true) return closed("ai_unconfigured");
  if (input.mode !== "LEARN") return closed("mode_fixed_text");
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
