import { describe, expect, it } from "vitest";
import { MILESTONE_MOMENT, WEIGHT_ENTRY, WEIGHT_FLOW, WEIGHT_LIST, WEIGHT_TREND, parseWeightRow } from "./types";

const ID = "3f2b8c1e-5a47-4d09-9c1b-2e7a6d4f8b10";

describe("the weight constants", () => {
  it("keeps the documented defaults (every number is a one-line product decision)", () => {
    expect(WEIGHT_FLOW).toEqual({ reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true });
    expect(WEIGHT_ENTRY).toEqual({ minKg: 30, maxKg: 350, noteMaxCodePoints: 200, earlierDays: 14, jumpCheckKg: 15 });
    expect(WEIGHT_TREND).toEqual({
      weekStartsOn: 0,
      minPointsForLine: 2,
      directionWeeks: 4,
      directionSpanWeeks: 8,
      directionBandKg: 0.5,
      sameBandKg: 0.5,
      staleAfterWeeks: 3,
      maxChartWeeks: 52,
      maxEntriesRead: 1500,
    });
    expect(WEIGHT_LIST).toEqual({ pageSize: 30 });
    expect(MILESTONE_MOMENT).toEqual({ weeksInARow: 2, windowDays: 14, ackEvent: "milestone_acknowledged" });
  });

  it("accepts a narrower range than the table CHECK (> 20 and < 500), so nothing accepted can violate it", () => {
    expect(WEIGHT_ENTRY.minKg).toBeGreaterThan(20);
    expect(WEIGHT_ENTRY.maxKg).toBeLessThan(500);
  });
});

describe("parseWeightRow", () => {
  const valid = { id: ID, weight_kg: 118.7, measured_at: "2026-10-02T06:00:00.000Z", note: "after a trip" };

  it("parses a row", () => {
    expect(parseWeightRow(valid)).toEqual({ id: ID, weightKg: 118.7, measuredAt: new Date("2026-10-02T06:00:00.000Z"), note: "after a trip" });
  });

  it("coerces a numeric string (PostgREST can return numeric as a string)", () => {
    expect(parseWeightRow({ ...valid, weight_kg: "118.70" })?.weightKg).toBe(118.7);
  });

  it("treats a missing or null note as null (the series query does not select it)", () => {
    const withoutNote: Partial<typeof valid> = { ...valid };
    delete withoutNote.note;
    expect(parseWeightRow(withoutNote)?.note).toBeNull();
    expect(parseWeightRow({ ...valid, note: null })?.note).toBeNull();
  });

  it("accepts a Date for measured_at", () => {
    const at = new Date("2026-10-02T06:00:00.000Z");
    expect(parseWeightRow({ ...valid, measured_at: at })?.measuredAt).toEqual(at);
  });

  it.each([
    ["not an object", "x"],
    ["null", null],
    ["an array", []],
    ["a missing id", { ...valid, id: undefined }],
    ["an id that is not a uuid", { ...valid, id: "123" }],
    ["a non-finite weight", { ...valid, weight_kg: Number.NaN }],
    ["an unparsable weight string", { ...valid, weight_kg: "heavy" }],
    ["an empty weight string", { ...valid, weight_kg: "" }],
    ["a negative weight", { ...valid, weight_kg: -1 }],
    ["a weight over 1000", { ...valid, weight_kg: 1000.5 }],
    ["a missing weight", { ...valid, weight_kg: null }],
    ["an invalid date", { ...valid, measured_at: "yesterday" }],
    ["a date that is a number", { ...valid, measured_at: 1_700_000_000_000 }],
    ["a note that is not text", { ...valid, note: 5 }],
  ])("drops %s", (_name, row) => {
    expect(parseWeightRow(row)).toBeNull();
  });

  it("keeps the bounds of 0..1000 inclusive", () => {
    expect(parseWeightRow({ ...valid, weight_kg: 1000 })?.weightKg).toBe(1000);
    expect(parseWeightRow({ ...valid, weight_kg: 0 })?.weightKg).toBe(0);
  });
});
