import { describe, expect, it, vi } from "vitest";
import type { LifecycleState } from "../firstWeek";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import type { OfflinePeriod } from "../offline";
import type { QuietHours } from "../quietHours";

// Runs the resolver with the active-experiment card switched ON (it ships OFF; resolve.activeExperimentOff.test.ts pins that).
// HOME_FEATURES is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, HOME_FEATURES: { ...original.HOME_FEATURES, activeExperimentCard: true } };
});

import { homeCopyKey, resolveHome, type ActiveExperimentFact, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2).
const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};

// Ordinary Tuesday 2027-01-12 (local = UTC+2).
const at = (local: string) => {
  const [hour, minute] = local.split(":").map(Number);
  return new Date(Date.UTC(2027, 0, 12, hour, minute) - 2 * 3_600_000).toISOString();
};
const DEFAULT_QUIET: QuietHours = { kind: "WINDOW", startMinute: 0, endMinute: 480 }; // 00:00 to 08:00, the shipped default
const NO_QUIET: QuietHours = { kind: "NONE" };

const EXPERIMENT: ActiveExperimentFact = { key: "eat_intentionally", variantId: "default", wording: "בארוחה הבאה — שב וקח כמה דקות בלי מסך.", locale: "he" };

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [WINTER_SHABBAT],
    hasAnyReport: true,
    lifecycle: "WEEKLY_CYCLE",
    firstWeek: null,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: DEFAULT_QUIET,
    milestone: null,
    weekly: null,
    activeExperiment: EXPERIMENT,
    ...overrides,
  };
}

function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

