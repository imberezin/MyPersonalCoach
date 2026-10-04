import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { PATTERN_EXPERIMENT_MAP } from "../experiments/map";
import { INTERVENTIONS, type Constraint, type InterventionKey } from "../interventions/library";
import { GOAL_FOCUS_KEYS, type GoalFocusKey } from "../onboarding/model";
import type { PatternKind } from "../patterns/types";

// The goal-led starters ship OFF (experiment.shipped.test.ts asserts that); these rows run with them ON.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, starterExperimentsEnabled: true } };
});

import { decideWeeklyExperiment, PATTERN_LEVERAGE_ORDER, STARTER_LADDER, type WeeklyExperimentDecision } from "./experiment";
import type { ExperimentRecord, Helpfulness, OpeningMode, PatternSignal } from "./types";

const NOW = new Date("2027-02-01T10:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const EAT = { key: "eat_intentionally", variantId: "default" } as const;
const SLOW = { key: "slow_down", variantId: "utensils_between_bites" } as const;

const row = (over: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
  id: "e1",
  status: "DONE",
  key: EAT.key,
  variantId: EAT.variantId,
  sourcePatternId: null,
  startedAt: daysAgo(30),
  endedAt: daysAgo(10),
  helpfulness: "SOMEWHAT",
  tried: "YES",
  ...over,
});
/** A finished experiment: `which` is EAT or SLOW, `result` a helpfulness or "NO" for "I did not get to try". */
let seq = 0;
const done = (which: typeof EAT | typeof SLOW, result: Helpfulness | "NO", endedDaysAgo: number): ExperimentRecord =>
  row({
    id: `d${seq++}`,
    key: which.key,
    variantId: which.variantId,
    endedAt: daysAgo(endedDaysAgo),
    tried: result === "NO" ? "NO" : "YES",
    helpfulness: result === "NO" ? null : result,
  });
const skipped = (which: typeof EAT | typeof SLOW, endedDaysAgo: number): ExperimentRecord =>
  row({ id: `s${seq++}`, status: "SKIPPED", key: which.key, variantId: which.variantId, helpfulness: null, tried: null, endedAt: daysAgo(endedDaysAgo) });

const pattern = (view: PatternSignal["view"], over: Partial<PatternSignal> = {}): PatternSignal => ({
  kind: "late_evening_meals",
  patternId: "p1",
  view,
  feedback: null,
  feedbackAt: null,
  ...over,
});

function decide(over: Partial<Parameters<typeof decideWeeklyExperiment>[0]> = {}): WeeklyExperimentDecision {
  return decideWeeklyExperiment({ now: NOW, mode: "LEARN", patterns: [], history: [], goalFocus: [], ...over });
}
function offer(d: WeeklyExperimentDecision): Extract<WeeklyExperimentDecision, { kind: "OFFER" }> {
  if (d.kind !== "OFFER") throw new Error(`expected OFFER, got ${JSON.stringify(d)}`);
  return d;
}
const none = (reason: Extract<WeeklyExperimentDecision, { kind: "NONE" }>["reason"]): WeeklyExperimentDecision => ({ kind: "NONE", reason });

