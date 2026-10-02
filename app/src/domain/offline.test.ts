import { describe, expect, it } from "vitest";
import {
  countAvailableDays,
  isAvailableDay,
  isOffline,
  MAX_SCAN_DAYS,
  offlineFraction,
  type OfflinePeriod,
} from "./offline";
import { localDayOf } from "./time";

const TZ = "Asia/Jerusalem";

// Jerusalem, Friday 2026-10-02 to Saturday 2026-10-03 (candle lighting 17:43, Havdalah 18:58 local).
const shabbat: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2026-10-02T14:43:00Z"),
  end: new Date("2026-10-03T15:58:00Z"),
};

describe("isOffline", () => {
  it("includes the start and excludes the end", () => {
    expect(isOffline([shabbat], new Date("2026-10-02T14:42:59Z"))).toBe(false);
    expect(isOffline([shabbat], new Date("2026-10-02T14:43:00Z"))).toBe(true);
    expect(isOffline([shabbat], new Date("2026-10-03T15:57:59Z"))).toBe(true);
    expect(isOffline([shabbat], new Date("2026-10-03T15:58:00Z"))).toBe(false);
  });

  it("is false with no periods", () => {
    expect(isOffline([], new Date())).toBe(false);
  });
});

describe("offlineFraction", () => {
  it("never counts overlapping periods twice", () => {
    const a: OfflinePeriod = { type: "SHABBAT", start: new Date("2026-10-02T00:00:00Z"), end: new Date("2026-10-02T12:00:00Z") };
    const b: OfflinePeriod = { type: "USER_DEFINED", start: new Date("2026-10-02T06:00:00Z"), end: new Date("2026-10-02T18:00:00Z") };
    expect(offlineFraction([a, b], new Date("2026-10-02T00:00:00Z"), new Date("2026-10-03T00:00:00Z"))).toBeCloseTo(0.75);
  });

  it("is 0 for an empty or backwards range", () => {
    const t = new Date("2026-10-02T00:00:00Z");
    expect(offlineFraction([shabbat], t, t)).toBe(0);
  });
});

describe("available day (less than 50% offline)", () => {
  it("counts Friday, because Shabbat starts in the evening", () => {
    expect(isAvailableDay([shabbat], localDayOf(new Date("2026-10-02T09:00:00Z"), TZ))).toBe(true);
  });

  it("does not count Saturday", () => {
    expect(isAvailableDay([shabbat], localDayOf(new Date("2026-10-03T09:00:00Z"), TZ))).toBe(false);
  });

  it("counts Sunday", () => {
    expect(isAvailableDay([shabbat], localDayOf(new Date("2026-10-04T09:00:00Z"), TZ))).toBe(true);
  });
});

describe("countAvailableDays", () => {
  it("counts whole local days that have ended, skipping Saturday", () => {
    const from = new Date("2026-10-01T09:00:00Z"); // Thursday
    const now = new Date("2026-10-05T09:00:00Z"); // Monday morning
    // Thursday, Friday, Saturday, Sunday have ended. Saturday is not available.
    expect(countAvailableDays([shabbat], TZ, from, now)).toBe(3);
  });

  it("does not count the day in progress", () => {
    const from = new Date("2026-10-01T09:00:00Z");
    expect(countAvailableDays([], TZ, from, new Date("2026-10-01T20:00:00Z"))).toBe(0);
  });
});

