import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import type { FirstWeekProgress } from "../firstWeekFlow/types";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import type { OfflinePeriod, OfflineType } from "../offline";
import {
  HOME_COPY_KEYS,
  HOME_FALLBACK_TIME_ZONE,
  HOME_FEATURES,
  HOME_TIMING,
  homeCopyKey,
  homePeriodsWindow,
  isHomeStale,
  resolveHome,
  resolveTimeZone,
  type HomeCopyKey,
  type HomeFacts,
  type HomeState,
} from "./index";

const TZ = "Asia/Jerusalem";
const HOUR = 3_600_000;

const period = (type: OfflineType, start: string, end: string): OfflinePeriod => ({
  type,
  start: new Date(start),
  end: new Date(end),
});

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2).
const WINTER_SHABBAT = period("SHABBAT", "2027-01-08T14:10:00Z", "2027-01-09T15:25:00Z");

// Mid-First Week: the rules are nowhere near ready and nobody has been away, so the First Week states stay out of the way.
const KEEP_GOING: FirstWeekProgress = { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 };

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
    ...overrides,
  };
}

/** A short label for a state, so the tables below read like the spec. */
function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

describe("resolveHome: the clock and a winter Shabbat (Asia/Jerusalem)", () => {
  // [now (UTC), the same instant locally, expected state]
  const rows: Array<[string, string, string]> = [
    // Before Shabbat: the lead is inclusive, candle lighting itself is the start of the quiet period.
    ["2027-01-08T11:09:59Z", "13:09:59 Fri", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-08T11:10:00Z", "13:10:00 Fri", "BEFORE_SHABBAT"],
    ["2027-01-08T14:09:59Z", "16:09:59 Fri", "BEFORE_SHABBAT"],
    // Shabbat in progress: start inclusive, end exclusive.
    ["2027-01-08T14:10:00Z", "16:10:00 Fri", "SILENCE/OFFLINE:SHABBAT"],
    ["2027-01-09T15:24:59Z", "17:24:59 Sat", "SILENCE/OFFLINE:SHABBAT"],
    // Motzei Shabbat: end is exclusive for offline and inclusive for Motzei; after 6 h the clock takes over.
    ["2027-01-09T15:25:00Z", "17:25:00 Sat", "MOTZEI_SHABBAT"],
    ["2027-01-09T21:24:59Z", "23:24:59 Sat", "MOTZEI_SHABBAT"],
    ["2027-01-09T21:25:00Z", "23:25:00 Sat", "EVENING"],
    // The weekday clock, far from any Shabbat: 05:00 and 11:00 and 18:00 and midnight.
    ["2027-01-12T02:59:59Z", "04:59:59", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T03:00:00Z", "05:00:00", "MORNING"],
    ["2027-01-12T08:59:59Z", "10:59:59", "MORNING"],
    ["2027-01-12T09:00:00Z", "11:00:00", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T15:59:59Z", "17:59:59", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T16:00:00Z", "18:00:00", "EVENING"],
    ["2027-01-12T21:59:59Z", "23:59:59", "EVENING"],
    ["2027-01-12T22:00:00Z", "00:00:00 (midnight is minute 0, not 24)", "SILENCE/NOTHING_TO_SAY"],
  ];

  it.each(rows)("%s (%s) -> %s", (now, _local, expected) => {
    expect(label(resolveHome(facts(now)).state)).toBe(expected);
  });

  it("carries the stored candle-lighting and havdalah instants in the state", () => {
    expect(resolveHome(facts("2027-01-08T12:00:00Z")).state).toEqual({
      key: "BEFORE_SHABBAT",
      candleLighting: WINTER_SHABBAT.start,
    });
    expect(resolveHome(facts("2027-01-09T16:00:00Z")).state).toEqual({
      key: "MOTZEI_SHABBAT",
      havdalah: WINTER_SHABBAT.end,
    });
  });
});

describe("resolveHome: precedence", () => {
  it("lets a summer Friday's Before Shabbat beat the evening (19:10 candle lighting, now 18:30)", () => {
    const summer = period("SHABBAT", "2027-07-09T16:10:00Z", "2027-07-10T17:25:00Z");
    const decision = resolveHome(facts("2027-07-09T15:30:00Z", { offlinePeriods: [summer] }));
    expect(decision.state).toEqual({ key: "BEFORE_SHABBAT", candleLighting: summer.start });
  });

  it("takes the earliest start for Before Shabbat when two Shabbat periods qualify", () => {
    const later = period("SHABBAT", "2027-01-08T14:30:00Z", "2027-01-09T15:45:00Z");
    const decision = resolveHome(facts("2027-01-08T12:00:00Z", { offlinePeriods: [later, WINTER_SHABBAT] }));
    expect(decision.state).toEqual({ key: "BEFORE_SHABBAT", candleLighting: WINTER_SHABBAT.start });
  });

  it("takes the latest end for Motzei Shabbat when two Shabbat periods qualify", () => {
    const earlier = period("SHABBAT", "2027-01-08T12:00:00Z", "2027-01-09T13:00:00Z");
    const decision = resolveHome(facts("2027-01-09T17:00:00Z", { offlinePeriods: [WINTER_SHABBAT, earlier] }));
    expect(decision.state).toEqual({ key: "MOTZEI_SHABBAT", havdalah: WINTER_SHABBAT.end });
  });

  it("goes quiet for a HOLIDAY in progress and names its type", () => {
    const holiday = period("HOLIDAY", "2027-04-21T15:00:00Z", "2027-04-22T17:00:00Z");
    const decision = resolveHome(facts("2027-04-22T08:00:00Z", { offlinePeriods: [holiday] }));
    expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" });
  });

  it.each<OfflineType>(["USER_DEFINED", "VACATION"])("goes quiet for a %s period in progress", (type) => {
    const other = period(type, "2027-01-11T00:00:00Z", "2027-01-14T00:00:00Z");
    const decision = resolveHome(facts("2027-01-12T08:00:00Z", { offlinePeriods: [other] }));
    expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: type });
  });

  it("does not announce Before Shabbat for a HOLIDAY that starts in two hours", () => {
    const now = "2027-04-21T10:00:00Z"; // 13:00 local, in the middle of the quiet part of the day
    const holiday = period("HOLIDAY", "2027-04-21T12:00:00Z", "2027-04-22T17:00:00Z");
    expect(resolveHome(facts(now, { offlinePeriods: [holiday] })).state).toEqual({
      key: "SILENCE",
      reason: "NOTHING_TO_SAY",
    });
  });

  it("is quiet, not Motzei Shabbat, when a HOLIDAY starts exactly as Shabbat ends", () => {
    const holiday = period("HOLIDAY", "2027-01-09T15:25:00Z", "2027-01-10T15:25:00Z");
    const decision = resolveHome(facts("2027-01-09T15:25:00Z", { offlinePeriods: [WINTER_SHABBAT, holiday] }));
    expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" });
  });

  it("calls a holiday that falls on Shabbat by the Shabbat name, whatever the order of the list", () => {
    const holiday = period("HOLIDAY", "2027-01-08T10:00:00Z", "2027-01-09T16:00:00Z");
    const now = "2027-01-09T09:00:00Z";
    for (const periods of [[holiday, WINTER_SHABBAT], [WINTER_SHABBAT, holiday]]) {
      const decision = resolveHome(facts(now, { offlinePeriods: periods }));
      expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" });
    }
  });

  it("lets the periods decide even when the clock says evening (offline beats everything)", () => {
    const decision = resolveHome(facts("2027-01-08T17:00:00Z", { hasAnyReport: false })); // 19:00 local, Shabbat
    expect(decision.state).toMatchObject({ key: "SILENCE", reason: "OFFLINE_PERIOD" });
    expect(decision.action).toBeNull();
  });

  it.each<OfflineType>(["VACATION", "HOLIDAY", "USER_DEFINED"])(
    "lets a %s in progress beat Before Shabbat, whatever the order of the list",
    (type) => {
      // 14:00 local on the Friday: inside Shabbat's three-hour lead, in the middle of the other period.
      const other = period(type, "2027-01-04T00:00:00Z", "2027-01-12T00:00:00Z");
      for (const periods of [[other, WINTER_SHABBAT], [WINTER_SHABBAT, other]]) {
        const decision = resolveHome(facts("2027-01-08T12:00:00Z", { offlinePeriods: periods, hasAnyReport: false }));
        expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: type });
        expect(decision.action).toBeNull();
      }
    },
  );

  it.each<OfflineType>(["HOLIDAY", "VACATION", "USER_DEFINED"])(
    "does not announce Motzei Shabbat after a %s ends",
    (type) => {
      const other = period(type, "2027-04-21T15:00:00Z", "2027-04-22T17:00:00Z");

      // 22:00 local, two hours after the end: the weekday clock takes over, with no Shabbat state.
      const evening = resolveHome(facts("2027-04-22T19:00:00Z", { offlinePeriods: [other], hasAnyReport: true }));
      expect(evening.state).toEqual({ key: "EVENING" });

      // 12:00 local, within six hours of an earlier end: still nothing to say.
      const earlier = period(type, "2027-04-21T15:00:00Z", "2027-04-22T07:00:00Z");
      const noon = resolveHome(facts("2027-04-22T09:00:00Z", { offlinePeriods: [earlier], hasAnyReport: true }));
      expect(noon.state).toEqual({ key: "SILENCE", reason: "NOTHING_TO_SAY" });
      expect(noon.action).toBeNull();

      // With no report yet the same two instants show First Week Start, never a Shabbat state.
      const first = [
        resolveHome(facts("2027-04-22T19:00:00Z", { offlinePeriods: [other], hasAnyReport: false })),
        resolveHome(facts("2027-04-22T09:00:00Z", { offlinePeriods: [earlier], hasAnyReport: false })),
      ];
      for (const decision of first) expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    },
  );

  it("falls back to the clock alone when the periods are unknown, even at a Shabbat instant", () => {
    for (const [now, expected] of [
      ["2027-01-08T11:10:00Z", "SILENCE/NOTHING_TO_SAY"], // would be BEFORE_SHABBAT
      ["2027-01-08T14:10:00Z", "SILENCE/NOTHING_TO_SAY"], // would be OFFLINE
      ["2027-01-09T15:25:00Z", "SILENCE/NOTHING_TO_SAY"], // would be MOTZEI_SHABBAT (17:25 local)
      ["2027-01-09T19:00:00Z", "EVENING"],
      ["2027-01-10T05:00:00Z", "MORNING"],
    ] as const) {
      const decision = resolveHome(facts(now, { offlinePeriods: null }));
      expect(label(decision.state)).toBe(expected);
      expect(decision.degraded).toBe(true);
    }
  });
});

