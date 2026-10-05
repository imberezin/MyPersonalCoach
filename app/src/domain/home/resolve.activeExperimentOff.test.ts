import { describe, expect, it } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import { HOME_FEATURES, resolveHome, type HomeFacts } from "./index";

// No mock here: this is the SHIPPED value of the switch. The card ships OFF, so a loaded fact changes nothing on Home until the
// owner approves the copy and the constant is flipped (resolve.activeExperiment.test.ts runs the same facts with it ON).

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

describe("the active-experiment card switch", () => {
  it("ships OFF", () => {
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

  it("is a one-line change: the same facts show the card as soon as the constant is true", () => {
    // Pinned by resolve.activeExperiment.test.ts ("shows the card at 12:00"), which mocks exactly this one key.
    expect(Object.keys(HOME_FEATURES)).toContain("activeExperimentCard");
  });
});
