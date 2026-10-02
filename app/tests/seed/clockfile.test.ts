import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  formatClockInstant,
  parseClockText,
  parseShift,
  readClockFile,
  removeClockFile,
  shiftInstant,
  writeClockFile,
} from "../../scripts/seed-demo/clockfile";

const dir = mkdtempSync(join(tmpdir(), "seed-clock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("formatClockInstant", () => {
  it.each([
    ["2026-09-16T06:00:00.000Z", "Asia/Jerusalem", "2026-09-16T09:00:00+03:00"],
    ["2026-12-16T07:00:00.000Z", "Asia/Jerusalem", "2026-12-16T09:00:00+02:00"],
    ["2026-09-16T13:00:00.000Z", "America/New_York", "2026-09-16T09:00:00-04:00"],
    ["2026-09-16T03:30:00.000Z", "Asia/Kolkata", "2026-09-16T09:00:00+05:30"],
    ["2026-09-16T09:00:00.000Z", "UTC", "2026-09-16T09:00:00+00:00"],
    // The wall clock crosses midnight relative to UTC.
    ["2026-09-15T22:30:00.000Z", "Asia/Jerusalem", "2026-09-16T01:30:00+03:00"],
    // Fractions of a second are cut, not rounded up into the next second.
    ["2026-09-16T06:00:00.999Z", "Asia/Jerusalem", "2026-09-16T09:00:00+03:00"],
  ])("%s in %s", (iso, zone, expected) => {
    expect(formatClockInstant(new Date(iso), zone)).toBe(expected);
  });

  it("is always a text the app's own clock reader accepts, and reads back to the same instant", () => {
    for (const zone of ["Asia/Jerusalem", "America/New_York", "Asia/Kolkata", "UTC", "Australia/Lord_Howe"]) {
      for (const iso of ["2026-03-27T12:00:00Z", "2026-09-16T06:00:00Z", "2026-10-25T00:30:00Z", "2026-12-31T23:59:59Z"]) {
        const text = formatClockInstant(new Date(iso), zone);
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
        expect(parseClockText(text)?.toISOString(), `${iso} ${zone}`).toBe(iso.replace("Z", ".000Z").replace(".000.000", ".000"));
      }
    }
  });
});

describe("shifts", () => {
  it.each([
    ["+25h", 25 * 3_600_000],
    ["-2h", -2 * 3_600_000],
    ["+15d", 15 * 86_400_000],
    ["+13d", 13 * 86_400_000],
    ["+1d", 86_400_000],
    ["+30m", 30 * 60_000],
    [" +2h ", 2 * 3_600_000],
  ])("%s", (spec, ms) => {
    expect(parseShift(spec)).toBe(ms);
  });

  it.each(["25h", "+25", "+h", "+25x", "+-2h", "", "+12345h", "now", "+1.5h"])("%j is not a shift", (spec) => {
    expect(parseShift(spec)).toBeNull();
    expect(shiftInstant(new Date(), spec)).toBeNull();
  });

  it("moves an instant without touching the original", () => {
    const base = new Date("2026-09-16T06:00:00Z");
    expect(shiftInstant(base, "+25h")?.toISOString()).toBe("2026-09-17T07:00:00.000Z");
    expect(base.toISOString()).toBe("2026-09-16T06:00:00.000Z");
  });
});

describe("the clock file", () => {
  it("is written as one line the app reads, and removed again", () => {
    const path = join(dir, ".dev-clock");
    expect(readClockFile(path)).toBeNull();
    const text = writeClockFile(path, new Date("2026-09-16T06:00:00Z"), "Asia/Jerusalem");
    expect(text).toBe("2026-09-16T09:00:00+03:00");
    expect(readFileSync(path, "utf8")).toBe("2026-09-16T09:00:00+03:00\n");
    expect(readClockFile(path)?.toISOString()).toBe("2026-09-16T06:00:00.000Z");
    expect(removeClockFile(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(removeClockFile(path)).toBe(false);
  });

  it("overwrites an earlier instant", () => {
    const path = join(dir, ".dev-clock-2");
    writeClockFile(path, new Date("2026-09-16T06:00:00Z"), "Asia/Jerusalem");
    writeClockFile(path, new Date("2026-09-17T06:00:00Z"), "Asia/Jerusalem");
    expect(readClockFile(path)?.toISOString()).toBe("2026-09-17T06:00:00.000Z");
  });

  it("treats a file the app would ignore as no clock", () => {
    const path = join(dir, ".dev-clock-3");
    for (const bad of ["", "  \n", "2026-09-16", "2026-09-16T09:00:00", "two lines\n2026-09-16T09:00:00+03:00", "2026-02-30T09:00:00+02:00"]) {
      writeFileSync(path, bad);
      expect(readClockFile(path), JSON.stringify(bad)).toBeNull();
    }
    expect(parseClockText(null)).toBeNull();
  });
});
