import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import { resolveHome, type HomeFacts, type HomeStateKey } from "../home";
import type { OfflinePeriod } from "../offline";
import { isQuiet, parseQuietHours, type QuietHours } from "../quietHours";
import { localMinuteOfDay } from "../time";
import type { WeeklyHomeFact } from "../weekly";
import {
  NOTIFICATION_KINDS,
  WEEKLY_PUSH,
  WEEKLY_PUSH_SKIP_REASONS,
  decideWeeklyPush,
  weeklyMomentKey,
  type WeeklyPushInput,
  type WeeklyPushSkipReason,
} from "./index";

const TZ = "Asia/Jerusalem";

// Sunday 2026-10-18 08:05 in Israel (UTC+3 until the clocks go back on Sunday 2026-10-25): the first moment the owner's account can get the push.
const SUNDAY_0805 = new Date("2026-10-18T05:05:00Z");
const CARD: WeeklyHomeFact = { weekStart: "2026-10-11", card: true };
const DEFAULT_QUIET = parseQuietHours("00:00:00", "08:00:00") as QuietHours;

const sendable: WeeklyPushInput = {
  now: SUNDAY_0805,
  timeZone: TZ,
  lifecycle: "WEEKLY_CYCLE",
  preferenceOn: true,
  fact: CARD,
  periods: [],
  quietHours: DEFAULT_QUIET,
  subscriptionCount: 1,
  claimExists: false,
};

const decide = (overrides: Partial<WeeklyPushInput> = {}) => decideWeeklyPush({ ...sendable, ...overrides });
const at = (iso: string, overrides: Partial<WeeklyPushInput> = {}) => decide({ now: new Date(iso), ...overrides });

describe("decideWeeklyPush: one gate at a time", () => {
  it("sends when every gate is open, with a key that names the week", () => {
    expect(decide()).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" });
  });

  it.each<[string, Partial<WeeklyPushInput>, WeeklyPushSkipReason]>([
    ["an invalid instant", { now: new Date(Number.NaN) }, "invalid_input"],
    ["a lifecycle that is not the weekly cycle", { lifecycle: "FIRST_WEEK" }, "not_weekly_cycle"],
    ["an unknown lifecycle", { lifecycle: null }, "not_weekly_cycle"],
    ["a preference that is off", { preferenceOn: false }, "preference_off"],
    ["a preference that could not be read", { preferenceOn: null }, "preference_unknown"],
    ["no weekly moment (or a failed read)", { fact: null }, "no_moment"],
    ["a week key that is not a date", { fact: { weekStart: "this week", card: true } }, "no_moment"],
    ["a card that was opened or snoozed", { fact: { weekStart: "2026-10-11", card: false } }, "card_closed"],
    ["unknown offline periods", { periods: null }, "offline_unknown"],
    ["an Offline period that covers the instant", { periods: [{ type: "VACATION", start: new Date("2026-10-18T04:00:00Z"), end: new Date("2026-10-18T06:00:00Z") }] }, "offline"],
    ["a push that was already claimed", { claimExists: true }, "already_claimed"],
    ["unknown quiet hours", { quietHours: null }, "quiet_hours_unknown"],
    ["quiet hours that cover the instant", { quietHours: { kind: "WINDOW", startMinute: 480, endMinute: 540 } }, "quiet_hours"],
    ["no subscription", { subscriptionCount: 0 }, "no_subscription"],
    ["a subscription count that is not a number", { subscriptionCount: Number.NaN }, "no_subscription"],
  ])("skips for %s", (_label, overrides, reason) => {
    expect(decide(overrides)).toEqual({ kind: "SKIP", reason });
  });

  it("treats an Offline period as closed only while it covers the instant: the end is exclusive", () => {
    const period: OfflinePeriod = { type: "SHABBAT", start: new Date("2026-10-17T14:20:00Z"), end: SUNDAY_0805 };
    expect(decide({ periods: [period] })).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" });
    expect(at("2026-10-18T05:04:59Z", { periods: [period] })).toEqual({ kind: "SKIP", reason: "offline" });
  });
});