describe("decideWeeklyExperiment: an open experiment wins", () => {
  const active = (startedAt: Date | null) => row({ id: "a1", status: "ACTIVE", startedAt, endedAt: null, helpfulness: null, tried: null });

  it("asks the result at exactly 3 x 24 hours and keeps it ACTIVE one millisecond before", () => {
    expect(decide({ history: [active(new Date(NOW.getTime() - 3 * DAY))] })).toEqual({ kind: "RESULT_DUE", experimentId: "a1", key: "eat_intentionally", variantId: "default" });
    expect(decide({ history: [active(new Date(NOW.getTime() - 3 * DAY + 1))] })).toEqual({ kind: "ACTIVE", experimentId: "a1" });
  });

  it("asks the result when the start time is missing (ask, never trap)", () => {
    expect(decide({ history: [active(null)] }).kind).toBe("RESULT_DUE");
  });

  it("carries a null key for a row outside the library", () => {
    expect(decide({ history: [{ ...active(daysAgo(5)), key: null, variantId: null }] })).toEqual({ kind: "RESULT_DUE", experimentId: "a1", key: null, variantId: null });
  });

  it("wins over a pattern, a recovering week and a quiet week", () => {
    for (const mode of ["LEARN", "RECOVER", "RESET", "CELEBRATE"] as const) {
      expect(decide({ mode, patterns: [pattern("VALIDATED")], history: [active(daysAgo(1))] })).toEqual({ kind: "ACTIVE", experimentId: "a1" });
    }
  });

  it("an OFFERED row of any age is PENDING (never a second row)", () => {
    const offered = (id: string) => row({ id, status: "OFFERED", startedAt: null, endedAt: null, helpfulness: null, tried: null });
    expect(decide({ history: [offered("o1")] })).toEqual({ kind: "PENDING", experimentId: "o1" });
    // Even a very old idea waits rather than being replaced, with a VALIDATED pattern or in a quiet week.
    expect(decide({ history: [{ ...offered("o2"), startedAt: daysAgo(400) }], patterns: [pattern("VALIDATED")] })).toEqual({ kind: "PENDING", experimentId: "o2" });
    expect(decide({ mode: "RESET", history: [offered("o3")] })).toEqual({ kind: "PENDING", experimentId: "o3" });
  });

  it("an ACTIVE row beats an OFFERED one", () => {
    const history = [row({ id: "o1", status: "OFFERED", startedAt: null, endedAt: null, helpfulness: null, tried: null }), active(daysAgo(1))];
    expect(decide({ history }).kind).toBe("ACTIVE");
  });
});

describe("decideWeeklyExperiment: the mode", () => {
  it("a RECOVER week gets nothing new, even with a VALIDATED pattern", () => {
    expect(decide({ mode: "RECOVER", patterns: [pattern("VALIDATED")] })).toEqual(none("recovering"));
    expect(decide({ mode: "RECOVER" })).toEqual(none("recovering"));
  });

  it("a RESET (quiet) week drops the starters but keeps a pattern offer", () => {
    expect(offer(decide({ mode: "RESET", patterns: [pattern("CANDIDATE")] })).origin).toBe("pattern");
    expect(decide({ mode: "RESET" })).toEqual(none("quiet_week"));
  });

  it.each(["LEARN", "CELEBRATE"] as const satisfies readonly OpeningMode[])("a %s week may offer a starter", (mode) => {
    expect(offer(decide({ mode })).origin).toBe("starter");
  });
});