describe("resolveHome: the active-experiment card", () => {
  it.each(["09:00", "12:00", "17:59", "18:00", "20:00", "23:59"])("shows the card at %s with its sentence and the thank-you action", (time) => {
    const decision = resolveHome(facts(at(time)));
    expect(decision.state).toEqual({ key: "ACTIVE_EXPERIMENT", experiment: EXPERIMENT });
    expect(decision.action).toEqual({ kind: "THANK_ACTIVE_EXPERIMENT" });
    expect(decision.degraded).toBe(false);
    expect(decision.weeklyLink).toBe(false);
  });

  it("maps to the activeExperiment copy key", () => {
    expect(homeCopyKey(resolveHome(facts(at("12:00"))).state)).toBe("activeExperiment");
  });

  it("replaces the clock sentences (MORNING, EVENING and SILENCE) while it is due", () => {
    for (const time of ["09:00", "12:00", "20:00"]) {
      const without = label(resolveHome(facts(at(time), { activeExperiment: null })).state);
      expect(without, time).toMatch(/MORNING|EVENING|SILENCE/);
      expect(label(resolveHome(facts(at(time))).state), time).toBe("ACTIVE_EXPERIMENT");
    }
  });

  it("carries its own action, never the first-report invitation (even with no report at all)", () => {
    const decision = resolveHome(facts(at("12:00"), { hasAnyReport: false }));
    expect(decision.state.key).toBe("ACTIVE_EXPERIMENT");
    expect(decision.action).toEqual({ kind: "THANK_ACTIVE_EXPERIMENT" });
  });

  describe("never in the quiet hours", () => {
    it("is silent inside the person's quiet hours and shows from the moment they end", () => {
      expect(label(resolveHome(facts(at("07:59"))).state)).toBe("MORNING");
      expect(resolveHome(facts(at("08:00"))).state.key).toBe("ACTIVE_EXPERIMENT");
      expect(label(resolveHome(facts(at("00:00"))).state)).not.toBe("ACTIVE_EXPERIMENT");
      expect(resolveHome(facts(at("07:59"))).action).toBeNull();
    });

    it("honors a window that wraps midnight (22:00 to 07:00)", () => {
      const wrapping: QuietHours = { kind: "WINDOW", startMinute: 22 * 60, endMinute: 7 * 60 };
      expect(resolveHome(facts(at("21:59"), { quietHours: wrapping })).state.key).toBe("ACTIVE_EXPERIMENT");
      expect(resolveHome(facts(at("22:00"), { quietHours: wrapping })).state.key).not.toBe("ACTIVE_EXPERIMENT");
      expect(resolveHome(facts(at("06:59"), { quietHours: wrapping })).state.key).not.toBe("ACTIVE_EXPERIMENT");
      expect(resolveHome(facts(at("07:00"), { quietHours: wrapping })).state.key).toBe("ACTIVE_EXPERIMENT");
    });

    it("shows at any hour when the person has no quiet hours", () => {
      expect(resolveHome(facts(at("03:00"), { quietHours: NO_QUIET })).state.key).toBe("ACTIVE_EXPERIMENT");
    });

    it("is silent when the quiet hours are unknown (better silent than intrusive), and that does not make Home degraded", () => {
      const decision = resolveHome(facts(at("12:00"), { quietHours: null }));
      expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
      expect(decision.action).toBeNull();
      expect(decision.degraded).toBe(false);
    });
  });

  describe("only with a loaded fact in WEEKLY_CYCLE", () => {
    it("is silent without the fact (none, snoozed today or unknown)", () => {
      const decision = resolveHome(facts(at("12:00"), { activeExperiment: null }));
      expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
      expect(decision.degraded).toBe(false);
    });

    it("is silent when the caller predates the fact (the resolver is total)", () => {
      const old = facts(at("12:00"));
      delete (old as Partial<HomeFacts>).activeExperiment;
      expect(label(resolveHome(old).state)).toBe("SILENCE/NOTHING_TO_SAY");
    });

    it.each<LifecycleState | null>(["FIRST_WEEK", null])("is never created for lifecycle %s, even with a stale fact", (lifecycle) => {
      const decision = resolveHome(facts(at("12:00"), { lifecycle, firstWeek: null }));
      expect(decision.state.key).not.toBe("ACTIVE_EXPERIMENT");
      expect(decision.action === null || decision.action.kind !== "THANK_ACTIVE_EXPERIMENT").toBe(true);
    });
  });

  describe("one proactive card at a time", () => {
    it("yields to Shabbat in progress, before Shabbat and Motzei Shabbat", () => {
      expect(label(resolveHome(facts("2027-01-08T15:00:00Z")).state)).toBe("SILENCE/OFFLINE:SHABBAT");
      expect(resolveHome(facts("2027-01-08T12:00:00Z")).state.key).toBe("BEFORE_SHABBAT"); // 14:00 Friday
      expect(resolveHome(facts("2027-01-09T16:00:00Z")).state.key).toBe("MOTZEI_SHABBAT"); // 18:00 Saturday
    });

    it("shows again once those short windows are over", () => {
      expect(resolveHome(facts("2027-01-09T21:25:00Z")).state.key).toBe("ACTIVE_EXPERIMENT"); // 23:25 Saturday: 6 h after havdalah
      expect(resolveHome(facts("2027-01-10T08:00:00Z")).state.key).toBe("ACTIVE_EXPERIMENT"); // Sunday 10:00
    });

    it("yields to the weekly card when it is untouched, and then shows no quiet link either", () => {
      const decision = resolveHome(facts("2027-01-10T08:00:00Z", { weekly: { weekStart: "2027-01-03", card: true } }));
      expect(decision.state).toEqual({ key: "WEEKLY_SUMMARY_READY" });
      expect(decision.action).toEqual({ kind: "OPEN_WEEKLY_STORY" });
      expect(decision.weeklyLink).toBe(false);
    });

    it("comes right after the weekly card is opened or put away, and the quiet link to the week stays under it", () => {
      const decision = resolveHome(facts("2027-01-10T08:00:00Z", { weekly: { weekStart: "2027-01-03", card: false } }));
      expect(decision.state.key).toBe("ACTIVE_EXPERIMENT");
      expect(decision.weeklyLink).toBe(true);
    });

    it("yields to a landmark that was reached", () => {
      const decision = resolveHome(facts(at("12:00"), { milestone: { week: "2026-10-18", isGoal: false } }));
      expect(decision.state).toEqual({ key: "MILESTONE_REACHED", week: "2026-10-18", isGoal: false });
      expect(decision.action).toEqual({ kind: "OPEN_PROGRESS", week: "2026-10-18" });
    });

    it("never takes the place of a First Week card, which exists only in FIRST_WEEK", () => {
      const ready = resolveHome(
        facts(at("12:00"), { lifecycle: "FIRST_WEEK", firstWeek: { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 } }),
      );
      expect(ready.state.key).toBe("FIRST_WEEK_SUMMARY_READY");
      const back = resolveHome(
        facts(at("12:00"), { lifecycle: "FIRST_WEEK", firstWeek: { availableDays: 3, confirmedMeals: 4, availableDaysSinceLastMeal: 3 } }),
      );
      expect(back.state.key).toBe("FIRST_WEEK_WELCOME_BACK");
    });
  });

  it("still marks Home degraded when the periods are unknown, and then the card shows from the clock alone", () => {
    const decision = resolveHome(facts(at("12:00"), { offlinePeriods: null }));
    expect(decision.state.key).toBe("ACTIVE_EXPERIMENT");
    expect(decision.degraded).toBe(true);
  });

  it("carries the fact through untouched (the same object, no number, no id)", () => {
    const decision = resolveHome(facts(at("12:00")));
    expect(decision.state.key === "ACTIVE_EXPERIMENT" && decision.state.experiment).toBe(EXPERIMENT);
    expect(Object.keys(EXPERIMENT).sort()).toEqual(["key", "locale", "variantId", "wording"]);
  });
});
