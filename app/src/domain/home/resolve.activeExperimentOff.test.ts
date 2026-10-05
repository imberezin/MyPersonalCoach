import { describe, expect, it, vi } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";

// The KILL SWITCH: the card ships ON (resolve.activeExperimentShipped.test.ts pins that), and flipping the constant to false must
// make a loaded fact change nothing on Home. HOME_FEATURES is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, HOME_FEATURES: { ...original.HOME_FEATURES, activeExperimentCard: false } };
});

import { HOME_FEATURES, resolveHome, type HomeFacts } from "./index";

const FACTS: HomeFacts = {
  now: new Date("2027-01-12T10:00:00Z"), // Tuesday 12:00 in Jerusalem
  timeZone: "Asia/Jerusalem",
  offlinePeriods: [],
  hasAnyReport: true,
  lifecycle: "WEEKLY_CYCLE",
  firstWeek: null,
  firstWeekSnoozed: NOT_SNOOZED,
  earlySignal: null,
  quietHours: { kind: "WINDOW", startMinute: 0, endMinute: 480 },
  milestone: null,
  weekly: null,
  activeExperiment: { key: "eat_intentionally", variantId: "default", wording: "A sentence.", locale: "en" },
};

describe("the active-experiment card with the switch off", () => {
  it("the mock is in effect", () => {
    expect(HOME_FEATURES.activeExperimentCard).toBe(false);
  });

  it.each(["2027-01-12T07:00:00Z", "2027-01-12T10:00:00Z", "2027-01-12T18:00:00Z"])("never shows the card at %s, even when a fact is given", (now) => {
    const decision = resolveHome({ ...FACTS, now: new Date(now) });
    expect(decision.state.key).not.toBe("ACTIVE_EXPERIMENT");
    expect(decision.action === null || decision.action.kind !== "THANK_ACTIVE_EXPERIMENT").toBe(true);
  });

  it("falls back to the clock states", () => {
    expect(resolveHome({ ...FACTS, now: new Date("2027-01-12T07:00:00Z") }).state.key).toBe("MORNING");
    expect(resolveHome({ ...FACTS, now: new Date("2027-01-12T18:00:00Z") }).state.key).toBe("EVENING");
    expect(resolveHome(FACTS).state).toEqual({ key: "SILENCE", reason: "NOTHING_TO_SAY" });
  });
});