describe("decideWeeklyExperiment: choice priority", () => {
  it("a pattern beats a starter, with the PATTERN rationale", () => {
    const d = offer(decide({ patterns: [pattern("CANDIDATE", { patternId: "p9" })], goalFocus: ["lose_weight"] }));
    expect(d).toMatchObject({ origin: "pattern", patternKind: "late_evening_meals", patternId: "p9", key: "eat_intentionally", variantId: "default", scope: "next_meal" });
    expect(d.rationale).toEqual({ kind: "PATTERN", patternKind: "late_evening_meals" });
  });

  it("VALIDATED comes before CANDIDATE", () => {
    const d = offer(decide({ patterns: [pattern("CANDIDATE", { patternId: "weak" }), pattern("VALIDATED", { patternId: "strong" })] }));
    expect(d.patternId).toBe("strong");
  });

  it("a starter whose goals meet the person's goals carries GOAL; the first goal in GOAL_FOCUS_KEYS order is named", () => {
    expect(offer(decide({ goalFocus: ["improve_eating"] })).rationale).toEqual({ kind: "GOAL", goal: "improve_eating" });
    // Both lose_weight and feel_lighter match; GOAL_FOCUS_KEYS lists lose_weight first whatever order the person's goals come in.
    expect(GOAL_FOCUS_KEYS.indexOf("lose_weight")).toBeLessThan(GOAL_FOCUS_KEYS.indexOf("feel_lighter"));
    expect(offer(decide({ goalFocus: ["feel_lighter", "lose_weight"] })).rationale).toEqual({ kind: "GOAL", goal: "lose_weight" });
  });

  it("picks the ladder entry that matches the goal, not just the first", () => {
    const d = offer(decide({ goalFocus: ["understand_overeating"] }));
    expect(d).toMatchObject({ key: "slow_down", variantId: "utensils_between_bites", origin: "starter", rationale: { kind: "GOAL", goal: "understand_overeating" } });
  });

  it("`not_sure`, an empty list and a goal no entry serves are DEFAULT, on the first ladder entry", () => {
    for (const goalFocus of [["not_sure"], [], ["be_active"]] as GoalFocusKey[][]) {
      const d = offer(decide({ goalFocus }));
      expect(d).toMatchObject({ key: "eat_intentionally", rationale: { kind: "DEFAULT" } });
    }
  });

  it("an unfinished loop (the preferred key) beats a pattern and a goal", () => {
    const history = [done(SLOW, "SOMEWHAT", 8)];
    const d = offer(decide({ history, patterns: [pattern("VALIDATED")], goalFocus: ["improve_eating"] }));
    expect(d).toMatchObject({ key: "slow_down", origin: "starter", rationale: { kind: "KEEP_GOING" } });
  });

  it("an unfinished loop on the pattern's key continues as the pattern-led offer", () => {
    const history = [done(EAT, "SOMEWHAT", 8)];
    const d = offer(decide({ history, patterns: [pattern("CANDIDATE", { patternId: "p5" })] }));
    expect(d).toMatchObject({ key: "eat_intentionally", origin: "pattern", patternId: "p5", rationale: { kind: "KEEP_GOING" } });
  });

  it("copies params and constraints instead of sharing the library's objects", () => {
    const d = offer(decide({}));
    expect(d.params).toEqual(INTERVENTIONS[d.key].params);
    expect(d.params).not.toBe(INTERVENTIONS[d.key].params);
    expect(d.constraints).not.toBe(INTERVENTIONS[d.key].constraints);
    expect(d.constraints).toEqual(INTERVENTIONS[d.key].constraints);
  });

  it("carries no text: the sentence is the catalog's", () => {
    expect(Object.keys(offer(decide({})))).not.toContain("text");
    expect(Object.keys(offer(decide({}))).sort()).toEqual(["constraints", "key", "kind", "origin", "params", "patternId", "patternKind", "rationale", "scope", "variantId"]);
  });
});

describe("decideWeeklyExperiment: the pattern's own conditions", () => {
  it.each(["NONE", "EARLY_SIGNAL", "REJECTED"] as const)("a %s pattern is not a candidate (a starter is offered instead)", (view) => {
    expect(offer(decide({ patterns: [pattern(view)] })).origin).toBe("starter");
  });

  it("a pattern the person rejected is dropped even when its view is stale", () => {
    expect(offer(decide({ patterns: [pattern("CANDIDATE", { feedback: "reject", feedbackAt: daysAgo(1) })] })).origin).toBe("starter");
  });

  it("'not sure' inside 14 days drops the pattern and lets a starter through; at 14 days it is offered again", () => {
    const unsure = (n: number) => pattern("CANDIDATE", { feedback: "unsure", feedbackAt: daysAgo(n) });
    expect(offer(decide({ patterns: [unsure(13)] })).origin).toBe("starter");
    expect(offer(decide({ patterns: [unsure(14)] })).origin).toBe("pattern");
    expect(offer(decide({ patterns: [pattern("CANDIDATE", { feedback: "unsure", feedbackAt: null })] })).origin).toBe("starter");
  });

  it("'sounds right' keeps the pattern", () => {
    expect(offer(decide({ patterns: [pattern("VALIDATED", { feedback: "confirm", feedbackAt: daysAgo(2) })] })).origin).toBe("pattern");
  });
});