describe("resolveHome: daylight saving time (Asia/Jerusalem)", () => {
  const noPeriods = (now: string) => facts(now, { offlinePeriods: [] });

  // [now (UTC), local wall clock, expected]
  const fallBack: Array<[string, string, string]> = [
    // 2026-10-25: 02:00 IDT becomes 01:00 IST at 2026-10-24T23:00:00Z, so 01:30 happens twice.
    ["2026-10-24T22:30:00Z", "01:30 IDT", "SILENCE/NOTHING_TO_SAY"],
    ["2026-10-24T23:30:00Z", "01:30 IST (the repeated hour)", "SILENCE/NOTHING_TO_SAY"],
    ["2026-10-25T02:59:59Z", "04:59:59 IST", "SILENCE/NOTHING_TO_SAY"],
    ["2026-10-25T03:00:00Z", "05:00:00 IST", "MORNING"],
    ["2026-10-25T15:59:59Z", "17:59:59 IST", "SILENCE/NOTHING_TO_SAY"],
    ["2026-10-25T16:00:00Z", "18:00:00 IST", "EVENING"],
  ];
  it.each(fallBack)("fall back, %s (%s) -> %s", (now, _local, expected) => {
    expect(label(resolveHome(noPeriods(now)).state)).toBe(expected);
  });

  const springForward: Array<[string, string, string]> = [
    // 2027-03-26: 02:00 IST becomes 03:00 IDT at 2027-03-26T00:00:00Z, so 02:xx does not exist.
    ["2027-03-25T23:59:59Z", "01:59:59 IST", "SILENCE/NOTHING_TO_SAY"],
    ["2027-03-26T00:00:00Z", "03:00:00 IDT", "SILENCE/NOTHING_TO_SAY"],
    ["2027-03-26T01:59:59Z", "04:59:59 IDT", "SILENCE/NOTHING_TO_SAY"],
    ["2027-03-26T02:00:00Z", "05:00:00 IDT", "MORNING"],
  ];
  it.each(springForward)("spring forward, %s (%s) -> %s", (now, _local, expected) => {
    expect(label(resolveHome(noPeriods(now)).state)).toBe(expected);
  });

  it("does not let the DST day shift the Before Shabbat lead (it is milliseconds, not wall-clock hours)", () => {
    const shabbat = period("SHABBAT", "2027-03-26T14:20:00Z", "2027-03-27T15:35:00Z");
    const at = (now: string) => resolveHome(facts(now, { offlinePeriods: [shabbat] })).state;
    expect(label(at("2027-03-26T11:19:59Z"))).toBe("SILENCE/NOTHING_TO_SAY");
    expect(at("2027-03-26T11:20:00Z")).toEqual({ key: "BEFORE_SHABBAT", candleLighting: shabbat.start });
    expect(at("2027-03-26T14:19:59Z").key).toBe("BEFORE_SHABBAT");
    expect(label(at("2027-03-26T14:20:00Z"))).toBe("SILENCE/OFFLINE:SHABBAT");
  });
});

