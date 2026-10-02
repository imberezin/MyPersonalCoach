import { describe, expect, it, vi } from "vitest";

// The AI gate reads the pattern threshold BY REFERENCE: with the Candidate threshold at 4, the gate boundary moves to 4.
vi.mock("../../patternLifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../patternLifecycle")>();
  return { ...actual, PATTERN_THRESHOLDS: { ...actual.PATTERN_THRESHOLDS, candidate: 4 } };
});

import { AI_WORDING } from "./constants";
import { decideWordingGate } from "./gate";

const input = (occurrences: number, distinctDays: number) => ({
  view: "CANDIDATE" as const,
  occurrences,
  distinctDays,
  availableDays: 4,
  ai: { configured: true, dailyCap: 40, allowance: { allowed: true, usedToday: 0 } },
});

describe("AI_WORDING with a changed pattern threshold", () => {
  it("minOccurrences and minDistinctDays follow PATTERN_THRESHOLDS.candidate (not a literal 3)", () => {
    expect(AI_WORDING.minOccurrences).toBe(4);
    expect(AI_WORDING.minDistinctDays).toBe(4);
  });

  it("the gate boundary moves to 4", () => {
    expect(decideWordingGate(input(3, 3))).toEqual({ open: false, reason: "too_few_occurrences" });
    expect(decideWordingGate(input(4, 3))).toEqual({ open: false, reason: "too_few_days" });
    expect(decideWordingGate(input(4, 4))).toEqual({ open: true });
  });
});
