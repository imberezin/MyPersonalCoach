import { describe, expect, it } from "vitest";
import { eveningOfDay, instantAfterDays } from "./asOf";
import { countAvailableDays } from "./offline";
import { localDayOf, localMinuteOfDay } from "./time";

const TZ = "Asia/Jerusalem";
// Thursday 2026-10-01 20:00 local (UTC+3): onboarding finished in the evening of the first day.
const STARTED = new Date("2026-10-01T17:00:00Z");

describe("instantAfterDays", () => {
  it.each([
    [0, "2026-10-01"],
    [1, "2026-10-02"],
    [5, "2026-10-06"],
  ])("day %i is the local day %s at the default 09:00", (days, key) => {
    const at = instantAfterDays({ startedAt: STARTED, days, timeZone: TZ });
    expect(localDayOf(at, TZ).key).toBe(key);
    expect(localMinuteOfDay(at, TZ)).toBe(9 * 60);
  });

  it("takes an explicit wall-clock time", () => {
    const at = instantAfterDays({ startedAt: STARTED, days: 4, time: "21:40", timeZone: TZ });
    expect(localDayOf(at, TZ).key).toBe("2026-10-05");
    expect(localMinuteOfDay(at, TZ)).toBe(21 * 60 + 40);
    expect(at.toISOString()).toBe("2026-10-05T18:40:00.000Z");
  });

  it("is correct across the fall-back day (2026-10-25, 25 h)", () => {
    const started = new Date("2026-10-23T09:00:00Z");
    for (const [days, key] of [[1, "2026-10-24"], [2, "2026-10-25"], [3, "2026-10-26"]] as const) {
      const at = instantAfterDays({ startedAt: started, days, time: "09:00", timeZone: TZ });
      expect(localDayOf(at, TZ).key).toBe(key);
      expect(localMinuteOfDay(at, TZ)).toBe(540);
    }
    // 09:00 IST on the fall-back day is an hour later in UTC than 09:00 IDT the day before.
    expect(instantAfterDays({ startedAt: started, days: 2, timeZone: TZ }).toISOString()).toBe("2026-10-25T07:00:00.000Z");
    expect(instantAfterDays({ startedAt: started, days: 1, timeZone: TZ }).toISOString()).toBe("2026-10-24T06:00:00.000Z");
  });

  it("is correct across the spring-forward day (2027-03-26, 23 h)", () => {
    const started = new Date("2027-03-24T09:00:00Z");
    for (const [days, key] of [[1, "2027-03-25"], [2, "2027-03-26"], [3, "2027-03-27"]] as const) {
      const at = instantAfterDays({ startedAt: started, days, time: "21:30", timeZone: TZ });
      expect(localDayOf(at, TZ).key).toBe(key);
      expect(localMinuteOfDay(at, TZ)).toBe(21 * 60 + 30);
    }
  });

  it("round-trips with countAvailableDays: N days after the start is N for a span with no offline day", () => {
    for (const days of [0, 1, 4, 5, 14, 15]) {
      const now = instantAfterDays({ startedAt: STARTED, days, timeZone: TZ });
      expect(countAvailableDays([], TZ, STARTED, now)).toBe(days);
    }
  });

  it.each([-1, 1.5, Number.NaN])("throws a RangeError for days %s", (days) => {
    expect(() => instantAfterDays({ startedAt: STARTED, days, timeZone: TZ })).toThrow(RangeError);
  });

  it.each(["9:00", "24:00", "09:60", "", "09:00:00", "nine"])("throws a RangeError for time %j", (time) => {
    expect(() => instantAfterDays({ startedAt: STARTED, days: 1, time, timeZone: TZ })).toThrow(RangeError);
  });

  it("throws a RangeError for an invalid start", () => {
    expect(() => instantAfterDays({ startedAt: new Date("nope"), days: 1, timeZone: TZ })).toThrow(RangeError);
  });
});

describe("eveningOfDay", () => {
  it("day 1 is the start day, day 3 the third local day", () => {
    const first = eveningOfDay({ startedAt: STARTED, day: 1, time: "21:30", timeZone: TZ });
    expect(localDayOf(first, TZ).key).toBe("2026-10-01");
    const third = eveningOfDay({ startedAt: STARTED, day: 3, time: "21:30", timeZone: TZ });
    expect(localDayOf(third, TZ).key).toBe("2026-10-03");
    expect(localMinuteOfDay(third, TZ)).toBe(21 * 60 + 30);
    expect(third.toISOString()).toBe("2026-10-03T18:30:00.000Z");
  });

  it("agrees with instantAfterDays (day N+1 is N days after)", () => {
    expect(eveningOfDay({ startedAt: STARTED, day: 4, time: "09:00", timeZone: TZ }).getTime()).toBe(
      instantAfterDays({ startedAt: STARTED, days: 3, timeZone: TZ }).getTime(),
    );
  });

  it("keeps the wall-clock time on the DST days", () => {
    const started = new Date("2026-10-23T09:00:00Z");
    const at = eveningOfDay({ startedAt: started, day: 3, time: "21:30", timeZone: TZ });
    expect(localDayOf(at, TZ).key).toBe("2026-10-25");
    expect(localMinuteOfDay(at, TZ)).toBe(21 * 60 + 30);
    expect(at.toISOString()).toBe("2026-10-25T19:30:00.000Z");
  });

  it.each([0, -2, 2.5])("throws a RangeError for day %s", (day) => {
    expect(() => eveningOfDay({ startedAt: STARTED, day, time: "21:30", timeZone: TZ })).toThrow(RangeError);
  });

  it("throws a RangeError for an invalid time", () => {
    expect(() => eveningOfDay({ startedAt: STARTED, day: 1, time: "9pm", timeZone: TZ })).toThrow(RangeError);
  });
});
