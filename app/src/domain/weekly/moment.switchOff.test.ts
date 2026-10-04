import { describe, expect, it, vi } from "vitest";

// Runs the moment with WEEKLY_FLOW.enabled OFF. WEEKLY_FLOW is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, enabled: false } };
});

import { decideWeeklyMoment, weeklyCardPrecheck } from "./moment";

describe("the weekly moment with the switch off", () => {
  const now = new Date("2026-10-18T02:00:00Z");

  it("says switch_off even for a person who is ready", () => {
    expect(
      decideWeeklyMoment({
        now,
        timeZone: "Asia/Jerusalem",
        lifecycle: "WEEKLY_CYCLE",
        firstWeekEndedAt: new Date("2026-09-20T07:00:00Z"),
        periods: [],
        aggregatedReportConfirmedAt: null,
      }),
    ).toEqual({ kind: "NONE", reason: "switch_off" });
  });

  it("has no card window", () => {
    expect(weeklyCardPrecheck({ now, timeZone: "Asia/Jerusalem", aggregatedReportConfirmedAt: null })).toBeNull();
  });
});
