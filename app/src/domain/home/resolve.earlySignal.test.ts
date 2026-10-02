import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../firstWeek";
import { NOT_SNOOZED, type FirstWeekProgress } from "../firstWeekFlow/types";
import type { OfflinePeriod } from "../offline";
import type { EarlySignalDecision } from "../patterns/earlySignal";
import { LATE_EVENING } from "../patterns/types";
import type { QuietHours } from "../quietHours";
import { homeCopyKey, resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2).
const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};

const DUE: EarlySignalDecision = { due: true, level: "EARLY_SIGNAL" };
const NOT_DUE: EarlySignalDecision = { due: false, level: null };
const NO_QUIET: QuietHours = { kind: "NONE" };
const DEFAULT_QUIET: QuietHours = { kind: "WINDOW", startMinute: 0, endMinute: 480 }; // 00:00 to 08:00

const KEEP_GOING: FirstWeekProgress = { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 };
// During FIRST_WEEK the first-report invitation keys on confirmed meals, so a fixture with no report at all has none.
const NO_MEALS_YET: FirstWeekProgress = { availableDays: 2, confirmedMeals: 0, availableDaysSinceLastMeal: null };
const READY: FirstWeekProgress = { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 };
const WELCOME_BACK: FirstWeekProgress = { availableDays: 3, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };

// Tuesday 2027-01-12 (UTC+2). `at("10:00")` is 10:00 local.
const at = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2027, 0, 12, h - 2, m)).toISOString();
};

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [WINTER_SHABBAT],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: overrides.hasAnyReport === false ? NO_MEALS_YET : KEEP_GOING,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: DUE,
    quietHours: NO_QUIET,
    milestone: null,
    ...overrides,
  };
}

function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

describe("resolveHome: the Early Signal card (B4)", () => {
  it("shows when the data says due, at 10:00, with no quiet hours", () => {
    const decision = resolveHome(facts(at("10:00")));
    expect(decision.state).toEqual({ key: "EARLY_SIGNAL", signal: "late_evening_meals" });
    expect(decision.action).toEqual({ kind: "ANSWER_EARLY_SIGNAL" });
    expect(decision.degraded).toBe(false);
  });

  it("shows for a Candidate level too", () => {
    expect(resolveHome(facts(at("10:00"), { earlySignal: { due: true, level: "CANDIDATE" } })).state.key).toBe("EARLY_SIGNAL");
  });

  it("maps to its copy key", () => {
    expect(homeCopyKey(resolveHome(facts(at("10:00"))).state)).toBe("earlySignalLateEvening");
  });

  it("carries the signal's own kind", () => {
    expect(LATE_EVENING.kind).toBe("late_evening_meals");
  });
});

describe("resolveHome: Early Signal precedence", () => {
  it.each([
    ["Shabbat in progress", "2027-01-09T10:00:00Z", "SILENCE/OFFLINE:SHABBAT"],
    ["Before Shabbat", "2027-01-08T12:00:00Z", "BEFORE_SHABBAT"],
    ["Motzei Shabbat", "2027-01-09T16:00:00Z", "MOTZEI_SHABBAT"],
  ])("is beaten by %s", (_name, now, expected) => {
    expect(label(resolveHome(facts(now)).state)).toBe(expected);
  });

  it("is beaten by any offline period in progress", () => {
    const vacation: OfflinePeriod = { type: "VACATION", start: new Date("2027-01-11T00:00:00Z"), end: new Date("2027-01-14T00:00:00Z") };
    expect(label(resolveHome(facts(at("10:00"), { offlinePeriods: [vacation] })).state)).toBe("SILENCE/OFFLINE:VACATION");
  });

  it("is beaten by a ready summary and by a welcome-back", () => {
    expect(resolveHome(facts(at("10:00"), { firstWeek: READY })).state.key).toBe("FIRST_WEEK_SUMMARY_READY");
    expect(resolveHome(facts(at("10:00"), { firstWeek: WELCOME_BACK })).state.key).toBe("FIRST_WEEK_WELCOME_BACK");
  });

  it("lets a snoozed summary through to it, and a snoozed welcome-back too", () => {
    expect(resolveHome(facts(at("10:00"), { firstWeek: READY, firstWeekSnoozed: { summary: true, welcomeBack: false } })).state.key).toBe(
      "EARLY_SIGNAL",
    );
    expect(resolveHome(facts(at("10:00"), { firstWeek: WELCOME_BACK, firstWeekSnoozed: { summary: false, welcomeBack: true } })).state.key).toBe(
      "EARLY_SIGNAL",
    );
  });

  it("beats First Week Start (they cannot both be true in real data, but the order is pinned)", () => {
    expect(resolveHome(facts(at("10:00"), { hasAnyReport: false })).state.key).toBe("EARLY_SIGNAL");
  });

  it("beats the morning, the evening and silence", () => {
    expect(resolveHome(facts(at("07:00"))).state.key).toBe("EARLY_SIGNAL"); // MORNING otherwise
    expect(resolveHome(facts(at("19:00"))).state.key).toBe("EARLY_SIGNAL"); // EVENING otherwise
    expect(resolveHome(facts(at("13:00"))).state.key).toBe("EARLY_SIGNAL"); // SILENCE otherwise
    expect(label(resolveHome(facts(at("07:00"), { earlySignal: NOT_DUE })).state)).toBe("MORNING");
    expect(label(resolveHome(facts(at("19:00"), { earlySignal: NOT_DUE })).state)).toBe("EVENING");
  });
});