describe("decideWeeklyExperiment: the cooldown stage", () => {
  it("a declined offer (SKIPPED) cools its key for 13 days and not at 14", () => {
    expect(decide({ history: [skipped(EAT, 13), skipped(SLOW, 13)] })).toEqual(none("cooling_down"));
    expect(offer(decide({ history: [skipped(EAT, 14), skipped(SLOW, 14)] })).key).toBe("eat_intentionally");
  });

  it("only the skipped key is dropped: the other starter is still offered", () => {
    expect(offer(decide({ history: [skipped(EAT, 3)] }))).toMatchObject({ key: "slow_down", rationale: { kind: "DEFAULT" } });
  });

  it("two NOT_REALLY answers in a row cool the key; one does not", () => {
    // Every candidate (the pattern and both starters) is dropped: eat by the run, slow by its own skip.
    expect(decide({ patterns: [pattern("CANDIDATE")], history: [done(EAT, "NOT_REALLY", 2), done(EAT, "NOT_REALLY", 9), skipped(SLOW, 4)] })).toEqual(none("cooling_down"));
    // One NOT_REALLY only excludes the key through rotation, not through the cooldown: the reason is not cooling_down.
    expect(decide({ patterns: [pattern("CANDIDATE")], history: [done(EAT, "NOT_REALLY", 2), done(SLOW, "HELPFUL", 30)] })).toEqual(none("none_eligible"));
  });

  it("a 'did not get to try' answer between two NOT_REALLY neither breaks nor extends the run", () => {
    // Eat is cooling (the run of two), so the preference for the never-tried key cannot bring it back; slow is offered.
    const history = [done(EAT, "NO", 1), done(EAT, "NOT_REALLY", 3), done(EAT, "NOT_REALLY", 9)];
    expect(offer(decide({ history }))).toMatchObject({ key: "slow_down", rationale: { kind: "DEFAULT" } });
  });

  it("a 'did not get to try' answer after one NOT_REALLY does not complete a run", () => {
    // Not trying is neither a failure nor a reason to give up on the idea: the never-tried key is offered once more.
    expect(offer(decide({ history: [done(EAT, "NO", 1), done(EAT, "NOT_REALLY", 3)] }))).toMatchObject({ key: "eat_intentionally", rationale: { kind: "KEEP_GOING" } });
  });

  it("a 'did not get to try' answer alone never puts the key on cooldown", () => {
    expect(offer(decide({ history: [done(EAT, "NO", 1)] })).rationale).toEqual({ kind: "KEEP_GOING" });
  });

  it("a final NONE after the cooldown dropped something says cooling_down even in a quiet week", () => {
    expect(decide({ mode: "RESET", patterns: [pattern("CANDIDATE")], history: [skipped(EAT, 2)] })).toEqual(none("cooling_down"));
  });
});

