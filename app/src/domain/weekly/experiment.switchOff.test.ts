import { describe, expect, it, vi } from "vitest";

// Runs the weekly decision with WEEKLY_FLOW.enabled OFF. WEEKLY_FLOW is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, enabled: false } };
});

import { decideWeeklyExperiment } from "./experiment";

describe("decideWeeklyExperiment with the switch off", () => {
  const now = new Date("2027-02-01T10:00:00Z");
  const candidate = { kind: "late_evening_meals", patternId: "p1", view: "VALIDATED", feedback: null, feedbackAt: null } as const;

  it("says switch_off even for an established pattern", () => {
    expect(decideWeeklyExperiment({ now, mode: "LEARN", patterns: [candidate], history: [], goalFocus: [] })).toEqual({ kind: "NONE", reason: "switch_off" });
  });

  it("says switch_off even when an experiment is ACTIVE (the page and the actions refuse)", () => {
    const active = { id: "a1", status: "ACTIVE", key: "eat_intentionally", variantId: "default", sourcePatternId: null, startedAt: new Date("2027-01-20T10:00:00Z"), endedAt: null, helpfulness: null, tried: null } as const;
    expect(decideWeeklyExperiment({ now, mode: "LEARN", patterns: [], history: [active], goalFocus: [] })).toEqual({ kind: "NONE", reason: "switch_off" });
  });
});