describe("resolveHome: Early Signal and the quiet hours", () => {
  it("is not shown at 07:59 inside the default quiet hours, and is shown at 08:00", () => {
    expect(label(resolveHome(facts(at("07:59"), { quietHours: DEFAULT_QUIET })).state)).toBe("MORNING");
    expect(resolveHome(facts(at("08:00"), { quietHours: DEFAULT_QUIET })).state.key).toBe("EARLY_SIGNAL");
  });

  it("is not shown at 00:00 or 03:00 inside the quiet hours", () => {
    for (const time of ["00:00", "03:00"]) {
      expect(resolveHome(facts(at(time), { quietHours: DEFAULT_QUIET })).state.key).not.toBe("EARLY_SIGNAL");
    }
  });

  it("is not shown when the quiet hours are unknown (better silent than intrusive)", () => {
    const decision = resolveHome(facts(at("10:00"), { quietHours: null }));
    expect(decision.state.key).not.toBe("EARLY_SIGNAL");
    expect(decision.degraded).toBe(false);
  });

  it("is shown when the person has no quiet hours, even in the small hours", () => {
    expect(resolveHome(facts(at("06:00"), { quietHours: NO_QUIET })).state.key).toBe("EARLY_SIGNAL");
  });

  it("respects a quiet window that wraps midnight", () => {
    const wrapping: QuietHours = { kind: "WINDOW", startMinute: 1320, endMinute: 420 }; // 22:00 to 07:00
    expect(resolveHome(facts(at("06:59"), { quietHours: wrapping })).state.key).not.toBe("EARLY_SIGNAL");
    expect(resolveHome(facts(at("07:00"), { quietHours: wrapping })).state.key).toBe("EARLY_SIGNAL");
  });
});

describe("resolveHome: Early Signal and the signal's own hours", () => {
  it("is shown at 20:59, and not at 21:00 or 23:59 (the clock state shows instead)", () => {
    expect(resolveHome(facts(at("20:59"))).state.key).toBe("EARLY_SIGNAL");
    expect(resolveHome(facts(at("21:00"))).state).toEqual({ key: "EVENING" });
    expect(resolveHome(facts(at("23:59"))).state).toEqual({ key: "EVENING" });
  });

  it("is not shown at 21:00 even with no quiet hours and a Candidate level", () => {
    expect(resolveHome(facts(at("21:00"), { earlySignal: { due: true, level: "CANDIDATE" } })).state.key).not.toBe("EARLY_SIGNAL");
  });
});

describe("resolveHome: Early Signal needs the data and the lifecycle", () => {
  it("falls to the clock states when the signal is unknown or not due", () => {
    expect(label(resolveHome(facts(at("13:00"), { earlySignal: null })).state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(label(resolveHome(facts(at("13:00"), { earlySignal: NOT_DUE })).state)).toBe("SILENCE/NOTHING_TO_SAY");
  });

  it("does not degrade the decision when the signal or the quiet hours are unknown", () => {
    expect(resolveHome(facts(at("10:00"), { earlySignal: null })).degraded).toBe(false);
    expect(resolveHome(facts(at("10:00"), { quietHours: null })).degraded).toBe(false);
  });

  it.each<LifecycleState | null>(["WEEKLY_CYCLE", "ONBOARDING", "NEW", null])("never shows for the lifecycle %s", (lifecycle) => {
    const decision = resolveHome(facts(at("10:00"), { lifecycle, firstWeek: null }));
    expect(decision.state.key).not.toBe("EARLY_SIGNAL");
    expect(decision.action).toBeNull();
  });

  it("is not an invitation: the card has its own action and never the first-report one", () => {
    const decision = resolveHome(facts(at("10:00"), { hasAnyReport: false }));
    expect(decision.action).toEqual({ kind: "ANSWER_EARLY_SIGNAL" });
  });
});

describe("resolveHome: Early Signal and daylight saving time", () => {
  it.each([
    ["spring forward 2027-03-26, 12:00 IDT", "2027-03-26T09:00:00Z", true],
    ["spring forward 2027-03-26, 21:00 IDT", "2027-03-26T18:00:00Z", false],
    ["spring forward 2027-03-26, 08:00 IDT", "2027-03-26T05:00:00Z", true],
    ["spring forward 2027-03-26, 07:59 IDT", "2027-03-26T04:59:00Z", false],
    ["fall back 2026-10-25, 12:00 IST", "2026-10-25T10:00:00Z", true],
    ["fall back 2026-10-25, 20:59 IST", "2026-10-25T18:59:00Z", true],
    ["fall back 2026-10-25, 21:00 IST", "2026-10-25T19:00:00Z", false],
    ["fall back 2026-10-25, the repeated 01:30", "2026-10-24T23:30:00Z", false],
  ])("on %s the card is shown: %s", (_name, now, shown) => {
    const decision = resolveHome(facts(now, { offlinePeriods: [], quietHours: DEFAULT_QUIET }));
    expect(decision.state.key === "EARLY_SIGNAL").toBe(shown);
  });
});