// The reference order, written independently of the implementation: each gate has an open state and some closed ones.
type State = { label: string; overrides: Partial<WeeklyPushInput>; reason: WeeklyPushSkipReason | null };
const GATES: State[][] = [
  [
    { label: "cycle", overrides: {}, reason: null },
    { label: "first week", overrides: { lifecycle: "FIRST_WEEK" }, reason: "not_weekly_cycle" },
  ],
  [
    { label: "pref on", overrides: {}, reason: null },
    { label: "pref off", overrides: { preferenceOn: false }, reason: "preference_off" },
    { label: "pref unknown", overrides: { preferenceOn: null }, reason: "preference_unknown" },
  ],
  [
    { label: "card", overrides: {}, reason: null },
    { label: "no moment", overrides: { fact: null }, reason: "no_moment" },
    { label: "card gone", overrides: { fact: { weekStart: "2026-10-11", card: false } }, reason: "card_closed" },
  ],
  [
    { label: "online", overrides: {}, reason: null },
    { label: "periods unknown", overrides: { periods: null }, reason: "offline_unknown" },
    { label: "offline", overrides: { periods: [{ type: "USER_DEFINED", start: new Date("2026-10-18T00:00:00Z"), end: new Date("2026-10-19T00:00:00Z") }] }, reason: "offline" },
  ],
  [
    { label: "unclaimed", overrides: {}, reason: null },
    { label: "claimed", overrides: { claimExists: true }, reason: "already_claimed" },
  ],
  [
    { label: "quiet over", overrides: {}, reason: null },
    { label: "quiet unknown", overrides: { quietHours: null }, reason: "quiet_hours_unknown" },
    { label: "quiet now", overrides: { quietHours: { kind: "WINDOW", startMinute: 480, endMinute: 540 } }, reason: "quiet_hours" },
  ],
  [
    { label: "subscribed", overrides: {}, reason: null },
    { label: "no subscription", overrides: { subscriptionCount: 0 }, reason: "no_subscription" },
  ],
];

function product(gates: State[][]): State[][] {
  return gates.reduce<State[][]>((acc, states) => acc.flatMap((prefix) => states.map((s) => [...prefix, s])), [[]]);
}

describe("decideWeeklyPush: every combination of the gates", () => {
  const combos = product(GATES);

  it("covers every combination (2 x 3 x 3 x 3 x 2 x 3 x 2)", () => {
    expect(combos).toHaveLength(648);
  });

  it("sends if and only if every gate is open, and otherwise names the FIRST closed gate", () => {
    let sends = 0;
    for (const combo of combos) {
      const overrides = Object.assign({}, ...combo.map((s) => s.overrides)) as Partial<WeeklyPushInput>;
      const expected = combo.find((s) => s.reason !== null)?.reason ?? null;
      const label = combo.map((s) => s.label).join(" / ");
      const got = decide(overrides);
      if (expected === null) {
        sends += 1;
        expect(got, label).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" });
      } else {
        expect(got, label).toEqual({ kind: "SKIP", reason: expected });
      }
    }
    expect(sends).toBe(1);
  });

  it("never sends while the person is Offline, whatever else is open", () => {
    for (const combo of combos.filter((c) => c.some((s) => s.label === "offline"))) {
      const overrides = Object.assign({}, ...combo.map((s) => s.overrides)) as Partial<WeeklyPushInput>;
      expect(decide(overrides).kind, combo.map((s) => s.label).join(" / ")).toBe("SKIP");
    }
  });

  it("uses every skip reason it declares, and no other", () => {
    const seen = new Set<string>(["invalid_input"]);
    for (const combo of combos) {
      const overrides = Object.assign({}, ...combo.map((s) => s.overrides)) as Partial<WeeklyPushInput>;
      const got = decide(overrides);
      if (got.kind === "SKIP") seen.add(got.reason);
    }
    expect([...seen].sort()).toEqual([...WEEKLY_PUSH_SKIP_REASONS].sort());
  });
});

