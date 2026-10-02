import { describe, expect, it } from "vitest";
import { parseOfflinePeriodRows } from "./rows";

const SHABBAT = { type: "SHABBAT", start_at: "2027-01-08T14:10:00+00:00", end_at: "2027-01-09T15:25:00+00:00" };

describe("parseOfflinePeriodRows", () => {
  it("answers an empty list for no rows", () => {
    expect(parseOfflinePeriodRows([])).toEqual([]);
  });

  it("maps a valid row to a period with real instants", () => {
    const [period] = parseOfflinePeriodRows([SHABBAT]);
    expect(period).toEqual({ type: "SHABBAT", start: new Date("2027-01-08T14:10:00Z"), end: new Date("2027-01-09T15:25:00Z") });
    expect(period.start).toBeInstanceOf(Date);
    expect(period.end).toBeInstanceOf(Date);
  });

  it("keeps all four known types, in the order given", () => {
    const rows = ["SHABBAT", "HOLIDAY", "USER_DEFINED", "VACATION"].map((type) => ({ ...SHABBAT, type }));
    expect(parseOfflinePeriodRows(rows).map((p) => p.type)).toEqual(["SHABBAT", "HOLIDAY", "USER_DEFINED", "VACATION"]);
  });

  it.each([
    ["an unknown type", { ...SHABBAT, type: "RAMADAN" }],
    ["an inherited property name as the type", { ...SHABBAT, type: "toString" }],
    ["a null type", { ...SHABBAT, type: null }],
    ["a bad start date", { ...SHABBAT, start_at: "not a date" }],
    ["a null end date", { ...SHABBAT, end_at: null }],
    ["a missing end date", { type: "SHABBAT", start_at: "2027-01-08T14:10:00Z" }],
    ["a numeric date", { ...SHABBAT, start_at: 1_800_000_000_000 }],
    ["null", null],
    ["a string", "SHABBAT"],
    ["a number", 7],
  ])("drops %s instead of guessing", (_name, row) => {
    expect(parseOfflinePeriodRows([row])).toEqual([]);
  });

  it("keeps the good rows around the dropped ones", () => {
    const periods = parseOfflinePeriodRows([{ ...SHABBAT, type: "nope" }, SHABBAT, null]);
    expect(periods).toHaveLength(1);
    expect(periods[0].type).toBe("SHABBAT");
  });
});
