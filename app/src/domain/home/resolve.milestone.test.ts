import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../firstWeek";
import { NOT_SNOOZED, type FirstWeekProgress } from "../firstWeekFlow/types";
import type { OfflinePeriod } from "../offline";
import type { MilestoneMoment } from "../weight/milestoneProgress";
import { homeCopyKey, resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2).
const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};

// Ordinary Tuesday 2027-01-12 (local = UTC+2).
const SILENCE_HOUR = "2027-01-12T10:00:00Z"; // 12:00, the clock alone says silence
const MORNING = "2027-01-12T05:00:00Z"; // 07:00
const EVENING = "2027-01-12T17:00:00Z"; // 19:00
const SMALL_HOURS = "2027-01-12T01:00:00Z"; // 03:00

const KEEP_GOING: FirstWeekProgress = { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 };
const NO_MEALS_YET: FirstWeekProgress = { availableDays: 2, confirmedMeals: 0, availableDaysSinceLastMeal: null };
const READY_ENOUGH: FirstWeekProgress = { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 };
const WELCOME_BACK: FirstWeekProgress = { availableDays: 3, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };

const MOMENT: MilestoneMoment = { week: "2026-10-18", isGoal: false };
const GOAL_MOMENT: MilestoneMoment = { week: "2026-10-25", isGoal: true };

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [WINTER_SHABBAT],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: KEEP_GOING,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: MOMENT,
    weekly: null,
    activeExperiment: null,
    ...overrides,
  };
}

function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

describe("resolveHome: the milestone moment (row 5a)", () => {
  it("shows the state with its week and the OPEN_PROGRESS action", () => {
    const decision = resolveHome(facts(SILENCE_HOUR));
    expect(decision.state).toEqual({ key: "MILESTONE_REACHED", week: "2026-10-18", isGoal: false });
    expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-18" });
    expect(decision.degraded).toBe(false);
  });

  it("carries the goal flag and the week of the moment it was given", () => {
    const decision = resolveHome(facts(SILENCE_HOUR, { milestone: GOAL_MOMENT }));
    expect(decision.state).toEqual({ key: "MILESTONE_REACHED", week: "2026-10-25", isGoal: true });
    expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-25" });
  });

  it("picks the goal wording by isGoal", () => {
    expect(homeCopyKey(resolveHome(facts(SILENCE_HOUR)).state)).toBe("milestoneReached");
    expect(homeCopyKey(resolveHome(facts(SILENCE_HOUR, { milestone: GOAL_MOMENT })).state)).toBe("milestoneGoalReached");
  });

  it("does nothing when there is no moment", () => {
    expect(resolveHome(facts(SILENCE_HOUR, { milestone: null })).state.key).not.toBe("MILESTONE_REACHED");
  });

  it.each([
    ["the small hours", SMALL_HOURS],
    ["the morning", MORNING],
    ["midday (silence)", SILENCE_HOUR],
    ["the evening", EVENING],
  ])("beats the clock states: %s", (_name, now) => {
    expect(resolveHome(facts(now)).state.key).toBe("MILESTONE_REACHED");
  });

  it.each<LifecycleState | null>(["FIRST_WEEK", "WEEKLY_CYCLE", "ONBOARDING", "NEW", null])(
    "is independent of the lifecycle (%s)",
    (lifecycle) => {
      const decision = resolveHome(facts(SILENCE_HOUR, { lifecycle, firstWeek: null }));
      expect(decision.state.key).toBe("MILESTONE_REACHED");
      expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-18" });
    },
  );

  it("shows even when the Shabbat periods are unknown (the card is not about Shabbat)", () => {
    const decision = resolveHome(facts(SILENCE_HOUR, { offlinePeriods: null }));
    expect(decision.state.key).toBe("MILESTONE_REACHED");
    expect(decision.degraded).toBe(true);
  });
});

