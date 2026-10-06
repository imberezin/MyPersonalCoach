import { isCoolingDown, type OutcomeFact } from "../engine/cooldown";
import { PATTERN_EXPERIMENT_MAP } from "../experiments/map";
import { INTERVENTIONS, type Constraint, type InterventionKey } from "../interventions/library";
import { GOAL_FOCUS_KEYS, type GoalFocusKey } from "../onboarding/model";
import type { PatternKind } from "../patterns/types";
import { DAY_MS } from "../time";
import { WEEKLY_FLOW, WEEKLY_THRESHOLDS, type ExperimentRecord, type OpeningMode, type PatternSignal } from "./types";

export type Rationale =
  /** Finishing an inconclusive loop (the same habit once more). */
  | { kind: "KEEP_GOING" }
  | { kind: "PATTERN"; patternKind: PatternKind }
  /** The last one helped; something new and small. */
  | { kind: "NEXT_STEP" }
  /** Matches a goal the person chose in onboarding. */
  | { kind: "GOAL"; goal: GoalFocusKey }
  /** The editorial order, no claim of fit. */
  | { kind: "DEFAULT" };

export type WeeklyExperimentDecision =
  | { kind: "NONE"; reason: "switch_off" | "recovering" | "quiet_week" | "none_eligible" | "cooling_down" }
  | {
      kind: "OFFER";
      origin: "pattern" | "starter";
      patternKind: PatternKind | null;
      patternId: string | null;
      key: InterventionKey;
      variantId: string;
      scope: "next_meal";
      params: Readonly<Record<string, number>>;
      constraints: readonly Constraint[];
      rationale: Rationale;
    }
  /** An OFFERED row exists (any age): an idea waiting. */
  | { kind: "PENDING"; experimentId: string }
  /** Running, younger than trialDays. */
  | { kind: "ACTIVE"; experimentId: string }
  /** Running for at least trialDays: ask the result first. */
  | { kind: "RESULT_DUE"; experimentId: string; key: InterventionKey | null; variantId: string | null };

/**
 * The editorial starter ladder: SMALLEST BEHAVIOURAL STEP FIRST (a first small success matters more than a theoretical
 * optimum). It is an owner-approved prior, NOT evidence, and the whole starter path is ON
 * (`WEEKLY_FLOW.starterExperimentsEnabled` is true) since the owner approved the exact sentences on 2026-10-05 (Q2). It is an
 * OWNER-APPROVED EXCEPTION to the library's `timing: ["IN_CONTEXT"]`: a weekly, self-chosen habit experiment shown on a page
 * the person opened, not an in-the-moment nudge; INTERVENTIONS.md lists it as such. Every entry names an existing library key
 * and variant with: mode NORMAL, asksOutcome true, a context list that includes HABIT or ENVIRONMENT, an eating phase of ANY
 * or BEFORE_EATING, no digit in the approved sentence of either catalog, and none of the constraints never_as_restriction,
 * pre_context_only, no_food_prohibition, never_compensate, no_followup_intervention_on_true_hunger (a test enforces all of it).
 * NOT starters: `check_hunger` (its approved sentence contains the number 10, and INTERVENTIONS.md section 4 allows it before
 * eating only when hunger is not true, which a weekly page cannot know; adding it needs the owner's yes on both points);
 * micro_walk, portion_first, environment, delay and pause (their approved texts presuppose a craving or a second portion, a
 * walking habit with calories-adjacent constraints, or a tempting-food context).
 */
export const STARTER_LADDER: readonly { key: InterventionKey; variantId: string; goals: readonly GoalFocusKey[] }[] = [
  { key: "eat_intentionally", variantId: "default", goals: ["improve_eating", "feel_lighter", "lose_weight"] },
  { key: "slow_down", variantId: "utensils_between_bites", goals: ["lose_weight", "feel_lighter", "understand_overeating"] },
];

/** Pattern kinds in leverage order (then evidence strength, VALIDATED before CANDIDATE). Today one kind. */
export const PATTERN_LEVERAGE_ORDER: readonly PatternKind[] = ["late_evening_meals"];

interface Candidate {
  origin: "pattern" | "starter";
  patternKind: PatternKind | null;
  patternId: string | null;
  /** VALIDATED sorts before CANDIDATE among pattern candidates. */
  strength: number;
  key: InterventionKey;
  variantId: string;
  /** The goals the entry serves (starters only). */
  goals: readonly GoalFocusKey[];
}

const isValid = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
const INCONCLUSIVE = ["SOMEWHAT", "UNKNOWN"] as const;
const isInconclusive = (e: ExperimentRecord): boolean => e.tried === "YES" && e.helpfulness !== null && (INCONCLUSIVE as readonly string[]).includes(e.helpfulness);

