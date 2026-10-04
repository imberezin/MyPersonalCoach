import { describe, expect, it } from "vitest";
import type { OfflinePeriod } from "../offline";
import { zonedInstantUtc } from "../time";
import { activeWeeklySnooze, decideWeeklyMoment, weeklyCardPrecheck, weeklyReadyAt, type WeeklyMoment } from "./moment";
import { weekWindowOf } from "./week";

const TZ = "Asia/Jerusalem";
const HOUR = 3_600_000;

/** A local wall-clock instant: day "YYYY-MM-DD", time "HH:MM". */
function local(day: string, time = "00:00", tz = TZ): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedInstantUtc(y, m, d, hh, mm, tz);
}

/** Shabbat as in Jerusalem: Friday 17:00 to Saturday 18:00 local. */
const shabbat = (friday: string, saturday: string): OfflinePeriod => ({ type: "SHABBAT", start: local(friday, "17:00"), end: local(saturday, "18:00") });
const SHABBAT_OCT_16: OfflinePeriod = shabbat("2026-10-16", "2026-10-17");

const EARLY = local("2026-09-20", "10:00"); // a transition long before the weeks below

type ReadyMoment = Extract<WeeklyMoment, { kind: "READY" }>;

function decide(over: Partial<Parameters<typeof decideWeeklyMoment>[0]> = {}): WeeklyMoment {
  return decideWeeklyMoment({
    now: local("2026-10-18", "05:00"),
    timeZone: TZ,
    lifecycle: "WEEKLY_CYCLE",
    firstWeekEndedAt: EARLY,
    periods: [SHABBAT_OCT_16],
    aggregatedReportConfirmedAt: null,
    ...over,
  });
}

function ready(over: Partial<Parameters<typeof decideWeeklyMoment>[0]> = {}): ReadyMoment {
  const moment = decide(over);
  if (moment.kind !== "READY") throw new Error(`expected READY, got ${moment.reason}`);
  return moment;
}

describe("decideWeeklyMoment: readiness", () => {
  it("makes the previous week the candidate at Sunday 05:00:00 and the week before it at 04:59:59", () => {
    expect(ready({ now: new Date("2026-10-18T02:00:00Z") }).week.weekStart).toBe("2026-10-11");
    expect(ready({ now: new Date("2026-10-18T01:59:59Z") }).week.weekStart).toBe("2026-10-04");
  });

  it("is the same at Sunday 00:00 as at 04:59 (still the week before last)", () => {
    expect(ready({ now: local("2026-10-18", "00:00") }).week.weekStart).toBe("2026-10-04");
    expect(ready({ now: local("2026-10-18", "04:59") }).week.weekStart).toBe("2026-10-04");
  });

  it("keeps the same candidate for the rest of the week, until the next Sunday 05:00", () => {
    expect(ready({ now: local("2026-10-24", "23:59") }).week.weekStart).toBe("2026-10-11");
    expect(ready({ now: local("2026-10-25", "04:59") }).week.weekStart).toBe("2026-10-11");
    expect(ready({ now: local("2026-10-25", "05:00") }).week.weekStart).toBe("2026-10-18");
  });

  it("reports the readiness instant and the window end of the candidate", () => {
    const moment = ready({ now: local("2026-10-19", "10:00") });
    expect(moment.readyAt.toISOString()).toBe(local("2026-10-18", "05:00").toISOString());
    expect(moment.window.end.toISOString()).toBe(moment.week.end.toISOString());
  });

  it("the 25 hour Sunday (2026-10-25) does not move 05:00 local", () => {
    // After the fall-back the zone is UTC+2: 05:00 local is 03:00Z.
    expect(ready({ now: new Date("2026-10-25T03:00:00Z"), periods: [] }).week.weekStart).toBe("2026-10-18");
    expect(ready({ now: new Date("2026-10-25T02:59:59Z"), periods: [] }).week.weekStart).toBe("2026-10-11");
  });

  it("the 23 hour Friday (2027-03-26) does not move the next Sunday's 05:00 local", () => {
    // Summer time is UTC+3: Sunday 2027-03-28 05:00 local is 02:00Z.
    expect(ready({ now: new Date("2027-03-28T02:00:00Z"), periods: [], firstWeekEndedAt: EARLY }).week.weekStart).toBe("2027-03-21");
    expect(ready({ now: new Date("2027-03-28T01:59:59Z"), periods: [], firstWeekEndedAt: EARLY }).week.weekStart).toBe("2027-03-14");
  });
});

