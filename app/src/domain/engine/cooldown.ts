import { INTERVENTION_RULES } from "../interventions/library";
import { DAY_MS } from "../time";

/**
 * One past outcome of an intervention, for the Cooldown stage of the Behavior Engine's decide() (TODO section 1). `key` is the
 * intervention key (null = a value outside the library: it never matches). `at` is when the outcome happened (null = unknown).
 * SKIPPED = the person said "not this time"; NOT_REALLY = they tried it and answered "not really"; OTHER = any other answer
 * they gave after trying.
 */
export interface OutcomeFact {
  key: string | null;
  kind: "SKIPPED" | "NOT_REALLY" | "OTHER";
  at: Date | null;
}

/**
 * The library's 14-day rule, in one place. `facts` is newest first. True iff, for `key`:
 *  - the newest fact of that key is SKIPPED and now - at < days; or
 *  - the `consecutiveNotReally` newest facts of that key are all NOT_REALLY and the newest one is within `days`.
 * `days` defaults to INTERVENTION_RULES.cooldownDays and `consecutiveNotReally` to
 * INTERVENTION_RULES.cooldownAfterConsecutiveNotReally. A fact with a null (or invalid) `at` never cools down: without the time
 * the pause cannot be shown to be running. A fact exactly `days` old has expired. Pure and total.
 */
export function isCoolingDown(a: {
  facts: readonly OutcomeFact[];
  key: string;
  now: Date;
  days?: number;
  consecutiveNotReally?: number;
}): boolean {
  const days = a.days ?? INTERVENTION_RULES.cooldownDays;
  const run = a.consecutiveNotReally ?? INTERVENTION_RULES.cooldownAfterConsecutiveNotReally;
  const nowMs = a.now instanceof Date ? a.now.getTime() : Number.NaN;
  if (Number.isNaN(nowMs)) return false;

  const ofKey = a.facts.filter((f) => f.key === a.key);
  const newest = ofKey[0];
  if (!newest || !(newest.at instanceof Date) || Number.isNaN(newest.at.getTime())) return false;
  const within = nowMs - newest.at.getTime() < days * DAY_MS;

  if (newest.kind === "SKIPPED") return within;
  return run >= 1 && ofKey.length >= run && ofKey.slice(0, run).every((f) => f.kind === "NOT_REALLY") && within;
}