/** The weekly rows as outcome facts for the shared Cooldown stage. Rows with tried NO, OFFERED and ACTIVE rows are DROPPED: not trying neither breaks nor extends a run. History is newest first. */
function outcomeFacts(history: readonly ExperimentRecord[]): OutcomeFact[] {
  const facts: OutcomeFact[] = [];
  for (const e of history) {
    if (e.status === "SKIPPED") facts.push({ key: e.key, kind: "SKIPPED", at: e.endedAt });
    else if (e.status === "DONE" && e.tried === "YES") facts.push({ key: e.key, kind: e.helpfulness === "NOT_REALLY" ? "NOT_REALLY" : "OTHER", at: e.endedAt });
  }
  return facts;
}

/**
 * The weekly experiment decision. Pure, deterministic, total; it does not mutate its input and it carries NO text: the sentence
 * is the catalog's, and only the AI gate may reword a PATTERN offer. There is no data that can PROVE which habit matters most,
 * so the "highest-leverage habit" is an ordered, honest rule (finish what is unfinished, then what the person's own data shows,
 * then what matches what they asked for, then the smallest step) and the copy never claims a discovery for the last two.
 *
 * Steps (the first answer wins):
 *  1. the switch off -> NONE switch_off.
 *  2. An ACTIVE row wins whatever else is true: running for at least trialDays (a plain duration) -> RESULT_DUE, else ACTIVE
 *     (no start time: RESULT_DUE, ask rather than trap).
 *  3. An OFFERED row -> PENDING (never a second row).
 *  4. RECOVER -> NONE recovering. RESET removes the starter candidates of step 5 but keeps the pattern ones.
 *  5. Candidates: PATTERN (CANDIDATE or VALIDATED, not rejected, not "not sure" inside the cooldown, with a mapping) and, when
 *     switched on and not RESET, STARTER (every ladder entry).
 *  6. Cooldown stage (the shared isCoolingDown): drop a key that is cooling down.
 *  7. Rotation: (a) a key that ever helped (tried YES, HELPFUL, anywhere in the history that was read) is excluded for good;
 *     (b) from the most recent DONE experiment `last` and the one before it: SOMEWHAT or UNKNOWN prefers the same key once and
 *     rotates on the second in a row; NOT_REALLY excludes the key; tried NO prefers the key once and rotates on the second,
 *     and is never penalised.
 *  8. Choice: the preferred continuation (KEEP_GOING), then pattern candidates, then starters that match the person's goals,
 *     then any other starter. Nothing left -> NONE with ONE reason.
 */