describe("weeklyReadyAt: the aggregated Motzei Shabbat report seam", () => {
  const week = weekWindowOf(local("2026-10-14", "12:00"), TZ); // 2026-10-11 .. 2026-10-18
  const base = local("2026-10-18", "05:00");

  it("null is the base: the next Sunday 05:00 local", () => {
    expect(weeklyReadyAt({ week, timeZone: TZ, aggregatedReportConfirmedAt: null }).toISOString()).toBe(base.toISOString());
  });

  it("a confirmation 3 h before the week's end brings the readiness to that instant", () => {
    const confirmed = new Date(week.end.getTime() - 3 * HOUR);
    expect(weeklyReadyAt({ week, timeZone: TZ, aggregatedReportConfirmedAt: confirmed }).toISOString()).toBe(confirmed.toISOString());
  });

  it("makes the CURRENT week the candidate from that instant", () => {
    const confirmed = new Date(week.end.getTime() - 3 * HOUR);
    const at = (now: Date) => decide({ now, aggregatedReportConfirmedAt: confirmed });
    expect(at(new Date(confirmed.getTime() - 1))).toMatchObject({ kind: "READY", week: { weekStart: "2026-10-04" } });
    expect(at(confirmed)).toMatchObject({ kind: "READY", week: { weekStart: "2026-10-11" } });
  });

  it("counts a confirmation exactly 36 h before the end, and ignores one 40 h before", () => {
    const exactly = new Date(week.end.getTime() - 36 * HOUR);
    const tooEarly = new Date(week.end.getTime() - 40 * HOUR);
    expect(weeklyReadyAt({ week, timeZone: TZ, aggregatedReportConfirmedAt: exactly }).toISOString()).toBe(exactly.toISOString());
    expect(weeklyReadyAt({ week, timeZone: TZ, aggregatedReportConfirmedAt: tooEarly }).toISOString()).toBe(base.toISOString());
  });

  it("a confirmation later than the base changes nothing", () => {
    const later = new Date(base.getTime() + 10 * HOUR);
    expect(weeklyReadyAt({ week, timeZone: TZ, aggregatedReportConfirmedAt: later }).toISOString()).toBe(base.toISOString());
  });

  it("an invalid confirmation is the base", () => {
    expect(weeklyReadyAt({ week, timeZone: TZ, aggregatedReportConfirmedAt: new Date(Number.NaN) }).toISOString()).toBe(base.toISOString());
  });
});

describe("decideWeeklyMoment: the window", () => {
  const NOW = local("2026-10-18", "05:00"); // the week 2026-10-11 .. 2026-10-17 is the candidate

  it("starts the window at the next local midnight after a Sunday transition, so the transition day is excluded", () => {
    const moment = ready({ now: NOW, firstWeekEndedAt: local("2026-10-11", "10:00") });
    expect(moment.window.start.toISOString()).toBe(local("2026-10-12").toISOString());
    expect(moment.availableDays).toBe(5); // Monday to Friday; Saturday is Shabbat
  });

  it("starts at week.start when the transition was earlier than the week", () => {
    const moment = ready({ now: NOW, firstWeekEndedAt: local("2026-10-08", "10:00") });
    expect(moment.window.start.toISOString()).toBe(moment.week.start.toISOString());
    expect(moment.availableDays).toBe(6); // Sunday to Friday
  });

  it("a transition on the Saturday before the week still gives the whole week", () => {
    const moment = ready({ now: NOW, firstWeekEndedAt: local("2026-10-10", "20:00") });
    expect(moment.window.start.toISOString()).toBe(moment.week.start.toISOString());
  });

  it("a transition on Wednesday leaves Thursday and Friday: too short", () => {
    expect(decide({ now: NOW, firstWeekEndedAt: local("2026-10-14", "10:00") })).toEqual({ kind: "NONE", reason: "window_too_short" });
  });

  it("4 available days are eligible and 3 are not (Tuesday to Friday versus Wednesday to Friday)", () => {
    expect(ready({ now: NOW, firstWeekEndedAt: local("2026-10-12", "10:00") }).availableDays).toBe(4);
    expect(decide({ now: NOW, firstWeekEndedAt: local("2026-10-13", "10:00") })).toEqual({ kind: "NONE", reason: "window_too_short" });
  });

  it("does not fall back to an older week when the candidate is too short", () => {
    expect(decide({ now: NOW, firstWeekEndedAt: local("2026-10-14", "10:00") }).kind).toBe("NONE");
  });

  it("a transition after the candidate week has no window at all", () => {
    expect(decide({ now: NOW, firstWeekEndedAt: local("2026-10-18", "03:00") })).toEqual({ kind: "NONE", reason: "window_too_short" });
  });

  it("the owner's calendar: continuing on Wednesday 2026-10-07 skips the week of 10-04 and the first card is Sunday 10-18", () => {
    const firstWeekEndedAt = local("2026-10-07", "20:00");
    const periods = [shabbat("2026-10-09", "2026-10-10"), SHABBAT_OCT_16];
    // Sunday 2026-10-11 05:00: the candidate is the week of 10-04, with only Thursday and Friday after the transition.
    expect(decide({ now: local("2026-10-11", "05:00"), firstWeekEndedAt, periods })).toEqual({ kind: "NONE", reason: "window_too_short" });
    const first = ready({ now: local("2026-10-18", "05:00"), firstWeekEndedAt, periods });
    expect(first.week.weekStart).toBe("2026-10-11");
    expect(first.availableDays).toBe(6);
  });

  it("the owner's calendar: continuing on Monday 2026-10-19 leaves Tuesday to Friday, eligible, and the card is Sunday 10-25", () => {
    const firstWeekEndedAt = local("2026-10-19", "20:00");
    const periods = [shabbat("2026-10-23", "2026-10-24")];
    const moment = ready({ now: local("2026-10-25", "05:00"), firstWeekEndedAt, periods });
    expect(moment.week.weekStart).toBe("2026-10-18");
    expect(moment.availableDays).toBe(4);
  });

  it("a Friday that is mostly offline is not an available day (Tuesday to Friday with a long Friday is 3: too short)", () => {
    const longFriday: OfflinePeriod = { type: "SHABBAT", start: local("2026-10-16", "08:00"), end: local("2026-10-17", "18:00") };
    expect(decide({ now: NOW, firstWeekEndedAt: local("2026-10-12", "10:00"), periods: [longFriday] })).toEqual({ kind: "NONE", reason: "window_too_short" });
  });

  it("a Friday that is exactly 50% offline is not available; a minute less offline is", () => {
    const half: OfflinePeriod = { type: "SHABBAT", start: local("2026-10-16", "12:00"), end: local("2026-10-17", "18:00") };
    const justUnder: OfflinePeriod = { type: "SHABBAT", start: local("2026-10-16", "12:01"), end: local("2026-10-17", "18:00") };
    const firstWeekEndedAt = local("2026-10-12", "10:00");
    expect(decide({ now: NOW, firstWeekEndedAt, periods: [half] })).toEqual({ kind: "NONE", reason: "window_too_short" });
    expect(ready({ now: NOW, firstWeekEndedAt, periods: [justUnder] }).availableDays).toBe(4);
  });

  it("without offline rows every day of the window counts (the Shabbat rows ran out)", () => {
    expect(ready({ now: NOW, periods: [] }).availableDays).toBe(7);
  });
});

