import { parseSeedArgs, type SeedOptions } from "../../scripts/seed-demo/args";
import { buildSeedPlan, type SeedPlan } from "../../scripts/seed-demo/plan";
import { seedShabbatSeries, toPlanShabbat } from "../../scripts/seed-demo/shabbat";
import { evaluateWeekly, type WeeklyEvaluation } from "../../scripts/seed-demo/weeklyEval";
import { RESULT_TO_DB, type ExperimentResult, type WeeklyExperimentDecision } from "@/domain/weekly";

/**
 * Shared by tests/seed/weeklyPlan.test.ts (the starter experiments switched ON, by a mock) and weeklyPlan.shipped.test.ts (the
 * shipped value, OFF): the presets of 15.2 run through the REAL domain functions at their as-of instant, and the expected values
 * of each row. The blueprint's table is the spec; these rows are what the code gives, checked against it cell by cell.
 */

export type Flags = Record<string, string | number | boolean | string[]>;

export function optionsOf(flags: Flags): SeedOptions {
  const parsed = parseSeedArgs(JSON.stringify(flags));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** A plan computed from scratch, every time (the Shabbat engine is slow, so most tests use `planOf`). */
export function planOfFresh(o: SeedOptions): SeedPlan {
  return buildSeedPlan(o, toPlanShabbat(seedShabbatSeries(o)));
}

const cache = new Map<string, SeedPlan>();

/** The same plan for the same options: it is pure, and nothing in a test mutates it. */
export function planOf(o: SeedOptions): SeedPlan {
  const key = JSON.stringify(o);
  let plan = cache.get(key);
  if (plan === undefined) {
    plan = planOfFresh(o);
    cache.set(key, plan);
  }
  return plan;
}

/** The preset at its own clock (09:00 of the Sunday after the summarised week), with optional extra flags. */
export function evaluatePreset(scenario: string, extra: Flags = {}, opened: ReadonlySet<string> = new Set()) {
  const o = optionsOf({ scenario, ...extra });
  const plan = planOf(o);
  return { o, plan, ev: evaluateWeekly(o, plan, plan.asOf, opened) };
}

/** One word per decision: `OFFER pattern eat_intentionally PATTERN`, `OFFER starter slow_down KEEP_GOING`, `NONE recovering`, `RESULT_DUE eat_intentionally`. */
export function label(decision: WeeklyExperimentDecision): string {
  switch (decision.kind) {
    case "OFFER": {
      const r = decision.rationale;
      return `OFFER ${decision.origin} ${decision.key} ${r.kind}${r.kind === "GOAL" ? ` ${r.goal}` : ""}`;
    }
    case "NONE":
      return `NONE ${decision.reason}`;
    case "RESULT_DUE":
      return `RESULT_DUE ${decision.key}`;
    default:
      return decision.kind;
  }
}

/** w3-result-due with its open experiment answered AT the clock (the answer window of the story is [week end, next week end)). */
export function answeredPreset(result: ExperimentResult) {
  const o = optionsOf({ scenario: "w3-result-due" });
  const plan = planOf(o);
  const db = RESULT_TO_DB[result];
  const experiments = plan.experiments.map((e) => ({ ...e, status: "DONE" as const, endedAt: plan.asOf, tried: db.tried, helpfulness: db.helpfulness }));
  return evaluateWeekly(o, { ...plan, experiments }, plan.asOf);
}

export const readyOf = (ev: WeeklyEvaluation) => {
  if (ev.moment.kind !== "READY" || ev.ready === null) throw new Error("expected a READY weekly moment");
  return { moment: ev.moment, ready: ev.ready };
};

export interface PresetRow {
  asOf: string;
  /** The summarised week (its Sunday). */
  week: string;
  /** The first local day of the window (the transition day is never in it). */
  windowStart: string;
  availableDays: number;
  mealDays: number;
  mode: "CELEBRATE" | "LEARN" | "RECOVER" | "RESET";
  lineKey: string;
  weight: "NONE" | "FIRST" | "BUILDING" | "DOWN" | "STEADY" | "UP";
  patternQuestion: "ASK" | "NONE";
  invite: boolean;
  /** With the starter experiments switched ON. */
  decisionOn: string;
  /** With the shipped value (OFF): a pattern offer is unaffected, a starter becomes `NONE none_eligible`. */
  decisionOff: string;
  /** Home at the clock. */
  home: string;
  /** The opening-line gate under the fixed assumption. */
  gate: "OPEN" | "mode_fixed_text";
}

const STARTER_GOAL = "OFFER starter eat_intentionally GOAL improve_eating";
const NO_STARTER = "NONE none_eligible";

/** Every weekly preset whose weekly moment is READY at its clock (w2-too-short is NONE there and has its own tests). */
export const PRESET_ROWS: Record<string, PresetRow> = {
  "w2-learn": {
    asOf: "2026-09-27T06:00:00.000Z",
    week: "2026-09-20",
    windowStart: "2026-09-21",
    availableDays: 5,
    mealDays: 5,
    mode: "LEARN",
    lineKey: "learn",
    weight: "NONE",
    patternQuestion: "ASK",
    invite: true,
    decisionOn: "OFFER pattern eat_intentionally PATTERN",
    decisionOff: "OFFER pattern eat_intentionally PATTERN",
    home: "WEEKLY_SUMMARY_READY",
    gate: "OPEN",
  },
  "w2-celebrate": {
    asOf: "2026-10-04T06:00:00.000Z",
    week: "2026-09-27",
    windowStart: "2026-09-27",
    availableDays: 6,
    mealDays: 6,
    mode: "CELEBRATE",
    lineKey: "celebrateMilestone",
    weight: "BUILDING",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: STARTER_GOAL,
    decisionOff: NO_STARTER,
    home: "WEEKLY_SUMMARY_READY",
    gate: "mode_fixed_text",
  },
  "w2-recover": {
    asOf: "2026-09-27T06:00:00.000Z",
    week: "2026-09-20",
    windowStart: "2026-09-21",
    availableDays: 5,
    mealDays: 2,
    mode: "RECOVER",
    lineKey: "recover",
    weight: "NONE",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: "NONE recovering",
    decisionOff: "NONE recovering",
    home: "WEEKLY_SUMMARY_READY",
    gate: "mode_fixed_text",
  },
  "w2-quiet-none": {
    asOf: "2026-09-27T06:00:00.000Z",
    week: "2026-09-20",
    windowStart: "2026-09-21",
    availableDays: 5,
    mealDays: 0,
    mode: "RESET",
    lineKey: "quiet",
    weight: "NONE",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: "NONE quiet_week",
    decisionOff: "NONE quiet_week",
    // No report in the window: no card and no link, the plain clock state.
    home: "MORNING",
    gate: "mode_fixed_text",
  },
  "w2-quiet-card": {
    asOf: "2026-09-27T06:00:00.000Z",
    week: "2026-09-20",
    windowStart: "2026-09-21",
    availableDays: 5,
    mealDays: 1,
    mode: "RESET",
    lineKey: "quiet",
    weight: "NONE",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: "NONE quiet_week",
    decisionOff: "NONE quiet_week",
    home: "WEEKLY_SUMMARY_READY",
    gate: "mode_fixed_text",
  },
  "w2-first-weigh-in": {
    asOf: "2026-09-27T06:00:00.000Z",
    week: "2026-09-20",
    windowStart: "2026-09-21",
    availableDays: 5,
    mealDays: 5,
    mode: "LEARN",
    lineKey: "learn",
    weight: "FIRST",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: STARTER_GOAL,
    decisionOff: NO_STARTER,
    home: "WEEKLY_SUMMARY_READY",
    gate: "OPEN",
  },
  "w2-shabbat-rows-missing": {
    asOf: "2026-09-27T06:00:00.000Z",
    week: "2026-09-20",
    windowStart: "2026-09-21",
    // Saturday counts: with no Shabbat rows it is an available day.
    availableDays: 6,
    mealDays: 3,
    mode: "LEARN",
    lineKey: "learn",
    weight: "NONE",
    patternQuestion: "NONE",
    invite: true,
    decisionOn: STARTER_GOAL,
    decisionOff: NO_STARTER,
    home: "WEEKLY_SUMMARY_READY",
    gate: "OPEN",
  },
  "w3-result-due": {
    asOf: "2026-10-04T06:00:00.000Z",
    week: "2026-09-27",
    windowStart: "2026-09-27",
    availableDays: 6,
    mealDays: 6,
    mode: "LEARN",
    lineKey: "learn",
    weight: "NONE",
    patternQuestion: "NONE",
    invite: true,
    decisionOn: "RESULT_DUE eat_intentionally",
    decisionOff: "RESULT_DUE eat_intentionally",
    home: "WEEKLY_SUMMARY_READY",
    gate: "OPEN",
  },
  "w4-history-rotation": {
    asOf: "2026-10-11T06:00:00.000Z",
    week: "2026-10-04",
    windowStart: "2026-10-04",
    availableDays: 6,
    mealDays: 6,
    mode: "LEARN",
    lineKey: "learn",
    weight: "UP",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: "OFFER starter slow_down KEEP_GOING",
    decisionOff: NO_STARTER,
    home: "WEEKLY_SUMMARY_READY",
    gate: "OPEN",
  },
  "w4-down": {
    asOf: "2026-10-11T06:00:00.000Z",
    week: "2026-10-04",
    windowStart: "2026-10-04",
    availableDays: 6,
    mealDays: 6,
    mode: "LEARN",
    lineKey: "learn",
    weight: "DOWN",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: STARTER_GOAL,
    decisionOff: NO_STARTER,
    home: "WEEKLY_SUMMARY_READY",
    gate: "OPEN",
  },
  "w4-goal": {
    asOf: "2026-10-11T06:00:00.000Z",
    week: "2026-10-04",
    windowStart: "2026-10-04",
    availableDays: 6,
    mealDays: 6,
    mode: "CELEBRATE",
    lineKey: "celebrateGoal",
    weight: "DOWN",
    patternQuestion: "NONE",
    invite: false,
    decisionOn: STARTER_GOAL,
    decisionOff: NO_STARTER,
    home: "WEEKLY_SUMMARY_READY",
    gate: "mode_fixed_text",
  },
};