describe("decideWeeklyPush: quiet hours delay, they do not cancel", () => {
  // The default window is 00:00 to 08:00 and the card stays up from Sunday 05:00 to Wednesday 05:00, so the same decision is asked
  // again at every tick: quiet until 07:59, a send at 08:00 (the end of the window is exclusive).
  it.each([
    ["04:59", "2026-10-18T01:59:00Z", "quiet_hours"],
    ["05:00 (the moment the week is ready)", "2026-10-18T02:00:00Z", "quiet_hours"],
    ["07:55", "2026-10-18T04:55:00Z", "quiet_hours"],
    ["07:59", "2026-10-18T04:59:00Z", "quiet_hours"],
  ])("Sunday %s Israel time: waits", (_label, iso, reason) => {
    expect(at(iso)).toEqual({ kind: "SKIP", reason });
  });

  it.each([
    ["08:00 exactly", "2026-10-18T05:00:00Z"],
    ["08:05", "2026-10-18T05:05:00Z"],
    ["Monday 09:00 (the card is still up)", "2026-10-19T06:00:00Z"],
  ])("%s: sends", (_label, iso) => {
    expect(at(iso)).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" });
  });

  it("goes by the wall clock on the day the clocks go back (Sunday 2026-10-25): 07:59 waits, 08:00 sends", () => {
    const fact = { weekStart: "2026-10-18", card: true };
    expect(at("2026-10-25T05:59:00Z", { fact })).toEqual({ kind: "SKIP", reason: "quiet_hours" }); // 07:59 at UTC+2
    expect(at("2026-10-25T06:00:00Z", { fact })).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-18" }); // 08:00 at UTC+2
  });

  it("reads an invalid time zone as Asia/Jerusalem, never as UTC", () => {
    // 05:00 UTC is 08:00 in Israel (send) but 05:00 in UTC (quiet).
    expect(at("2026-10-18T05:00:00Z", { timeZone: "Not/AZone" })).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" });
  });

  it("handles a window that crosses midnight, a person with no quiet hours, and a half-open window", () => {
    const night = parseQuietHours("22:00", "07:00") as QuietHours;
    expect(at("2026-10-18T05:00:00Z", { quietHours: night })).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" }); // 08:00
    expect(at("2026-10-18T03:30:00Z", { quietHours: night })).toEqual({ kind: "SKIP", reason: "quiet_hours" }); // 06:30
    expect(at("2026-10-18T02:00:00Z", { quietHours: parseQuietHours(null, null) })).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" }); // 05:00, none
    expect(at("2026-10-18T05:05:00Z", { quietHours: parseQuietHours("00:00", null) })).toEqual({ kind: "SKIP", reason: "quiet_hours_unknown" });
  });
});

describe("decideWeeklyPush: it never throws", () => {
  it.each<[string, unknown]>([
    ["no input fields", {}],
    ["a string for the instant", { now: "2026-10-18" }],
    ["a null fact and null periods", { fact: null, periods: null, quietHours: null }],
    ["a fact without a card flag", { fact: { weekStart: "2026-10-11" } }],
    ["a garbage zone", { timeZone: 42 }],
    ["an infinite subscription count", { subscriptionCount: Number.POSITIVE_INFINITY }],
  ])("answers for %s", (_label, junk) => {
    const run = () => decideWeeklyPush({ ...sendable, ...(junk as Partial<WeeklyPushInput>) });
    expect(run).not.toThrow();
    expect(["SEND", "SKIP"]).toContain(run().kind);
  });
});