describe("decideWeeklyMoment: the NONE reasons", () => {
  it("firstWeekEndedAt null or invalid -> no_cycle_start", () => {
    expect(decide({ firstWeekEndedAt: null })).toEqual({ kind: "NONE", reason: "no_cycle_start" });
    expect(decide({ firstWeekEndedAt: new Date(Number.NaN) })).toEqual({ kind: "NONE", reason: "no_cycle_start" });
  });

  it.each(["FIRST_WEEK", "NEW", "ONBOARDING", null] as const)("lifecycle %s -> not_weekly_cycle", (lifecycle) => {
    expect(decide({ lifecycle })).toEqual({ kind: "NONE", reason: "not_weekly_cycle" });
  });

  it("an invalid `now` -> invalid_input", () => {
    expect(decide({ now: new Date(Number.NaN) })).toEqual({ kind: "NONE", reason: "invalid_input" });
  });

  it("a garbage zone behaves as Jerusalem", () => {
    expect(decide({ timeZone: "Not/AZone" })).toEqual(decide({ timeZone: TZ }));
  });

  it("does not mutate its inputs", () => {
    const periods = [SHABBAT_OCT_16];
    const now = local("2026-10-18", "05:00");
    const snapshot = JSON.stringify({ periods, now });
    decide({ periods, now });
    expect(JSON.stringify({ periods, now })).toBe(snapshot);
  });
});

describe("decideWeeklyMoment: cardVisible", () => {
  it("is true at Sunday 05:00 and at Wednesday 04:59:59, false at Wednesday 05:00", () => {
    expect(ready({ now: new Date("2026-10-18T02:00:00Z") }).cardVisible).toBe(true);
    expect(ready({ now: new Date("2026-10-21T01:59:59Z") }).cardVisible).toBe(true);
    expect(ready({ now: new Date("2026-10-21T02:00:00Z") }).cardVisible).toBe(false);
  });

  it("is false for the rest of the week and true again on the next Sunday morning", () => {
    expect(ready({ now: local("2026-10-24", "12:00") }).cardVisible).toBe(false);
    expect(ready({ now: local("2026-10-25", "05:00"), periods: [] }).cardVisible).toBe(true);
  });

  it("counts LOCAL days: an earlier readiness across the fall-back keeps the same wall-clock hour three days on", () => {
    // Confirmed on Saturday 2026-10-24 at 21:00 local (UTC+3); the clock goes back on Sunday 02:00, so three local days
    // later (Tuesday 21:00, UTC+2) is 73 real hours away, not 72.
    const confirmed = local("2026-10-24", "21:00");
    const at = (now: Date) => ready({ now, periods: [], aggregatedReportConfirmedAt: confirmed });
    expect(at(new Date(confirmed.getTime() + 72 * HOUR + 30 * 60_000)).cardVisible).toBe(true);
    expect(at(local("2026-10-27", "21:00")).cardVisible).toBe(false);
  });
});