describe("countAvailableDays: the cap and the scan limit", () => {
  it("stops at the cap: 10 available days with cap 3 gives 3, and with no cap the old behaviour", () => {
    const from = new Date("2027-01-12T08:00:00Z");
    const now = new Date("2027-01-22T08:00:00Z"); // ten whole days have ended (12th to 21st), no offline period
    expect(countAvailableDays([], TZ, from, now)).toBe(10);
    expect(countAvailableDays([], TZ, from, now, 3)).toBe(3);
    expect(countAvailableDays([], TZ, from, now, 10)).toBe(10);
    expect(countAvailableDays([], TZ, from, now, 50)).toBe(10);
  });

  it("counts only available days toward the cap", () => {
    const from = new Date("2026-10-01T09:00:00Z"); // Thursday; Saturday is the offline day
    const now = new Date("2026-10-12T09:00:00Z");
    expect(countAvailableDays([shabbat], TZ, from, now, 4)).toBe(4);
  });

  it("never walks more than MAX_SCAN_DAYS days, however long the span", () => {
    expect(MAX_SCAN_DAYS).toBe(400);
    // Five years back, nothing offline, no cap: the answer is bounded by the walk, and it returns at once.
    const started = Date.now();
    expect(countAvailableDays([], "UTC", new Date("2021-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"))).toBe(MAX_SCAN_DAYS);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("gives up after the scan limit through an all-offline stretch (documented: unknown beyond it)", () => {
    // 451 days offline, then 5 ordinary days. Without the limit this would be 5.
    const stretch: OfflinePeriod = {
      type: "VACATION",
      start: new Date("2024-01-01T00:00:00Z"),
      end: new Date("2025-03-27T00:00:00Z"),
    };
    const from = new Date("2024-01-01T00:00:00Z");
    const now = new Date("2025-04-01T00:00:00Z");
    expect(countAvailableDays([stretch], "UTC", from, now)).toBe(0);
    // A stretch shorter than the limit is walked through normally.
    const shorter: OfflinePeriod = { ...stretch, end: new Date("2024-12-01T00:00:00Z") };
    expect(countAvailableDays([shorter], "UTC", from, new Date("2024-12-06T00:00:00Z"))).toBe(5);
  });
});

describe("available day boundary: exactly 50% is NOT available", () => {
  const offlineFor = (start: Date, ms: number): OfflinePeriod => ({
    type: "USER_DEFINED",
    start,
    end: new Date(start.getTime() + ms),
  });
  const HOUR = 3_600_000;

  it("a 24 h day: 12 h offline is not available, 12 h minus 1 ms is", () => {
    const day = localDayOf(new Date("2026-10-02T09:00:00Z"), TZ); // Friday 2026-10-02, 24 h
    expect(day.end.getTime() - day.start.getTime()).toBe(24 * HOUR);
    expect(isAvailableDay([offlineFor(day.start, 12 * HOUR)], day)).toBe(false);
    expect(isAvailableDay([offlineFor(day.start, 12 * HOUR - 1)], day)).toBe(true);
    expect(isAvailableDay([offlineFor(day.start, 12 * HOUR + 1)], day)).toBe(false);
  });

  it("the spring-forward Friday 2027-03-26 is 23 h: 11.5 h offline is not available, 11.5 h minus 1 ms is", () => {
    const day = localDayOf(new Date("2027-03-26T09:00:00Z"), TZ);
    expect(day.end.getTime() - day.start.getTime()).toBe(23 * HOUR);
    expect(isAvailableDay([offlineFor(day.start, 11.5 * HOUR)], day)).toBe(false);
    expect(isAvailableDay([offlineFor(day.start, 11.5 * HOUR - 1)], day)).toBe(true);
    // 12 h would be available on a 24 h day, and is not here.
    expect(isAvailableDay([offlineFor(day.start, 12 * HOUR)], day)).toBe(false);
  });

  it("the fall-back Sunday 2026-10-25 is 25 h and counts as ONE day: 12.5 h offline is not available", () => {
    const day = localDayOf(new Date("2026-10-25T10:00:00Z"), TZ);
    expect(day.end.getTime() - day.start.getTime()).toBe(25 * HOUR);
    expect(isAvailableDay([offlineFor(day.start, 12.5 * HOUR)], day)).toBe(false);
    expect(isAvailableDay([offlineFor(day.start, 12.5 * HOUR - 1)], day)).toBe(true);
    // 12 h would not be available on a 24 h day, and is available here.
    expect(isAvailableDay([offlineFor(day.start, 12 * HOUR)], day)).toBe(true);

    const from = new Date("2026-10-25T08:00:00Z");
    expect(countAvailableDays([], TZ, from, new Date("2026-10-25T21:59:59Z"))).toBe(0);
    expect(countAvailableDays([], TZ, from, new Date("2026-10-25T22:00:00Z"))).toBe(1);
    expect(countAvailableDays([], TZ, from, new Date("2026-10-26T21:59:59Z"))).toBe(1);
  });

  it("the spring-forward day is also ONE day in the count", () => {
    const from = new Date("2027-03-26T08:00:00Z");
    expect(countAvailableDays([], TZ, from, new Date("2027-03-26T20:59:59Z"))).toBe(0);
    expect(countAvailableDays([], TZ, from, new Date("2027-03-26T21:00:00Z"))).toBe(1);
  });
});

describe("countAvailableDays: edges of the day loop", () => {
  it("counts the day that ended at exactly local midnight, and not a millisecond earlier", () => {
    const from = new Date("2026-10-01T09:00:00Z"); // Thursday; the day ends at 2026-10-01T21:00:00Z
    expect(countAvailableDays([], TZ, from, new Date("2026-10-01T20:59:59.999Z"))).toBe(0);
    expect(countAvailableDays([], TZ, from, new Date("2026-10-01T21:00:00Z"))).toBe(1);
  });

  it("counts the day First Week began only once it has ended, even when onboarding finished at 23:59", () => {
    const from = new Date("2026-10-01T20:59:00Z"); // 23:59 local on the Thursday
    expect(countAvailableDays([], TZ, from, new Date("2026-10-01T21:00:00Z"))).toBe(1);
    expect(countAvailableDays([], TZ, from, new Date("2026-10-01T20:59:30Z"))).toBe(0);
  });

  it("splits a period that spans two days fractionally", () => {
    // Friday 10:00 to Saturday 10:00 local (UTC+3): 14 h of Friday (over half), 10 h of Saturday (under half).
    const spanning: OfflinePeriod = {
      type: "USER_DEFINED",
      start: new Date("2026-10-02T07:00:00Z"),
      end: new Date("2026-10-03T07:00:00Z"),
    };
    const from = new Date("2026-10-02T05:00:00Z");
    const now = new Date("2026-10-03T21:00:00Z"); // Friday and Saturday have ended
    expect(countAvailableDays([spanning], TZ, from, now)).toBe(1);
    expect(isAvailableDay([spanning], localDayOf(from, TZ))).toBe(false);
    expect(isAvailableDay([spanning], localDayOf(new Date("2026-10-03T12:00:00Z"), TZ))).toBe(true);
  });

  it("lets an offline period that ended on the morning of the first day reduce that day", () => {
    // Counting starts on Friday 2026-10-02 (local). Offline until 09:00 that morning, then until 13:00.
    const day = localDayOf(new Date("2026-10-02T12:00:00Z"), TZ); // from 2026-10-01T21:00Z
    const until = (hour: number): OfflinePeriod => ({
      type: "USER_DEFINED",
      start: new Date("2026-10-01T09:00:00Z"),
      end: new Date(day.start.getTime() + hour * 3_600_000),
    });
    const from = new Date("2026-10-02T11:00:00Z");
    const now = day.end;
    expect(countAvailableDays([until(9)], TZ, from, now)).toBe(1); // 9 h offline: available
    expect(countAvailableDays([until(13)], TZ, from, now)).toBe(0); // 13 h offline: not available
  });
});