describe("decideWeeklyExperiment: rotation", () => {
  it("HELPFUL excludes the same key for good and the next offer is NEXT_STEP", () => {
    const d = offer(decide({ history: [done(EAT, "HELPFUL", 9)] }));
    expect(d).toMatchObject({ key: "slow_down", origin: "starter", rationale: { kind: "NEXT_STEP" } });
    // NEXT_STEP also replaces GOAL when the last one helped.
    expect(offer(decide({ history: [done(EAT, "HELPFUL", 9)], goalFocus: ["lose_weight"] })).rationale).toEqual({ kind: "NEXT_STEP" });
  });

  it("a pattern-led offer after a helped experiment keeps the PATTERN rationale", () => {
    const pat = pattern("VALIDATED");
    const d = offer(decide({ patterns: [pat], history: [done(SLOW, "HELPFUL", 9)] }));
    expect(d).toMatchObject({ origin: "pattern", rationale: { kind: "PATTERN", patternKind: "late_evening_meals" } });
  });

  it("a helped key never comes back inside the history that was read: A helped, then B helped, then A is not offered", () => {
    const history = [done(SLOW, "HELPFUL", 5), done(EAT, "HELPFUL", 30)]; // B (slow) is the newest, A (eat) is older
    expect(decide({ history, patterns: [pattern("VALIDATED")] })).toEqual(none("none_eligible"));
    // A pattern candidate for A and a starter A are both dropped; with only the older helped row it is the same.
    expect(decide({ history: [done(SLOW, "SOMEWHAT", 5), done(EAT, "HELPFUL", 30)], patterns: [pattern("VALIDATED")] })).toMatchObject({ kind: "OFFER", key: "slow_down" });
  });

  it("when every key has helped the decision is NONE none_eligible, never a recycled offer", () => {
    expect(decide({ history: [done(EAT, "HELPFUL", 40), done(SLOW, "HELPFUL", 20)] })).toEqual(none("none_eligible"));
  });

  it("a helped key older than the history that was read is eligible again (the stated horizon)", () => {
    expect(offer(decide({ history: [] })).key).toBe("eat_intentionally");
  });

  it("SOMEWHAT prefers the same key once, UNKNOWN too", () => {
    for (const result of ["SOMEWHAT", "UNKNOWN"] as const) {
      expect(offer(decide({ history: [done(SLOW, result, 8)] }))).toMatchObject({ key: "slow_down", rationale: { kind: "KEEP_GOING" } });
    }
  });

  it("rotates on the second inconclusive answer in a row on the same key", () => {
    const d = offer(decide({ history: [done(SLOW, "SOMEWHAT", 8), done(SLOW, "UNKNOWN", 20)] }));
    expect(d).toMatchObject({ key: "eat_intentionally", rationale: { kind: "DEFAULT" } });
    // A different key before it does not rotate.
    expect(offer(decide({ history: [done(SLOW, "SOMEWHAT", 8), done(EAT, "SOMEWHAT", 20)] })).key).toBe("slow_down");
  });

  it("NOT_REALLY excludes the same key now", () => {
    const d = offer(decide({ history: [done(EAT, "NOT_REALLY", 8)], patterns: [pattern("CANDIDATE")] }));
    expect(d).toMatchObject({ key: "slow_down", origin: "starter" });
    expect(decide({ history: [done(EAT, "NOT_REALLY", 8), done(SLOW, "HELPFUL", 30)], patterns: [pattern("CANDIDATE")] })).toEqual(none("none_eligible"));
  });

  it("'did not get to try' prefers the same key once, and rotates on the second in a row", () => {
    expect(offer(decide({ history: [done(SLOW, "NO", 8)] }))).toMatchObject({ key: "slow_down", rationale: { kind: "KEEP_GOING" } });
    expect(offer(decide({ history: [done(SLOW, "NO", 8), done(SLOW, "NO", 20)] }))).toMatchObject({ key: "eat_intentionally", rationale: { kind: "DEFAULT" } });
  });

  it("looks at the most recent DONE by its end time, whatever the order of the rows", () => {
    const older = done(EAT, "NOT_REALLY", 40);
    const newer = done(SLOW, "SOMEWHAT", 5);
    expect(offer(decide({ history: [older, newer] })).key).toBe("slow_down");
    expect(offer(decide({ history: [newer, older] })).key).toBe("slow_down");
  });

  it("a DONE row without a key puts no restriction on anything", () => {
    const keyless = row({ id: "k1", key: null, variantId: null, helpfulness: "NOT_REALLY", endedAt: daysAgo(3) });
    expect(offer(decide({ history: [keyless] })).key).toBe("eat_intentionally");
  });
});

describe("decideWeeklyExperiment: the final NONE", () => {
  it("is none_eligible with no pattern and nothing left", () => {
    expect(decide({ history: [done(EAT, "HELPFUL", 40), done(SLOW, "HELPFUL", 20)], mode: "LEARN" })).toEqual(none("none_eligible"));
  });

  it("is quiet_week for a quiet week with nothing eligible", () => {
    expect(decide({ mode: "RESET" })).toEqual(none("quiet_week"));
  });
});

