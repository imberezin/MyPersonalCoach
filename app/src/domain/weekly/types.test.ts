import { describe, expect, it } from "vitest";
import { FIRST_WEEK_RECOVERY } from "../firstWeekFlow/types";
import { HOME_TIMING } from "../home/types";
import { INTERVENTION_RULES } from "../interventions/library";
import {
  RESULT_TO_DB,
  resultFromAnswer,
  WEEKLY_FLOW,
  WEEKLY_LIMITS,
  WEEKLY_QUERY,
  WEEKLY_ROUTES,
  WEEKLY_SNOOZE,
  WEEKLY_THRESHOLDS,
  WEEKLY_TIMING,
  WEEKLY_WEIGHT,
} from "./types";

describe("the weekly constants are tied to the constants they mirror", () => {
  it("returnGapAvailableDays is the First Week's recovery gap", () => {
    expect(WEEKLY_THRESHOLDS.returnGapAvailableDays).toBe(FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal);
  });

  it("offerCooldownDays is the library's cooldown", () => {
    expect(WEEKLY_THRESHOLDS.offerCooldownDays).toBe(INTERVENTION_RULES.cooldownDays);
  });

  it("readyMinute is the start of Home's Morning (05:00)", () => {
    expect(WEEKLY_TIMING.readyMinute).toBe(HOME_TIMING.morningStartMinute);
    expect(WEEKLY_TIMING.readyMinute).toBe(300);
  });
});

describe("the SHIPPED switches and values (a flipped default fails here)", () => {
  it("ships the goal-led starters OFF and the other four switches ON", () => {
    expect(WEEKLY_FLOW).toEqual({
      enabled: true,
      patternQuestionEnabled: true,
      starterExperimentsEnabled: false,
      aiLineEnabled: true,
      weightLineEnabled: true,
    });
  });

  it("pins WEEKLY_TIMING", () => {
    expect(WEEKLY_TIMING).toEqual({ readyMinute: 300, cardVisibleDays: 3, minAvailableDaysInWindow: 4, snoozeHours: 24, aggregatedReportLeadHours: 36 });
  });

  it("pins WEEKLY_THRESHOLDS, WEEKLY_WEIGHT and WEEKLY_LIMITS", () => {
    expect(WEEKLY_THRESHOLDS).toEqual({ minMealDays: 3, returnGapAvailableDays: 3, trialDays: 3, offerCooldownDays: 14 });
    expect(WEEKLY_WEIGHT).toEqual({ inviteAfterDays: 14 });
    expect(WEEKLY_LIMITS).toEqual({ meals: 300, periods: 120, periodsLookbackDays: 28, experiments: 20, snooze: 10 });
  });

  it("pins the route, the snooze event and the failed query", () => {
    expect(WEEKLY_ROUTES.week).toBe("/week");
    expect(WEEKLY_SNOOZE.event).toBe("weekly_card_snoozed");
    expect(WEEKLY_QUERY.failed).toBe("failed");
  });
});

describe("RESULT_TO_DB", () => {
  it("maps every answer to its database form; 'not tried' has no helpfulness (not applicable) and is not 'unknown'", () => {
    expect(RESULT_TO_DB).toEqual({
      helpful: { tried: "YES", helpfulness: "HELPFUL" },
      somewhat: { tried: "YES", helpfulness: "SOMEWHAT" },
      not_really: { tried: "YES", helpfulness: "NOT_REALLY" },
      unknown: { tried: "YES", helpfulness: "UNKNOWN" },
      not_tried: { tried: "NO", helpfulness: null },
    });
  });

  it("satisfies the migration's CHECK: tried NO exactly when helpfulness is null", () => {
    for (const { tried, helpfulness } of Object.values(RESULT_TO_DB)) expect(tried === "NO").toBe(helpfulness === null);
  });
});

describe("resultFromAnswer", () => {
  it.each(["helpful", "somewhat", "not_really", "unknown", "not_tried"] as const)("accepts %s", (answer) => {
    expect(resultFromAnswer(answer)).toBe(answer);
  });

  it.each([
    ["an empty string", ""],
    ["the wrong case", "Helpful"],
    ["a padded value", " helpful"],
    ["a database value", "HELPFUL"],
    ["an unknown word", "great"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
    ["an array", ["helpful"]],
    ["an object", { result: "helpful" }],
    ["a file", new Blob(["helpful"])],
    ["a prototype key", "constructor"],
  ])("rejects %s", (_label, answer) => {
    expect(resultFromAnswer(answer)).toBeNull();
  });
});