describe("resolveHome: the action", () => {
  // The switch is a `const`, so these run against the shipped value. Flipping it to false is a one-line
  // product decision that also flips the "invites" cases below.
  it("ships with the first-report invitation on", () => {
    expect(HOME_FEATURES.firstReportInvitation).toBe(true);
  });

  // With no report yet, the states that keep their own card and carry the invitation themselves.
  const ownCards: Array<[string, string]> = [
    ["BEFORE_SHABBAT", "2027-01-08T12:00:00Z"], // 14:00 Fri
    ["MOTZEI_SHABBAT", "2027-01-09T16:00:00Z"], // 18:00 Sat
  ];
  it.each(ownCards)("keeps its own card, with the invitation, in %s when no report exists", (key, now) => {
    const decision = resolveHome(facts(now, { hasAnyReport: false }));
    expect(decision.state.key).toBe(key);
    expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" });
    expect(decision.degraded).toBe(false);
  });

  it.each(ownCards)("makes no invitation in %s once a report exists", (_key, now) => {
    expect(resolveHome(facts(now, { hasAnyReport: true })).action).toBeNull();
  });

  it.each(ownCards)("makes no invitation in %s when it is unknown whether a report exists", (_key, now) => {
    const decision = resolveHome(facts(now, { hasAnyReport: null }));
    expect(decision.action).toBeNull();
    expect(decision.degraded).toBe(true);
  });

  // The weekday clock states, which are what the user sees once a report exists.
  const clockStates: Array<[string, string]> = [
    ["MORNING", "2027-01-12T05:00:00Z"], // 07:00
    ["EVENING", "2027-01-12T17:00:00Z"], // 19:00
    ["SILENCE (13:00 local)", "2027-01-12T11:00:00Z"],
    ["SILENCE (03:00 local)", "2027-01-12T01:00:00Z"],
  ];
  it.each(clockStates)("makes no invitation in %s once a report exists", (_key, now) => {
    expect(resolveHome(facts(now, { hasAnyReport: true })).action).toBeNull();
  });

  it("never invites while Shabbat is in progress, even with no report", () => {
    const decision = resolveHome(facts("2027-01-09T10:00:00Z", { hasAnyReport: false }));
    expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" });
    expect(decision.action).toBeNull();
  });

  it("marks the decision degraded exactly when a fact is unknown", () => {
    const now = "2027-01-12T05:00:00Z";
    const cases: Array<[Partial<HomeFacts>, boolean]> = [
      [{ offlinePeriods: [], hasAnyReport: true }, false],
      [{ offlinePeriods: [], hasAnyReport: false }, false],
      [{ offlinePeriods: null, hasAnyReport: true }, true],
      [{ offlinePeriods: [], hasAnyReport: null }, true],
      [{ offlinePeriods: null, hasAnyReport: null }, true],
    ];
    for (const [overrides, degraded] of cases) {
      expect(resolveHome(facts(now, overrides)).degraded).toBe(degraded);
    }
  });

  it("still renders from the clock when everything is unknown (the loader's not-ready result)", () => {
    const decision = resolveHome({
      now: new Date("2027-01-12T05:00:00Z"),
      timeZone: DEFAULT_TIME_ZONE,
      offlinePeriods: null,
      hasAnyReport: null,
      lifecycle: null,
      firstWeek: null,
      firstWeekSnoozed: NOT_SNOOZED,
      earlySignal: null,
      quietHours: null,
    });
    expect(decision).toEqual({ state: { key: "MORNING" }, action: null, degraded: true });
  });
});

