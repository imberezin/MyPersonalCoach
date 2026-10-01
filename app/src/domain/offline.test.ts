import { describe, expect, it } from "vitest";
import {
  countAvailableDays,
  isAvailableDay,
  isOffline,
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
