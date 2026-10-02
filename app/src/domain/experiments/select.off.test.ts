import { describe, expect, it, vi } from "vitest";

// Runs the selection with PATTERN_FLOW.experimentEnabled OFF. PATTERN_FLOW is a `const`, so the module is mocked.
vi.mock("../patterns/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("../patterns/types")>();
  return { ...original, PATTERN_FLOW: { ...original.PATTERN_FLOW, experimentEnabled: false } };
});

import { selectFirstExperiment } from "./select";

describe("selectFirstExperiment with the switch off", () => {
  const now = new Date("2027-02-01T10:00:00Z");
  const candidate = { patternId: "p1", kind: "late_evening_meals", view: "CANDIDATE", feedback: null, feedbackAt: null } as const;

  it("says switch_off even for an established pattern", () => {
    expect(selectFirstExperiment({ patterns: [candidate], experiments: [], now })).toEqual({ kind: "NONE", reason: "switch_off" });
  });

  it("says switch_off even when an experiment is ACTIVE or OFFERED (the page and the actions refuse)", () => {
    for (const status of ["ACTIVE", "OFFERED"] as const) {
      const experiments = [{ id: "e1", status, sourcePatternId: "p1", endedAt: null }];
      expect(selectFirstExperiment({ patterns: [candidate], experiments, now })).toEqual({ kind: "NONE", reason: "switch_off" });
    }
  });
});
