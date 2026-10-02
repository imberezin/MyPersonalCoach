import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET_HOURS, isQuiet, parseQuietHours, type QuietHours } from "./quietHours";

const window = (start: number, end: number): QuietHours => ({ kind: "WINDOW", startMinute: start, endMinute: end });

describe("parseQuietHours", () => {
  it.each<[unknown, unknown, QuietHours | null]>([
    ["00:00:00", "08:00:00", window(0, 480)],
    ["00:00", "08:00", window(0, 480)],
    ["22:00", "07:00", window(1320, 420)],
    ["22:30:15", "07:05:59", window(1350, 425)],
    ["22:00:00.500", "07:00:00", window(1320, 420)],
    [null, null, { kind: "NONE" }],
    ["08:00", "08:00", { kind: "NONE" }],
    ["25:00", "x", null],
    ["25:00", "08:00", null],
    ["08:00", "24:00", null],
    ["08:60", "09:00", null],
    ["08:00", null, null],
    [null, "08:00", null],
    [800, 900, null],
    [undefined, undefined, null],
    ["", "", null],
    ["8:00", "9:00", null],
  ])("(%j, %j) -> %j", (start, end, expected) => {
    expect(parseQuietHours(start, end)).toEqual(expected);
  });

  it("reads the shipped default as 00:00 to 08:00", () => {
    expect(parseQuietHours(`${DEFAULT_QUIET_HOURS.start}:00`, `${DEFAULT_QUIET_HOURS.end}:00`)).toEqual(window(0, 480));
    expect(DEFAULT_QUIET_HOURS).toEqual({ start: "00:00", end: "08:00" });
  });
});

describe("isQuiet", () => {
  const night = window(0, 480);

  it("is quiet from 00:00 and up to 07:59, and not at 08:00 (the end is exclusive)", () => {
    expect(isQuiet(night, 0)).toBe(true);
    expect(isQuiet(night, 479)).toBe(true);
    expect(isQuiet(night, 480)).toBe(false);
    expect(isQuiet(night, 1439)).toBe(false);
  });

  it("wraps midnight when start > end (22:00 to 07:00)", () => {
    const wrapping = window(1320, 420);
    expect(isQuiet(wrapping, 1320)).toBe(true); // 22:00
    expect(isQuiet(wrapping, 1380)).toBe(true); // 23:00
    expect(isQuiet(wrapping, 0)).toBe(true);
    expect(isQuiet(wrapping, 419)).toBe(true); // 06:59
    expect(isQuiet(wrapping, 420)).toBe(false); // 07:00
    expect(isQuiet(wrapping, 1319)).toBe(false); // 21:59
    expect(isQuiet(wrapping, 720)).toBe(false);
  });

  it("is never quiet with no window", () => {
    for (const minute of [0, 300, 720, 1439]) expect(isQuiet({ kind: "NONE" }, minute)).toBe(false);
  });
});