describe("resolveHome: what the milestone moment yields to", () => {
  it("yields to a Shabbat in progress, and offers no action there", () => {
    const decision = resolveHome(facts("2027-01-08T17:00:00Z"));
    expect(label(decision.state)).toBe("SILENCE/OFFLINE:SHABBAT");
    expect(decision.action).toBeNull();
  });

  it("yields to any offline period in progress", () => {
    const holiday: OfflinePeriod = { type: "HOLIDAY", start: new Date("2027-04-21T15:00:00Z"), end: new Date("2027-04-22T17:00:00Z") };
    expect(label(resolveHome(facts("2027-04-22T08:00:00Z", { offlinePeriods: [holiday] })).state)).toBe("SILENCE/OFFLINE:HOLIDAY");
  });

  it("yields to the hours before Shabbat", () => {
    const decision = resolveHome(facts("2027-01-08T12:00:00Z")); // 14:00 Friday
    expect(decision.state).toEqual({ key: "BEFORE_SHABBAT", candleLighting: WINTER_SHABBAT.start });
    expect(decision.action).toBeNull(); // the report fact says reported, so no invitation either
  });

  it("yields to Motzei Shabbat", () => {
    const decision = resolveHome(facts("2027-01-09T16:00:00Z")); // 18:00 Saturday
    expect(decision.state).toEqual({ key: "MOTZEI_SHABBAT", havdalah: WINTER_SHABBAT.end });
  });

  it("and shows afterwards, once the Motzei window has passed", () => {
    expect(resolveHome(facts("2027-01-09T21:25:00Z")).state.key).toBe("MILESTONE_REACHED"); // 23:25 Saturday
  });

  it("yields to the First Week summary when it is ready", () => {
    const decision = resolveHome(facts(SILENCE_HOUR, { firstWeek: READY_ENOUGH }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: true });
    expect(decision.action).toEqual({ kind: "OPEN_FIRST_WEEK_SUMMARY" });
  });

  it("yields to the welcome-back", () => {
    const decision = resolveHome(facts(SILENCE_HOUR, { firstWeek: WELCOME_BACK }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_WELCOME_BACK" });
  });

  it("shows once the person pressed 'Not now' on the First Week card (a snoozed card does not hide it forever)", () => {
    const snoozedSummary = resolveHome(facts(SILENCE_HOUR, { firstWeek: READY_ENOUGH, firstWeekSnoozed: { summary: true, welcomeBack: false } }));
    expect(snoozedSummary.state.key).toBe("MILESTONE_REACHED");
    const snoozedWelcome = resolveHome(facts(SILENCE_HOUR, { firstWeek: WELCOME_BACK, firstWeekSnoozed: { summary: false, welcomeBack: true } }));
    expect(snoozedWelcome.state.key).toBe("MILESTONE_REACHED");
  });

  it("beats the Early Signal question, even when it is due and its hours are open", () => {
    const decision = resolveHome(facts(MORNING, { earlySignal: { due: true, level: "EARLY_SIGNAL" }, quietHours: { kind: "NONE" } }));
    expect(decision.state.key).toBe("MILESTONE_REACHED");
    expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-18" });
  });

  it("beats First Week Start, also for a person whose only report is a weight", () => {
    // hasAnyReport true + no confirmed meal is exactly where B1 still fires (6.5); the moment still wins.
    expect(resolveHome(facts(SILENCE_HOUR, { hasAnyReport: true, firstWeek: NO_MEALS_YET })).state.key).toBe("MILESTONE_REACHED");
    expect(resolveHome(facts(SILENCE_HOUR, { hasAnyReport: false, firstWeek: NO_MEALS_YET })).state.key).toBe("MILESTONE_REACHED");
  });
});

describe("resolveHome: the milestone moment's action and degraded flag", () => {
  it("never carries the first-report invitation, even with no report at all", () => {
    for (const now of [MORNING, EVENING, SILENCE_HOUR]) {
      const decision = resolveHome(facts(now, { hasAnyReport: false, firstWeek: NO_MEALS_YET }));
      expect(decision.state.key).toBe("MILESTONE_REACHED");
      expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-18" });
    }
  });

  it("keeps its action when the report fact is unknown (the card has its own action)", () => {
    const decision = resolveHome(facts(SILENCE_HOUR, { hasAnyReport: null }));
    expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-18" });
  });

  it("does not change `degraded`: the same facts without the moment degrade the same way", () => {
    for (const overrides of [{}, { hasAnyReport: null }, { offlinePeriods: null }, { lifecycle: "FIRST_WEEK" as const, firstWeek: null }]) {
      expect(resolveHome(facts(SILENCE_HOUR, overrides)).degraded).toBe(resolveHome(facts(SILENCE_HOUR, { ...overrides, milestone: null })).degraded);
    }
  });

  it("leaves every other state exactly as it was when the moment is absent", () => {
    for (const now of [SMALL_HOURS, MORNING, SILENCE_HOUR, EVENING, "2027-01-08T12:00:00Z", "2027-01-08T17:00:00Z", "2027-01-09T16:00:00Z"]) {
      const without = resolveHome(facts(now, { milestone: null }));
      expect(without.state.key).not.toBe("MILESTONE_REACHED");
      expect(without.action === null || without.action.kind !== "OPEN_PROGRESS").toBe(true);
    }
  });
});