describe("decideWeeklyExperiment: determinism", () => {
  it("is deterministic and does not mutate its input", () => {
    const input = {
      now: NOW,
      mode: "LEARN" as const,
      patterns: [pattern("CANDIDATE")],
      history: [done(SLOW, "SOMEWHAT", 8), done(EAT, "NOT_REALLY", 30), skipped(EAT, 50)],
      goalFocus: ["lose_weight", "feel_lighter"] as GoalFocusKey[],
    };
    const snapshot = JSON.stringify(input);
    const first = decideWeeklyExperiment(input);
    expect(decideWeeklyExperiment(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("survives an invalid `now` without throwing", () => {
    expect(() => decide({ now: new Date(Number.NaN), history: [done(EAT, "NOT_REALLY", 2)], patterns: [pattern("CANDIDATE", { feedback: "unsure", feedbackAt: daysAgo(30) })] })).not.toThrow();
  });
});

describe("STARTER_LADDER and PATTERN_LEVERAGE_ORDER: the Eligibility stage the weekly decision mirrors", () => {
  const catalogs = [he, en] as unknown as { interventions: Record<string, Record<string, string>> }[];
  const FORBIDDEN: readonly Constraint[] = ["never_as_restriction", "pre_context_only", "no_food_prohibition", "never_compensate", "no_followup_intervention_on_true_hunger"];

  it("is exactly the two proposed entries, smallest step first", () => {
    expect(STARTER_LADDER.map((e) => `${e.key}/${e.variantId}`)).toEqual(["eat_intentionally/default", "slow_down/utensils_between_bites"]);
  });

  it.each(STARTER_LADDER.map((e) => [`${e.key}/${e.variantId}`, e] as const))("%s names an existing key and variant with approved text in both catalogs", (_name, entry) => {
    const def = INTERVENTIONS[entry.key];
    expect(def).toBeDefined();
    expect(def.variants.map((v) => v.id)).toContain(entry.variantId);
    for (const catalog of catalogs) {
      const text = catalog.interventions[entry.key]?.[entry.variantId];
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it.each(STARTER_LADDER.map((e) => [`${e.key}/${e.variantId}`, e] as const))("%s is NORMAL mode, asks the outcome and fits a weekly habit experiment", (_name, entry) => {
    const def = INTERVENTIONS[entry.key];
    const variant = def.variants.find((v) => v.id === entry.variantId);
    expect(def.mode).toBe("NORMAL");
    expect(def.asksOutcome).toBe(true);
    const contexts = variant?.contexts ?? def.contexts;
    expect(contexts.some((c) => c === "HABIT" || c === "ENVIRONMENT")).toBe(true);
    expect(["ANY", "BEFORE_EATING"]).toContain(variant?.eatingPhase ?? def.eatingPhase);
    // The documented, owner-approvable exception to the library's in-the-moment timing: a weekly habit experiment on a page the person opened.
    expect(def.timing).toEqual(["IN_CONTEXT"]);
    for (const constraint of FORBIDDEN) expect(def.constraints).not.toContain(constraint);
  });

  it.each(STARTER_LADDER.map((e) => [`${e.key}/${e.variantId}`, e] as const))("%s has no digit in the approved sentence of either catalog", (_name, entry) => {
    for (const catalog of catalogs) expect(catalog.interventions[entry.key][entry.variantId]).not.toMatch(/\d/);
  });

  it("does not contain check_hunger (its sentence has the number 10 and it is allowed before eating only when hunger is not true)", () => {
    expect(STARTER_LADDER.map((e) => e.key as InterventionKey)).not.toContain("check_hunger");
  });

  it("serves only real onboarding goals, never `not_sure`", () => {
    for (const entry of STARTER_LADDER) {
      for (const goal of entry.goals) expect(GOAL_FOCUS_KEYS).toContain(goal);
      expect(entry.goals).not.toContain("not_sure");
    }
  });

  it("the pattern leverage order covers every pattern kind that has a mapped experiment", () => {
    expect([...PATTERN_LEVERAGE_ORDER].sort()).toEqual((Object.keys(PATTERN_EXPERIMENT_MAP) as PatternKind[]).sort());
  });
});
