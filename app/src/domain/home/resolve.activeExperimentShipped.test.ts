import { describe, expect, it } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import { HOME_FEATURES, resolveHome, type HomeFacts } from "./index";

// No mock here: this is the SHIPPED value of the switch. The owner saw the card and turned it on (2026-10-05).
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

describe("the active-experiment card switch as shipped", () => {
  it("ships ON", () => {
    expect(HOME_FEATURES.activeExperimentCard).toBe(true);
  });

  it("shows the card at midday when an experiment is active and nothing else has a claim", () => {
    const decision = resolveHome(FACTS);
    expect(decision.state.key).toBe("ACTIVE_EXPERIMENT");
    expect(decision.action).toEqual({ kind: "THANK_ACTIVE_EXPERIMENT" });
  });

  it("stays silent about it in quiet hours", () => {
    const decision = resolveHome({ ...FACTS, now: new Date("2027-01-12T01:00:00Z") }); // 03:00 in Jerusalem
    expect(decision.state.key).not.toBe("ACTIVE_EXPERIMENT");
  });
});