describe("the weekly push constants", () => {
  it("is exempt from the daily budget (the owner's decision of 2026-10-07): written down, and the decision asks nothing about a budget", () => {
    expect(WEEKLY_PUSH.countsTowardDailyBudget).toBe(false);
    const source = (file: string) =>
      readFileSync(join(process.cwd(), "src", "domain", "notifications", file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    for (const file of ["weeklyPush.ts", "reasons.ts"]) {
      expect(source(file), file).not.toMatch(/from\s+["'][^"']*(interventions|engine|budget|cooldown)/i);
    }
    // The decision itself never mentions a budget: there is no input, no gate and no reason about it.
    expect(source("weeklyPush.ts")).not.toMatch(/budget/i);
  });

  it("is the weekly_summary kind, and the five kinds are the five preference keys", () => {
    expect(WEEKLY_PUSH.kind).toBe("weekly_summary");
    expect([...NOTIFICATION_KINDS].sort()).toEqual(["activity", "coach", "meal_reporting", "weekly_summary", "weekly_weigh_in"]);
  });

  it("keeps the moment key short and shaped like the week's date", () => {
    const decision = decide();
    expect(decision.kind).toBe("SEND");
    if (decision.kind === "SEND") {
      expect(decision.momentKey).toMatch(/^weekly:\d{4}-\d{2}-\d{2}$/);
      expect(decision.momentKey.length).toBeLessThanOrEqual(80);
    }
  });

  it("builds the moment key from the week, the same one a send carries", () => {
    expect(weeklyMomentKey("2026-10-11")).toBe("weekly:2026-10-11");
    expect(decide()).toEqual({ kind: "SEND", momentKey: weeklyMomentKey(CARD.weekStart) });
  });

  it("has a reason list without duplicates", () => {
    expect(new Set(WEEKLY_PUSH_SKIP_REASONS).size).toBe(WEEKLY_PUSH_SKIP_REASONS.length);
  });
});

// The push is built on the Home card, so the two must agree. Every state Home can be in is listed here (a Record over the keys,
// so a new HomeState is a compile error until someone decides): only the weekly card may carry the push.
const PUSH_FOR_HOME_STATE: Record<HomeStateKey, boolean> = {
  MORNING: false,
  EVENING: false,
  BEFORE_SHABBAT: false,
  MOTZEI_SHABBAT: false,
  FIRST_WEEK_START: false,
  FIRST_WEEK_SUMMARY_READY: false,
  FIRST_WEEK_WELCOME_BACK: false,
  EARLY_SIGNAL: false,
  MILESTONE_REACHED: false,
  WEEKLY_SUMMARY_READY: true,
  ACTIVE_EXPERIMENT: false,
  SILENCE: false,
};

describe("the push and the Home card never disagree", () => {
  const SHABBAT_BEFORE: OfflinePeriod = { type: "SHABBAT", start: new Date("2026-10-16T14:20:00Z"), end: new Date("2026-10-17T15:35:00Z") };
  const SHABBAT_AFTER: OfflinePeriod = { type: "SHABBAT", start: new Date("2026-10-23T14:10:00Z"), end: new Date("2026-10-24T15:25:00Z") };
  const periods = [SHABBAT_BEFORE, SHABBAT_AFTER];

  function homeFacts(now: Date, offlinePeriods: readonly OfflinePeriod[] = periods): HomeFacts {
    return {
      now,
      timeZone: TZ,
      offlinePeriods,
      hasAnyReport: true,
      lifecycle: "WEEKLY_CYCLE",
      firstWeek: null,
      firstWeekSnoozed: NOT_SNOOZED,
      earlySignal: null,
      quietHours: null,
      milestone: null,
      weekly: CARD,
      activeExperiment: null,
    };
  }

  // Every half hour from Sunday 05:00 (the week is ready) to Wednesday 05:00 (the card window closes).
  const instants: Date[] = [];
  for (let t = Date.parse("2026-10-18T02:00:00Z"); t < Date.parse("2026-10-21T02:00:00Z"); t += 30 * 60_000) instants.push(new Date(t));

  it("sends only where Home shows the weekly card, and only outside quiet hours", () => {
    let sends = 0;
    for (const now of instants) {
      const decision = decide({ now, periods });
      if (decision.kind !== "SEND") continue;
      sends += 1;
      const home = resolveHome(homeFacts(now));
      expect(PUSH_FOR_HOME_STATE[home.state.key], `${now.toISOString()} shows ${home.state.key}`).toBe(true);
      expect(isQuiet(DEFAULT_QUIET, localMinuteOfDay(now, TZ)), now.toISOString()).toBe(false);
    }
    // Not vacuous: from Sunday 08:00 to Tuesday midnight there are plenty of instants outside the quiet window (Wednesday 00:00 to 05:00 is quiet).
    expect(sends).toBeGreaterThan(40);
  });

  it("agrees with Home while an Offline period covers part of the week, and the push waits it out", () => {
    const monday: OfflinePeriod = { type: "USER_DEFINED", start: new Date("2026-10-18T21:00:00Z"), end: new Date("2026-10-19T21:00:00Z") }; // all of Monday, local time
    const withMonday = [...periods, monday];
    let sends = 0;
    let waited = 0;
    for (const now of instants) {
      const decision = decide({ now, periods: withMonday });
      if (now >= monday.start && now < monday.end) {
        expect(decision, now.toISOString()).toEqual({ kind: "SKIP", reason: "offline" });
        expect(resolveHome(homeFacts(now, withMonday)).state.key, now.toISOString()).toBe("SILENCE");
        waited += 1;
        continue;
      }
      if (decision.kind !== "SEND") continue;
      sends += 1;
      expect(PUSH_FOR_HOME_STATE[resolveHome(homeFacts(now, withMonday)).state.key], now.toISOString()).toBe(true);
    }
    expect(waited).toBe(48);
    expect(sends).toBeGreaterThan(20);
  });

  it("has its last chance on Tuesday night: Wednesday 04:00 is quiet and at 05:00 there is no card", () => {
    expect(at("2026-10-20T20:59:00Z")).toEqual({ kind: "SEND", momentKey: "weekly:2026-10-11" }); // Tuesday 23:59
    expect(at("2026-10-20T21:00:00Z")).toEqual({ kind: "SKIP", reason: "quiet_hours" }); // Wednesday 00:00
    expect(at("2026-10-21T01:00:00Z")).toEqual({ kind: "SKIP", reason: "quiet_hours" }); // Wednesday 04:00, the card is still up
  });

  it("allows the push for exactly one of the Home states", () => {
    expect(Object.entries(PUSH_FOR_HOME_STATE).filter(([, allowed]) => allowed).map(([key]) => key)).toEqual(["WEEKLY_SUMMARY_READY"]);
  });
});
