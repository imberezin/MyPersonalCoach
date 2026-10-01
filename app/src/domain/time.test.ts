import { describe, expect, it } from "vitest";
import { localDayOf, tzOffsetMs, zonedMidnightUtc } from "./time";

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
