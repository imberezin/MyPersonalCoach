import { describe, expect, it } from "vitest";
import { decideWeeklyExperiment } from "./experiment";
import { WEEKLY_FLOW } from "./types";

// No mock here: this is the SHIPPED configuration. The owner approved both goal-led starters on 2026-10-05.
describe("decideWeeklyExperiment as shipped (starters on)", () => {
  const now = new Date("2027-02-01T10:00:00Z");
  const candidate = { kind: "late_evening_meals", patternId: "p1", view: "CANDIDATE", feedback: null, feedbackAt: null } as const;

  it("ships the starters on", () => {
    expect(WEEKLY_FLOW.starterExperimentsEnabled).toBe(true);
  });

  it("still prefers the pattern-led experiment when one exists", () => {
    const decision = decideWeeklyExperiment({ now, mode: "LEARN", patterns: [candidate], history: [], goalFocus: ["lose_weight"] });
    expect(decision).toMatchObject({ kind: "OFFER", origin: "pattern", key: "eat_intentionally", rationale: { kind: "PATTERN" } });
  });

  it("offers the smallest starter that matches a goal when there is no established pattern", () => {
    const decision = decideWeeklyExperiment({ now, mode: "LEARN", patterns: [], history: [], goalFocus: ["improve_eating"] });
    expect(decision).toMatchObject({ kind: "OFFER", origin: "starter", key: "eat_intentionally" });
  });

  it("falls back to the smallest step when there is no pattern and no goal to follow", () => {
    expect(decideWeeklyExperiment({ now, mode: "LEARN", patterns: [], history: [], goalFocus: [] })).toMatchObject({
      kind: "OFFER",
      origin: "starter",
      key: "eat_intentionally",
      rationale: { kind: "DEFAULT" },
    });
  });

  it("says nothing new in a quiet week", () => {
    expect(decideWeeklyExperiment({ now, mode: "RESET", patterns: [], history: [], goalFocus: ["improve_eating"] })).toMatchObject({ kind: "NONE" });
  });
});
