import { describe, expect, it, vi } from "vitest";

// The KILL SWITCH of the goal-led starters: they ship ON (experiment.shipped.test.ts pins that); with the constant false the weekly
// decision offers a pattern-led experiment and nothing else. WEEKLY_FLOW is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, starterExperimentsEnabled: false } };
});

import { decideWeeklyExperiment } from "./experiment";
import { WEEKLY_FLOW } from "./types";

describe("decideWeeklyExperiment with the starters switched off", () => {
  const now = new Date("2027-02-01T10:00:00Z");
  const candidate = { kind: "late_evening_meals", patternId: "p1", view: "CANDIDATE", feedback: null, feedbackAt: null } as const;

  it("the mock is in effect", () => {
    expect(WEEKLY_FLOW.starterExperimentsEnabled).toBe(false);
  });

  it("offers a pattern-led experiment and nothing else", () => {
    const decision = decideWeeklyExperiment({ now, mode: "LEARN", patterns: [candidate], history: [], goalFocus: ["lose_weight"] });
    expect(decision).toMatchObject({ kind: "OFFER", origin: "pattern", key: "eat_intentionally", rationale: { kind: "PATTERN" } });
  });

  it("offers nothing new without an established pattern, and says so with a plain reason (even with goals)", () => {
    expect(decideWeeklyExperiment({ now, mode: "LEARN", patterns: [], history: [], goalFocus: ["lose_weight", "improve_eating"] })).toEqual({
      kind: "NONE",
      reason: "none_eligible",
    });
    expect(decideWeeklyExperiment({ now, mode: "LEARN", patterns: [{ ...candidate, view: "EARLY_SIGNAL" }], history: [], goalFocus: [] })).toEqual({
      kind: "NONE",
      reason: "none_eligible",
    });
  });
});