describe("resolveHome: First Week Start (B1, no report yet)", () => {
  // The screen the user sees right after onboarding. It is content on the screen, not a notification,
  // so it holds at every hour, including the midday and night hours that are Silence once a report exists.
  // [now (UTC), local, the state once a report exists]
  const hours: Array<[string, string, string]> = [
    ["2027-01-12T03:00:00Z", "05:00", "MORNING"],
    ["2027-01-12T09:00:00Z", "11:00", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T10:00:00Z", "12:00", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T15:59:59Z", "17:59:59", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T16:00:00Z", "18:00", "EVENING"],
    ["2027-01-12T21:59:59Z", "23:59:59", "EVENING"],
    ["2027-01-12T22:00:00Z", "00:00", "SILENCE/NOTHING_TO_SAY"],
    ["2027-01-12T02:59:59Z", "04:59:59", "SILENCE/NOTHING_TO_SAY"],
  ];

  it.each(hours)("shows First Week Start at %s (%s), with the invitation", (now) => {
    const decision = resolveHome(facts(now, { hasAnyReport: false }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" });
    expect(decision.degraded).toBe(false);
  });

  it.each(hours)("restores the old state at %s (%s) once a report exists", (now, _local, expected) => {
    const decision = resolveHome(facts(now, { hasAnyReport: true }));
    expect(label(decision.state)).toBe(expected);
    expect(decision.action).toBeNull();
  });

  it.each(hours)("does not show it at %s (%s) when it is unknown whether a report exists", (now, _local, expected) => {
    const decision = resolveHome(facts(now, { hasAnyReport: null }));
    expect(label(decision.state)).toBe(expected);
    expect(decision.action).toBeNull();
    expect(decision.degraded).toBe(true);
  });

  it("still shows it when the periods are unknown (Shabbat cannot be known, the report fact can)", () => {
    const decision = resolveHome(facts("2027-01-12T10:00:00Z", { hasAnyReport: false, offlinePeriods: null }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.degraded).toBe(true);
  });

  describe("precedence", () => {
    const shabbat: Array<[string, string, string]> = [
      ["Shabbat in progress (offline)", "2027-01-09T10:00:00Z", "SILENCE/OFFLINE:SHABBAT"],
      ["Before Shabbat", "2027-01-08T12:00:00Z", "BEFORE_SHABBAT"],
      ["Motzei Shabbat", "2027-01-09T16:00:00Z", "MOTZEI_SHABBAT"],
    ];
    it.each(shabbat)("%s beats First Week Start", (_name, now, expected) => {
      expect(label(resolveHome(facts(now, { hasAnyReport: false })).state)).toBe(expected);
    });

    it.each<OfflineType>(["HOLIDAY", "VACATION", "USER_DEFINED"])(
      "a %s in progress beats First Week Start, with no action",
      (type) => {
        const other = period(type, "2027-01-11T00:00:00Z", "2027-01-14T00:00:00Z");
        const decision = resolveHome(facts("2027-01-12T10:00:00Z", { offlinePeriods: [other], hasAnyReport: false }));
        expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: type });
        expect(decision.action).toBeNull();
      },
    );

    it("beats the evening and the morning, which only come back with a report", () => {
      expect(resolveHome(facts("2027-01-12T17:00:00Z", { hasAnyReport: false })).state.key).toBe("FIRST_WEEK_START");
      expect(resolveHome(facts("2027-01-12T05:00:00Z", { hasAnyReport: false })).state.key).toBe("FIRST_WEEK_START");
    });
  });

  // This file runs against the shipped value (true). The switch-off behaviour (the state disappears together
  // with the action, because First Week Start exists for its one invitation button) is covered by
  // resolve.flagOff.test.ts, which mocks HOME_FEATURES.
  it("ships with the first-report switch on", () => {
    expect(HOME_FEATURES.firstReportInvitation).toBe(true);
  });
});

describe("resolveHome: bad input never throws", () => {
  const instants = [
    "2027-01-08T11:10:00Z",
    "2027-01-08T14:10:00Z",
    "2027-01-09T15:25:00Z",
    "2027-01-09T21:25:00Z",
    "2027-01-12T03:00:00Z",
    "2027-01-12T11:00:00Z",
    "2027-01-12T16:00:00Z",
  ];

  it.each(["Not/AZone", "", "Asia/Jerusalem ", "123"])("treats the time zone %j like Jerusalem", (timeZone) => {
    for (const now of instants) {
      const expected = resolveHome(facts(now));
      expect(resolveHome(facts(now, { timeZone }))).toEqual(expected);
    }
  });

  it("gives a calm, degraded silence for an invalid instant instead of throwing", () => {
    const decision = resolveHome(facts("2027-01-12T05:00:00Z", { now: new Date("not a date"), hasAnyReport: false }));
    expect(decision).toEqual({ state: { key: "SILENCE", reason: "NOTHING_TO_SAY" }, action: null, degraded: true });
  });
});

describe("resolveTimeZone", () => {
  it.each(["UTC", "Asia/Jerusalem", "America/New_York"])("returns the valid zone %s unchanged", (tz) => {
    expect(resolveTimeZone(tz)).toBe(tz);
  });

  it.each(["Not/AZone", "", " ", "Jerusalem", "<script>"])("falls back to Jerusalem for %j", (tz) => {
    expect(resolveTimeZone(tz)).toBe(HOME_FALLBACK_TIME_ZONE);
  });

  it("falls back for values that are not strings at all (the column is untyped at run time)", () => {
    expect(resolveTimeZone(undefined as unknown as string)).toBe(HOME_FALLBACK_TIME_ZONE);
    expect(resolveTimeZone(null as unknown as string)).toBe(HOME_FALLBACK_TIME_ZONE);
    expect(resolveTimeZone(42 as unknown as string)).toBe(HOME_FALLBACK_TIME_ZONE);
  });

  it("uses the same fallback as the rest of the app", () => {
    expect(HOME_FALLBACK_TIME_ZONE).toBe(DEFAULT_TIME_ZONE);
  });
});

describe("isHomeStale", () => {
  const s = HOME_TIMING.staleAfterMs;

  it("is false until the page is staleAfterMs old, and true from then on", () => {
    expect(isHomeStale(1_000, 1_000, s)).toBe(false);
    expect(isHomeStale(1_000, 1_000 + s - 1, s)).toBe(false);
    expect(isHomeStale(1_000, 1_000 + s, s)).toBe(true);
    expect(isHomeStale(1_000, 1_000 + s + 1, s)).toBe(true);
    expect(isHomeStale(1_000, 1_000 + 10 * s, s)).toBe(true);
  });

  it("is false when the clock went backwards", () => {
    expect(isHomeStale(10_000, 9_999, s)).toBe(false);
    expect(isHomeStale(10_000, 0, 0)).toBe(false);
  });

  it("is five minutes by default", () => {
    expect(s).toBe(5 * 60 * 1000);
  });
});

describe("homeCopyKey", () => {
  const date = new Date("2027-01-08T14:10:00Z");
  const cases: Array<[HomeState, HomeCopyKey]> = [
    [{ key: "MORNING" }, "morning"],
    [{ key: "EVENING" }, "evening"],
    [{ key: "BEFORE_SHABBAT", candleLighting: date }, "beforeShabbat"],
    [{ key: "MOTZEI_SHABBAT", havdalah: date }, "motzeiShabbat"],
    [{ key: "FIRST_WEEK_START" }, "firstWeekStart"],
    [{ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: true }, "firstWeekSummaryReady"],
    [{ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: false }, "firstWeekSummaryReadyLittle"],
    [{ key: "FIRST_WEEK_WELCOME_BACK" }, "firstWeekWelcomeBack"],
    [{ key: "EARLY_SIGNAL", signal: "late_evening_meals" }, "earlySignalLateEvening"],
    [{ key: "SILENCE", reason: "NOTHING_TO_SAY" }, "silence"],
    [{ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" }, "offlineShabbat"],
    [{ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" }, "offlineOther"],
    [{ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "USER_DEFINED" }, "offlineOther"],
    [{ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "VACATION" }, "offlineOther"],
  ];

  it.each(cases)("maps %j to %s", (state, key) => {
    expect(homeCopyKey(state)).toBe(key);
  });

  it("reaches every copy key, so none is dead", () => {
    expect(new Set(cases.map(([state]) => homeCopyKey(state)))).toEqual(new Set(HOME_COPY_KEYS));
  });
});

describe("homePeriodsWindow", () => {
  it("is [now - 6h, now + 3h]", () => {
    const now = new Date("2027-01-12T12:00:00Z");
    const { from, to } = homePeriodsWindow(now);
    expect(from.toISOString()).toBe("2027-01-12T06:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-12T15:00:00.000Z");
    expect(now.getTime() - from.getTime()).toBe(6 * HOUR);
    expect(to.getTime() - now.getTime()).toBe(3 * HOUR);
  });

  it("does not change the instant it is given", () => {
    const now = new Date("2027-01-12T12:00:00Z");
    homePeriodsWindow(now);
    expect(now.toISOString()).toBe("2027-01-12T12:00:00.000Z");
  });

  it("covers every period the resolver can use (overlap rule: end > from and start <= to)", () => {
    const now = new Date("2027-01-09T16:00:00Z");
    const { from, to } = homePeriodsWindow(now);
    const overlaps = (p: OfflinePeriod) => p.end.getTime() > from.getTime() && p.start.getTime() <= to.getTime();
    // Motzei Shabbat needs a period that ended up to 6 h ago, Before Shabbat one that starts up to 3 h ahead.
    expect(overlaps(WINTER_SHABBAT)).toBe(true);
    expect(overlaps(period("SHABBAT", "2027-01-16T14:10:00Z", "2027-01-17T15:25:00Z"))).toBe(false);
    expect(overlaps(period("SHABBAT", "2027-01-09T19:00:00Z", "2027-01-10T19:00:00Z"))).toBe(true);
    expect(overlaps(period("SHABBAT", "2027-01-09T19:00:01Z", "2027-01-10T19:00:00Z"))).toBe(false);
  });
});
