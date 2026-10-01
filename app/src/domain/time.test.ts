import { describe, expect, it } from "vitest";
import { localDayOf, localMinuteOfDay, tzOffsetMs, zonedMidnightUtc } from "./time";

const TZ = "Asia/Jerusalem";
const HOUR = 3_600_000;

describe("time helpers", () => {
  it("knows the Jerusalem offset in winter and in summer", () => {
    expect(tzOffsetMs(new Date("2026-01-15T12:00:00Z"), TZ)).toBe(2 * HOUR);
    expect(tzOffsetMs(new Date("2026-07-15T12:00:00Z"), TZ)).toBe(3 * HOUR);
  });

  it("finds the UTC instant of local midnight", () => {
    expect(zonedMidnightUtc(2026, 7, 15, TZ).toISOString()).toBe("2026-07-14T21:00:00.000Z");
    expect(zonedMidnightUtc(2026, 1, 15, TZ).toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });

  it("returns the local day that contains an instant", () => {
    const day = localDayOf(new Date("2026-07-15T22:30:00Z"), TZ); // 01:30 local on the 16th
    expect(day.key).toBe("2026-07-16");
    expect(day.start.toISOString()).toBe("2026-07-15T21:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-07-16T21:00:00.000Z");
  });

  it("handles the 23-hour day when daylight saving time starts (2026-03-27)", () => {
    const day = localDayOf(new Date("2026-03-27T10:00:00Z"), TZ);
    expect(day.key).toBe("2026-03-27");
    expect((day.end.getTime() - day.start.getTime()) / HOUR).toBe(23);
  });

  it("handles the 25-hour day when daylight saving time ends (2026-10-25)", () => {
    const day = localDayOf(new Date("2026-10-25T10:00:00Z"), TZ);
    expect(day.key).toBe("2026-10-25");
    expect((day.end.getTime() - day.start.getTime()) / HOUR).toBe(25);
  });
});

describe("localMinuteOfDay", () => {
  it("counts local midnight as minute 0, never 1440", () => {
    expect(localMinuteOfDay(new Date("2027-01-12T22:00:00Z"), TZ)).toBe(0); // 00:00 on the 13th
    expect(localMinuteOfDay(new Date("2027-01-12T21:59:59Z"), TZ)).toBe(23 * 60 + 59);
    expect(localMinuteOfDay(new Date("2027-01-13T00:00:00Z"), "UTC")).toBe(0);
  });

  it("reads the wall clock of the zone, not of UTC", () => {
    const instant = new Date("2027-01-12T10:30:00Z");
    expect(localMinuteOfDay(instant, TZ)).toBe(12 * 60 + 30); // UTC+2 in winter
    expect(localMinuteOfDay(instant, "UTC")).toBe(10 * 60 + 30);
    expect(localMinuteOfDay(new Date("2027-07-12T10:30:00Z"), TZ)).toBe(13 * 60 + 30); // UTC+3 in summer
  });

  it("gives the repeated hour the same minute twice when daylight saving time ends (2026-10-25)", () => {
    // 02:00 IDT becomes 01:00 IST at 2026-10-24T23:00:00Z, so 01:30 happens twice.
    expect(localMinuteOfDay(new Date("2026-10-24T22:30:00Z"), TZ)).toBe(90); // 01:30 IDT
    expect(localMinuteOfDay(new Date("2026-10-24T23:30:00Z"), TZ)).toBe(90); // 01:30 IST
  });

  it("jumps over the skipped hour when daylight saving time starts (2027-03-26)", () => {
    // 02:00 IST becomes 03:00 IDT at 2027-03-26T00:00:00Z.
    expect(localMinuteOfDay(new Date("2027-03-25T23:59:59Z"), TZ)).toBe(119); // 01:59:59 IST
    expect(localMinuteOfDay(new Date("2027-03-26T00:00:00Z"), TZ)).toBe(180); // 03:00:00 IDT
  });
});