describe("weeklyCardPrecheck", () => {
  it("is null outside the card window and non-null inside it", () => {
    const check = (now: Date) => weeklyCardPrecheck({ now, timeZone: TZ, aggregatedReportConfirmedAt: null });
    expect(check(new Date("2026-10-18T01:59:59Z"))).toBeNull();
    expect(check(new Date("2026-10-18T02:00:00Z"))?.week.weekStart).toBe("2026-10-11");
    expect(check(new Date("2026-10-21T01:59:59Z"))?.week.weekStart).toBe("2026-10-11");
    expect(check(new Date("2026-10-21T02:00:00Z"))).toBeNull();
    expect(check(local("2026-10-23", "12:00"))).toBeNull();
  });

  it("returns the readiness of the candidate", () => {
    const found = weeklyCardPrecheck({ now: local("2026-10-19", "09:00"), timeZone: TZ, aggregatedReportConfirmedAt: null });
    expect(found?.readyAt.toISOString()).toBe(local("2026-10-18", "05:00").toISOString());
  });

  it("is null for an invalid `now` and never throws", () => {
    expect(weeklyCardPrecheck({ now: new Date(Number.NaN), timeZone: TZ, aggregatedReportConfirmedAt: null })).toBeNull();
  });

  it("agrees with decideWeeklyMoment's cardVisible and week", () => {
    for (const now of [local("2026-10-18", "04:59"), local("2026-10-18", "05:00"), local("2026-10-20", "12:00"), local("2026-10-21", "05:00"), local("2026-10-22", "12:00")]) {
      const pre = weeklyCardPrecheck({ now, timeZone: TZ, aggregatedReportConfirmedAt: null });
      const moment = decide({ now });
      if (moment.kind !== "READY") throw new Error("expected READY");
      expect(pre !== null).toBe(moment.cardVisible);
      if (pre) expect(pre.week.weekStart).toBe(moment.week.weekStart);
    }
  });
});

describe("activeWeeklySnooze", () => {
  const NOW = new Date("2026-10-19T10:00:00Z");
  const snooze = (events: { week: unknown; occurredAt: Date }[], weekStart = "2026-10-11", now = NOW) => activeWeeklySnooze({ events, weekStart, now });

  it("is true for an event of the same week 1 h old", () => {
    expect(snooze([{ week: "2026-10-11", occurredAt: new Date(NOW.getTime() - HOUR) }])).toBe(true);
  });

  it("is false at exactly 24 h (the snooze expired) and true one millisecond before", () => {
    expect(snooze([{ week: "2026-10-11", occurredAt: new Date(NOW.getTime() - 24 * HOUR) }])).toBe(false);
    expect(snooze([{ week: "2026-10-11", occurredAt: new Date(NOW.getTime() - 24 * HOUR + 1) }])).toBe(true);
  });

  it("counts an event at `now` itself", () => {
    expect(snooze([{ week: "2026-10-11", occurredAt: NOW }])).toBe(true);
  });

  it("ignores another week's event", () => {
    expect(snooze([{ week: "2026-10-04", occurredAt: new Date(NOW.getTime() - HOUR) }])).toBe(false);
  });

  it("ignores a future event, a non-string week and an invalid date, and never throws", () => {
    expect(snooze([{ week: "2026-10-11", occurredAt: new Date(NOW.getTime() + 1) }])).toBe(false);
    expect(snooze([{ week: 20261011, occurredAt: new Date(NOW.getTime() - HOUR) }])).toBe(false);
    expect(snooze([{ week: null, occurredAt: new Date(NOW.getTime() - HOUR) }])).toBe(false);
    expect(snooze([{ week: "2026-10-11", occurredAt: new Date(Number.NaN) }])).toBe(false);
    expect(snooze([{ week: "2026-10-11", occurredAt: new Date(NOW.getTime() - HOUR) }], "2026-10-11", new Date(Number.NaN))).toBe(false);
    expect(snooze([])).toBe(false);
  });

  it("finds the matching event among several", () => {
    expect(
      snooze([
        { week: "2026-10-04", occurredAt: new Date(NOW.getTime() - HOUR) },
        { week: "2026-10-11", occurredAt: new Date(NOW.getTime() - 30 * HOUR) },
        { week: "2026-10-11", occurredAt: new Date(NOW.getTime() - 2 * HOUR) },
      ]),
    ).toBe(true);
  });
});
