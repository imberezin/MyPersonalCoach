import { describe, expect, it } from "vitest";
import { buildPortion, formatLocalTime, parseLocalTime, portionsEqual } from "./portion";
import type { Portion } from "./types";

describe("buildPortion", () => {
  it("builds a size", () => {
    expect(buildPortion({ size: "medium", estimated: false })).toEqual({ kind: "size", size: "medium", estimated: false });
    expect(buildPortion({ size: "large", estimated: true })).toEqual({ kind: "size", size: "large", estimated: true });
  });

  it("builds an amount with a unit", () => {
    expect(buildPortion({ amount: 2, unit: "slice", estimated: false })).toEqual({ kind: "amount", amount: 2, unit: "slice", estimated: false });
    expect(buildPortion({ amount: 0.5, unit: "cup", estimated: true })).toEqual({ kind: "amount", amount: 0.5, unit: "cup", estimated: true });
  });

  it("treats null and undefined fields as absent", () => {
    expect(buildPortion({ size: "small", amount: null, unit: null, estimated: false })).toEqual({ kind: "size", size: "small", estimated: false });
    expect(buildPortion({ size: null, amount: 3, unit: "piece", estimated: false })?.kind).toBe("amount");
  });

  it("gives null for a size together with an amount or a unit", () => {
    expect(buildPortion({ size: "small", amount: 2, unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ size: "small", amount: 2, estimated: false })).toBeNull();
    expect(buildPortion({ size: "small", unit: "cup", estimated: false })).toBeNull();
  });

  it("gives null for a unit without an amount and an amount without a unit", () => {
    expect(buildPortion({ unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ amount: 2, estimated: false })).toBeNull();
    expect(buildPortion({ amount: 2, unit: null, estimated: false })).toBeNull();
    expect(buildPortion({ amount: 2, unit: "  ", estimated: false })).toBeNull();
  });

  it("gives null for nothing at all", () => {
    expect(buildPortion({ estimated: false })).toBeNull();
    expect(buildPortion({ size: "", amount: null, unit: null, estimated: true })).toBeNull();
  });

  it("gives null for an unknown size or unit", () => {
    expect(buildPortion({ size: "huge", estimated: false })).toBeNull();
    expect(buildPortion({ amount: 1, unit: "barrel", estimated: false })).toBeNull();
  });

  it("matches sizes and units case-insensitively and ignores padding", () => {
    expect(buildPortion({ size: "MEDIUM", estimated: false })).toEqual({ kind: "size", size: "medium", estimated: false });
    expect(buildPortion({ amount: 1, unit: "CUP", estimated: false })).toEqual({ kind: "amount", amount: 1, unit: "cup", estimated: false });
    expect(buildPortion({ amount: 1, unit: " Ml ", estimated: false })).toEqual({ kind: "amount", amount: 1, unit: "ml", estimated: false });
  });

  it("gives null for zero, a negative amount, and a number that is not finite", () => {
    expect(buildPortion({ amount: 0, unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ amount: -1, unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ amount: Number.NaN, unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ amount: Number.POSITIVE_INFINITY, unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ amount: "2" as unknown as number, unit: "cup", estimated: false })).toBeNull();
  });

  it("accepts exactly the maximum of a unit and rejects one step above it", () => {
    expect(buildPortion({ amount: 20, unit: "cup", estimated: false })?.kind).toBe("amount");
    expect(buildPortion({ amount: 20.01, unit: "cup", estimated: false })).toBeNull();
    expect(buildPortion({ amount: 3000, unit: "gram", estimated: false })?.kind).toBe("amount");
    expect(buildPortion({ amount: 3001, unit: "gram", estimated: false })).toBeNull();
    expect(buildPortion({ amount: 5000, unit: "ml", estimated: false })?.kind).toBe("amount");
    expect(buildPortion({ amount: 50.5, unit: "piece", estimated: false })).toBeNull();
  });

  it("rounds the amount to 2 decimals before checking it", () => {
    expect(buildPortion({ amount: 1.256, unit: "cup", estimated: false })).toEqual({ kind: "amount", amount: 1.26, unit: "cup", estimated: false });
    expect(buildPortion({ amount: 0.004, unit: "cup", estimated: false })).toBeNull(); // rounds to 0
    expect(buildPortion({ amount: 20.004, unit: "cup", estimated: false })?.kind).toBe("amount"); // rounds to 20
  });
});

describe("portionsEqual", () => {
  const size = (s: "small" | "large", estimated = false): Portion => ({ kind: "size", size: s, estimated });
  const amount = (n: number, unit: "cup" | "slice", estimated = false): Portion => ({ kind: "amount", amount: n, unit, estimated });

  it("compares nulls", () => {
    expect(portionsEqual(null, null)).toBe(true);
    expect(portionsEqual(null, size("small"))).toBe(false);
    expect(portionsEqual(amount(1, "cup"), null)).toBe(false);
  });

  it("compares sizes and amounts by value", () => {
    expect(portionsEqual(size("small"), size("small"))).toBe(true);
    expect(portionsEqual(size("small"), size("large"))).toBe(false);
    expect(portionsEqual(amount(2, "slice"), amount(2, "slice"))).toBe(true);
    expect(portionsEqual(amount(2, "slice"), amount(3, "slice"))).toBe(false);
    expect(portionsEqual(amount(2, "slice"), amount(2, "cup"))).toBe(false);
    expect(portionsEqual(size("small"), amount(2, "slice"))).toBe(false);
    expect(portionsEqual(amount(2, "slice"), size("small"))).toBe(false);
  });

  it("ignores the estimated flag: it says how sure the system was, not what the portion is", () => {
    expect(portionsEqual(size("small", true), size("small", false))).toBe(true);
    expect(portionsEqual(amount(1, "cup", true), amount(1, "cup", false))).toBe(true);
  });
});

describe("parseLocalTime", () => {
  it.each([
    ["7:30", 450],
    ["07:30", 450],
    ["0:00", 0],
    ["00:00", 0],
    ["23:59", 1439],
    [" 13:30 ", 810],
  ])("reads %s as %i", (input, minutes) => {
    expect(parseLocalTime(input)).toBe(minutes);
  });

  it.each(["24:00", "7:5", "7:60", "abc", "", "12", "12:30:15", "-1:30", "1:2:3", "７:30"])("rejects %j", (input) => {
    expect(parseLocalTime(input)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(parseLocalTime(null)).toBeNull();
    expect(parseLocalTime(undefined)).toBeNull();
  });
});

describe("formatLocalTime", () => {
  it("pads hours and minutes", () => {
    expect(formatLocalTime(450)).toBe("07:30");
    expect(formatLocalTime(0)).toBe("00:00");
    expect(formatLocalTime(1439)).toBe("23:59");
  });

  it("round-trips with parseLocalTime for the whole day", () => {
    for (let m = 0; m < 1440; m++) expect(parseLocalTime(formatLocalTime(m))).toBe(m);
  });

  it("can never print 24:00", () => {
    expect(formatLocalTime(1440)).toBe("00:00");
    expect(formatLocalTime(-1)).toBe("23:59");
    expect(formatLocalTime(Number.NaN)).toBe("00:00");
  });
});