export function decideWeeklyExperiment(input: {
  now: Date;
  mode: OpeningMode;
  patterns: readonly PatternSignal[];
  history: readonly ExperimentRecord[];
  goalFocus: readonly GoalFocusKey[];
}): WeeklyExperimentDecision {
  if (!WEEKLY_FLOW.enabled) return { kind: "NONE", reason: "switch_off" };

  const { now, history } = input;
  const nowMs = isValid(now) ? now.getTime() : Number.NaN;

  const active = history.find((e) => e.status === "ACTIVE");
  if (active) {
    const due = !isValid(active.startedAt) || nowMs - active.startedAt.getTime() >= WEEKLY_THRESHOLDS.trialDays * DAY_MS;
    return due ? { kind: "RESULT_DUE", experimentId: active.id, key: active.key, variantId: active.variantId } : { kind: "ACTIVE", experimentId: active.id };
  }

  const offered = history.find((e) => e.status === "OFFERED");
  if (offered) return { kind: "PENDING", experimentId: offered.id };

  if (input.mode === "RECOVER") return { kind: "NONE", reason: "recovering" };

  // 5. Candidates.
  let candidates: Candidate[] = [];
  for (const signal of input.patterns) {
    const mapped = PATTERN_EXPERIMENT_MAP[signal.kind];
    if (!mapped || (signal.view !== "CANDIDATE" && signal.view !== "VALIDATED") || signal.feedback === "reject") continue;
    if (signal.feedback === "unsure") {
      // Without the time of the answer the pause cannot be shown to have ended.
      const endsAt = isValid(signal.feedbackAt) ? signal.feedbackAt.getTime() + WEEKLY_THRESHOLDS.offerCooldownDays * DAY_MS : Number.POSITIVE_INFINITY;
      if (!(nowMs >= endsAt)) continue;
    }
    candidates.push({
      origin: "pattern",
      patternKind: signal.kind,
      patternId: signal.patternId,
      strength: signal.view === "VALIDATED" ? 0 : 1,
      key: mapped.key,
      variantId: mapped.variantId,
      goals: [],
    });
  }
  if (WEEKLY_FLOW.starterExperimentsEnabled && input.mode !== "RESET") {
    for (const entry of STARTER_LADDER) {
      candidates.push({ origin: "starter", patternKind: null, patternId: null, strength: 0, key: entry.key, variantId: entry.variantId, goals: entry.goals });
    }
  }

  // 6. Cooldown.
  const facts = outcomeFacts(history);
  const beforeCooldown = candidates.length;
  candidates = candidates.filter((c) => !isCoolingDown({ facts, key: c.key, now }));
  const cooledDown = candidates.length < beforeCooldown;

  // 7. Rotation. (a) What helped stays with the person; the next idea is NEW.
  const helped = new Set(history.filter((e) => e.status === "DONE" && e.tried === "YES" && e.helpfulness === "HELPFUL").map((e) => e.key));
  candidates = candidates.filter((c) => !helped.has(c.key));

  // (b) The two most recent DONE experiments, newest first by the end time (an unknown end time is oldest).
  const done = history
    .filter((e) => e.status === "DONE")
    .map((e, index) => ({ e, index, at: isValid(e.endedAt) ? e.endedAt.getTime() : Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((x) => x.e);
  const last = done[0] ?? null;
  const prev = done[1] ?? null;
  let preferredKey: InterventionKey | null = null;
  if (last && last.key !== null) {
    const before = prev !== null && prev.key === last.key ? prev : null;
    if (last.tried === "NO") {
      if (before !== null && before.tried === "NO") candidates = candidates.filter((c) => c.key !== last.key);
      else preferredKey = last.key;
    } else if (last.helpfulness === "NOT_REALLY") {
      candidates = candidates.filter((c) => c.key !== last.key);
    } else if (isInconclusive(last)) {
      if (before !== null && isInconclusive(before)) candidates = candidates.filter((c) => c.key !== last.key);
      else preferredKey = last.key;
    }
  }
  const lastHelped = last !== null && last.tried === "YES" && last.helpfulness === "HELPFUL";

  // 8. Choice.
  const offer = (c: Candidate, rationale: Rationale): WeeklyExperimentDecision => {
    const def = INTERVENTIONS[c.key];
    return {
      kind: "OFFER",
      origin: c.origin,
      patternKind: c.patternKind,
      patternId: c.patternId,
      key: c.key,
      variantId: c.variantId,
      scope: "next_meal",
      params: { ...def.params },
      constraints: [...def.constraints],
      rationale,
    };
  };
  const byLeverage = (a: Candidate, b: Candidate): number => {
    const rank = (c: Candidate) => (c.patternKind === null ? PATTERN_LEVERAGE_ORDER.length : PATTERN_LEVERAGE_ORDER.indexOf(c.patternKind));
    return rank(a) - rank(b) || a.strength - b.strength;
  };

  // (i) The preferred continuation: a pattern-led candidate first, then a starter.
  if (preferredKey !== null) {
    const keep = candidates.filter((c) => c.key === preferredKey).sort((a, b) => (a.origin === b.origin ? byLeverage(a, b) : a.origin === "pattern" ? -1 : 1));
    if (keep.length > 0) return offer(keep[0], { kind: "KEEP_GOING" });
  }

  // (ii) The person's own data.
  const fromPatterns = candidates.filter((c) => c.origin === "pattern").sort(byLeverage);
  if (fromPatterns.length > 0) return offer(fromPatterns[0], { kind: "PATTERN", patternKind: fromPatterns[0].patternKind as PatternKind });

  // (iii) and (iv) The smallest step first. A goal matches in GOAL_FOCUS_KEYS order; `not_sure` never matches.
  const starters = candidates.filter((c) => c.origin === "starter");
  const chosen = new Set<GoalFocusKey>(input.goalFocus);
  const matchingGoal = (c: Candidate): GoalFocusKey | null => GOAL_FOCUS_KEYS.find((g) => g !== "not_sure" && chosen.has(g) && c.goals.includes(g)) ?? null;
  for (const c of starters) {
    const goal = matchingGoal(c);
    if (goal !== null) return offer(c, lastHelped ? { kind: "NEXT_STEP" } : { kind: "GOAL", goal });
  }
  if (starters.length > 0) return offer(starters[0], lastHelped ? { kind: "NEXT_STEP" } : { kind: "DEFAULT" });

  if (cooledDown) return { kind: "NONE", reason: "cooling_down" };
  return { kind: "NONE", reason: input.mode === "RESET" ? "quiet_week" : "none_eligible" };
}
