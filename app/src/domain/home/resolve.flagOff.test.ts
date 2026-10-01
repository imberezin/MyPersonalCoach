import { describe, expect, it, vi } from "vitest";
import type { OfflinePeriod } from "../offline";

// Runs the resolver with the first-report switch OFF. HOME_FEATURES is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./types")>()),
  HOME_FEATURES: { firstReportInvitation: false },
}));

import { resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2).
const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return { now: new Date(now), timeZone: TZ, offlinePeriods: [WINTER_SHABBAT], hasAnyReport: true, ...overrides };
}

function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

describe("resolveHome with the first-report invitation switched off", () => {
  it("never shows First Week Start and offers no action at midday with no report", () => {
    const decision = resolveHome(facts("2027-01-12T10:00:00Z", { hasAnyReport: false }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(decision.action).toBeNull();
  });

  it("falls back to the morning (no First Week Start) with no report, and offers no action", () => {
    const decision = resolveHome(facts("2027-01-12T07:00:00Z", { hasAnyReport: false }));
    expect(decision.state.key).toBe("MORNING");
    expect(decision.action).toBeNull();
  });

  it.each([
    ["BEFORE_SHABBAT", "2027-01-08T12:00:00Z"], // 14:00 Fri
    ["MOTZEI_SHABBAT", "2027-01-09T16:00:00Z"], // 18:00 Sat
  ])("keeps %s but offers no action when no report exists", (key, now) => {
    const decision = resolveHome(facts(now, { hasAnyReport: false }));
    expect(decision.state.key).toBe(key);
    expect(decision.action).toBeNull();
  });
});
