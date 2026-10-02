import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import { HOME_FALLBACK_TIME_ZONE, resolveTimeZone as resolveTimeZoneFromHome } from "./home";
import { localDayOf, localMinuteOfDay, resolveTimeZone, tzOffsetMs, zonedInstantUtc, zonedMidnightUtc } from "./time";

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

describe("zonedInstantUtc", () => {
  it("finds the instant of an ordinary wall-clock time, in winter and in summer", () => {
    expect(zonedInstantUtc(2027, 1, 12, 12, 30, TZ).toISOString()).toBe("2027-01-12T10:30:00.000Z"); // UTC+2
    expect(zonedInstantUtc(2027, 7, 12, 12, 30, TZ).toISOString()).toBe("2027-07-12T09:30:00.000Z"); // UTC+3
  });

  it("agrees with zonedMidnightUtc at 00:00", () => {
    expect(zonedInstantUtc(2026, 7, 15, 0, 0, TZ).toISOString()).toBe(zonedMidnightUtc(2026, 7, 15, TZ).toISOString());
    expect(zonedInstantUtc(2026, 1, 15, 0, 0, TZ).toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });

  it("handles a year boundary", () => {
    expect(zonedInstantUtc(2027, 1, 1, 0, 30, TZ).toISOString()).toBe("2026-12-31T22:30:00.000Z");
    expect(zonedInstantUtc(2026, 12, 31, 23, 59, TZ).toISOString()).toBe("2026-12-31T21:59:00.000Z");
  });

  it("gives UTC and Asia/Jerusalem different instants for the same wall time", () => {
    expect(zonedInstantUtc(2027, 1, 12, 8, 0, "UTC").toISOString()).toBe("2027-01-12T08:00:00.000Z");
    expect(zonedInstantUtc(2027, 1, 12, 8, 0, TZ).toISOString()).toBe("2027-01-12T06:00:00.000Z");
  });

  it("resolves the same gap and repeated hour in a zone whose jump falls later in the UTC day (New York)", () => {
    // 02:00 EST becomes 03:00 EDT at 07:00Z on 2027-03-14, so 02:30 does not exist.
    expect(zonedInstantUtc(2027, 3, 14, 2, 30, "America/New_York").toISOString()).toBe("2027-03-14T07:00:00.000Z");
    // 01:30 happens twice on 2027-11-07; the first one (EDT) is meant.
    expect(zonedInstantUtc(2027, 11, 7, 1, 30, "America/New_York").toISOString()).toBe("2027-11-07T05:30:00.000Z");
  });

  it("resolves a time skipped by the spring-forward jump (2027-03-26) to the first instant after the gap", () => {
    // 02:00 IST becomes 03:00 IDT at 2027-03-26T00:00:00Z, so 02:00-02:59 do not exist.
    expect(zonedInstantUtc(2027, 3, 26, 2, 30, TZ).toISOString()).toBe("2027-03-26T00:00:00.000Z");
    expect(zonedInstantUtc(2027, 3, 26, 2, 0, TZ).toISOString()).toBe("2027-03-26T00:00:00.000Z");
    expect(localMinuteOfDay(zonedInstantUtc(2027, 3, 26, 2, 30, TZ), TZ)).toBe(180); // 03:00 IDT
  });

  it("is exact on both sides of the spring-forward gap", () => {
    expect(zonedInstantUtc(2027, 3, 26, 1, 59, TZ).toISOString()).toBe("2027-03-25T23:59:00.000Z"); // 01:59 IST
    expect(zonedInstantUtc(2027, 3, 26, 3, 0, TZ).toISOString()).toBe("2027-03-26T00:00:00.000Z"); // 03:00 IDT
    expect(zonedInstantUtc(2027, 3, 26, 3, 1, TZ).toISOString()).toBe("2027-03-26T00:01:00.000Z");
  });

  it("resolves a repeated time on the fall-back day (2026-10-25) to its first occurrence", () => {
    // 02:00 IDT becomes 01:00 IST at 2026-10-24T23:00:00Z, so 01:00-01:59 happens twice.
    expect(zonedInstantUtc(2026, 10, 25, 1, 30, TZ).toISOString()).toBe("2026-10-24T22:30:00.000Z"); // the IDT one
    expect(zonedInstantUtc(2026, 10, 25, 1, 0, TZ).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("is exact on both sides of the fall-back hour", () => {
    expect(zonedInstantUtc(2026, 10, 25, 0, 59, TZ).toISOString()).toBe("2026-10-24T21:59:00.000Z"); // IDT
    expect(zonedInstantUtc(2026, 10, 25, 2, 0, TZ).toISOString()).toBe("2026-10-25T00:00:00.000Z"); // IST, after the repeat
  });

  it("round-trips every ordinary wall minute of a DST day through localMinuteOfDay", () => {
    for (const [y, m, d] of [[2026, 10, 25], [2027, 3, 26]] as const) {
      for (let minute = 0; minute < 1440; minute += 7) {
        const instant = zonedInstantUtc(y, m, d, Math.floor(minute / 60), minute % 60, TZ);
        const back = localMinuteOfDay(instant, TZ);
        // A skipped minute moves forward to the first valid one, so it can only land later, never earlier.
        expect(back).toBeGreaterThanOrEqual(minute);
        expect(back - minute).toBeLessThanOrEqual(60);
      }
    }
  });

  it("works for a zone without daylight saving time", () => {
    expect(zonedInstantUtc(2027, 3, 26, 2, 30, "UTC").toISOString()).toBe("2027-03-26T02:30:00.000Z");
  });
});

describe("resolveTimeZone (moved here from home/resolve so nothing below home/ imports it)", () => {
  it.each(["UTC", "Asia/Jerusalem", "America/New_York"])("returns the valid zone %s unchanged", (tz) => {
    expect(resolveTimeZone(tz)).toBe(tz);
  });

  it.each(["Not/AZone", "", " ", "Jerusalem", "<script>"])("falls back to Jerusalem for %j", (tz) => {
    expect(resolveTimeZone(tz)).toBe("Asia/Jerusalem");
  });

  it("falls back for values that are not strings at all (the column is untyped at run time)", () => {
    for (const bad of [undefined, null, 42, {}]) expect(resolveTimeZone(bad as unknown as string)).toBe("Asia/Jerusalem");
  });

  it("uses the same fallback as Home and the rest of the app", () => {
    expect(resolveTimeZone("garbage")).toBe(HOME_FALLBACK_TIME_ZONE);
    expect(resolveTimeZone("garbage")).toBe(DEFAULT_TIME_ZONE);
  });

  it("is still exported by @/domain/home, the same function", () => {
    expect(resolveTimeZoneFromHome).toBe(resolveTimeZone);
  });
});

describe("no import cycle below home/", () => {
  const importsOf = (relative: string): string[] => {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  };

  it.each(["./firstWeekFlow/progress.ts", "./patterns/detect.ts"])("%s does not import home/", (file) => {
    const imports = importsOf(file);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).not.toMatch(/(^|\/)home(\/|$)/);
  });

  it("nothing in firstWeekFlow/, patterns/ or experiments/ imports home/, lib/ or the UI", () => {
    for (const file of [
      "./firstWeekFlow/types.ts",
      "./firstWeekFlow/progress.ts",
      "./firstWeekFlow/snooze.ts",
      "./firstWeekFlow/acknowledgement.ts",
      "./firstWeekFlow/summary.ts",
      "./patterns/types.ts",
      "./patterns/detect.ts",
      "./patterns/status.ts",
      "./patterns/earlySignal.ts",
      "./experiments/types.ts",
      "./experiments/map.ts",
      "./experiments/select.ts",
    ]) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)home(\/|$)|^@\//);
      }
    }
  });
});
