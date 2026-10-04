import { describe, expect, it } from "vitest";
import { localDayOf } from "../time";
import { shiftWeek, weekWindowOf } from "./week";

const TZ = "Asia/Jerusalem";
const HOUR = 3_600_000;
const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / HOUR;

describe("weekWindowOf", () => {
  it("puts a Wednesday in the week of the Sunday before it", () => {
    const week = weekWindowOf(new Date("2026-09-16T09:00:00Z"), TZ);
    expect(week.weekStart).toBe("2026-09-13");
  });

  it("keeps Saturday 23:59:59 in the same week and starts the next one at Sunday 00:00:00", () => {
    // September is UTC+3: Saturday 23:59:59 local is 20:59:59Z.
    expect(weekWindowOf(new Date("2026-09-19T20:59:59Z"), TZ).weekStart).toBe("2026-09-13");
    expect(weekWindowOf(new Date("2026-09-19T21:00:00Z"), TZ).weekStart).toBe("2026-09-20");
  });

  it("is LOCAL, not UTC: Jerusalem Sunday 00:30 (Saturday 21:30Z) is the NEW week, Saturday 22:30 the old one", () => {
    expect(weekWindowOf(new Date("2026-09-19T21:30:00Z"), TZ).weekStart).toBe("2026-09-20");
    expect(weekWindowOf(new Date("2026-09-19T19:30:00Z"), TZ).weekStart).toBe("2026-09-13");
  });

  it("has seven local days, days[0] is the Sunday and `end` is the next Sunday's local midnight", () => {
    const week = weekWindowOf(new Date("2026-09-16T09:00:00Z"), TZ);
    expect(week.days).toHaveLength(7);
    expect(week.days[0].key).toBe(week.weekStart);
    expect(week.days.map((d) => d.key)).toEqual([
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ]);
    expect(week.start.toISOString()).toBe("2026-09-12T21:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-09-19T21:00:00.000Z");
    expect(week.start.getTime()).toBe(week.days[0].start.getTime());
    expect(week.end.getTime()).toBe(week.days[6].end.getTime());
    expect(localDayOf(week.end, TZ).key).toBe("2026-09-20");
    // The days tile the week with no gap.
    for (let i = 1; i < 7; i++) expect(week.days[i].start.getTime()).toBe(week.days[i - 1].end.getTime());
  });

  it("works for the date of the Sunday itself (00:00:00 exactly)", () => {
    const week = weekWindowOf(new Date("2026-09-12T21:00:00Z"), TZ);
    expect(week.weekStart).toBe("2026-09-13");
    expect(week.start.toISOString()).toBe("2026-09-12T21:00:00.000Z");
  });

  it("DST: the spring-forward week of 2027-03-21 is 167 hours and still seven days ending at local midnight", () => {
    const week = weekWindowOf(new Date("2027-03-24T10:00:00Z"), TZ);
    expect(week.weekStart).toBe("2027-03-21");
    expect(hours(week.start, week.end)).toBe(167);
    expect(week.days).toHaveLength(7);
    expect(localDayOf(week.end, TZ).key).toBe("2027-03-28");
    expect(week.end.getTime()).toBe(localDayOf(week.end, TZ).start.getTime());
    // Friday is the 23 hour day.
    expect(hours(week.days[5].start, week.days[5].end)).toBe(23);
  });

  it("DST: the fall-back week of 2026-10-25 is 169 hours and still seven days", () => {
    const week = weekWindowOf(new Date("2026-10-28T10:00:00Z"), TZ);
    expect(week.weekStart).toBe("2026-10-25");
    expect(hours(week.start, week.end)).toBe(169);
    expect(week.days).toHaveLength(7);
    expect(week.end.getTime()).toBe(localDayOf(week.end, TZ).start.getTime());
    // Sunday is the 25 hour day.
    expect(hours(week.days[0].start, week.days[0].end)).toBe(25);
  });

  it("treats a garbage zone as Asia/Jerusalem", () => {
    const at = new Date("2026-09-19T21:30:00Z");
    expect(weekWindowOf(at, "Not/AZone")).toEqual(weekWindowOf(at, TZ));
    expect(weekWindowOf(at, "")).toEqual(weekWindowOf(at, TZ));
  });

  it("another zone gets its own week (the same instant is Saturday in New York)", () => {
    const at = new Date("2026-09-20T02:00:00Z"); // Sunday 05:00 in Jerusalem, Saturday 22:00 in New York
    expect(weekWindowOf(at, TZ).weekStart).toBe("2026-09-20");
    expect(weekWindowOf(at, "America/New_York").weekStart).toBe("2026-09-13");
  });

  it("throws a RangeError for an invalid instant", () => {
    expect(() => weekWindowOf(new Date(Number.NaN), TZ)).toThrow(RangeError);
  });

  it("does not return the same objects twice (no shared mutable state)", () => {
    const at = new Date("2026-09-16T09:00:00Z");
    const a = weekWindowOf(at, TZ);
    const b = weekWindowOf(at, TZ);
    expect(a).toEqual(b);
    expect(a.start).not.toBe(b.start);
  });
});

describe("shiftWeek", () => {
  const base = weekWindowOf(new Date("2026-09-16T09:00:00Z"), TZ);

  it("-1 is the previous week and +1 the next, and they round trip", () => {
    expect(shiftWeek(base, -1, TZ).weekStart).toBe("2026-09-06");
    expect(shiftWeek(base, 1, TZ).weekStart).toBe("2026-09-20");
    expect(shiftWeek(shiftWeek(base, -1, TZ), 1, TZ)).toEqual(base);
    expect(shiftWeek(shiftWeek(base, 2, TZ), -2, TZ)).toEqual(base);
    expect(shiftWeek(base, 0, TZ)).toEqual(base);
  });

  it("the previous week ends exactly where this one starts", () => {
    expect(shiftWeek(base, -1, TZ).end.getTime()).toBe(base.start.getTime());
    expect(shiftWeek(base, 1, TZ).start.getTime()).toBe(base.end.getTime());
  });

  it("shifts across the DST weeks and keeps them whole", () => {
    const before = weekWindowOf(new Date("2026-10-21T10:00:00Z"), TZ);
    const dst = shiftWeek(before, 1, TZ);
    expect(dst.weekStart).toBe("2026-10-25");
    expect(hours(dst.start, dst.end)).toBe(169);
    expect(shiftWeek(dst, -1, TZ)).toEqual(before);
    expect(shiftWeek(dst, 1, TZ).start.getTime()).toBe(dst.end.getTime());

    const spring = shiftWeek(weekWindowOf(new Date("2027-03-17T10:00:00Z"), TZ), 1, TZ);
    expect(spring.weekStart).toBe("2027-03-21");
    expect(hours(spring.start, spring.end)).toBe(167);
  });

  it("agrees with weekWindowOf of an instant inside the shifted week", () => {
    expect(shiftWeek(base, 3, TZ)).toEqual(weekWindowOf(new Date("2026-10-07T09:00:00Z"), TZ));
  });

  it("ignores a non-finite or fractional shift instead of throwing", () => {
    expect(shiftWeek(base, Number.NaN, TZ)).toEqual(base);
    expect(shiftWeek(base, 1.9, TZ)).toEqual(shiftWeek(base, 1, TZ));
  });
});
