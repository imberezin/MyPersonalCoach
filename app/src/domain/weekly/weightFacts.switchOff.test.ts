import { describe, expect, it, vi } from "vitest";

// Runs the weekly weight facts with WEEKLY_FLOW.weightLineEnabled OFF. WEEKLY_FLOW is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, weightLineEnabled: false } };
});

import { weeklyWeightFacts } from "./weightFacts";

describe("weeklyWeightFacts with the weight line switched off", () => {
  it("is unknown: no line, no milestone, no invitation, whatever the entries say", () => {
    const start = new Date("2027-01-02T22:00:00Z");
    const facts = weeklyWeightFacts({
      entries: [{ id: "e1", weightKg: 78, measuredAt: new Date("2027-01-04T06:00:00Z") }],
      truncated: false,
      week: { weekStart: "2027-01-03", start, end: new Date("2027-01-09T22:00:00Z") },
      windowStart: start,
      timeZone: "Asia/Jerusalem",
      now: new Date("2027-01-10T03:00:00Z"),
      profile: { startWeightKg: 80, goalWeightKg: 72, goalType: "numeric" },
    });
    expect(facts).toEqual({
      known: false,
      line: { kind: "NONE" },
      milestone: null,
      weighedThisWeek: false,
      lastEntryAt: null,
      hasBaselineOrEntry: false,
    });
  });
});
