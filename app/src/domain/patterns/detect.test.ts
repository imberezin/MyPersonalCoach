import { describe, expect, it } from "vitest";
import { detectLateEvening } from "./detect";
import { LATE_EVENING, type MealStamp } from "./types";

const TZ = "Asia/Jerusalem";
const ASOF = new Date("2029-01-01T00:00:00Z");

const meal = (id: string, iso: string): MealStamp => ({ id, occurredAt: new Date(iso) });
const detect = (meals: readonly MealStamp[], asOf: Date = ASOF, timeZone = TZ) => detectLateEvening({ meals, timeZone, asOf });
const ids = (meals: readonly MealStamp[], asOf?: Date) => detect(meals, asOf).map((o) => o.mealId);

describe("detectLateEvening: the 21:00 boundary on the wall clock (Jerusalem winter, UTC+2)", () => {
  it.each([
    ["20:59:59.999 is not an occurrence", "2027-01-12T18:59:59.999Z", false],
    ["21:00:00.000 is", "2027-01-12T19:00:00.000Z", true],
    ["21:00:00.001 is", "2027-01-12T19:00:00.001Z", true],
    ["23:59:59 is", "2027-01-12T21:59:59Z", true],
    ["23:59:59.999 is", "2027-01-12T21:59:59.999Z", true],
    ["00:00:00 (the next local day) is NOT", "2027-01-12T22:00:00Z", false],
    ["00:30 is not", "2027-01-12T22:30:00Z", false],
    ["04:59 is not", "2027-01-13T02:59:00Z", false],
    ["noon is not", "2027-01-12T10:00:00Z", false],
  ])("%s", (_name, iso, counts) => {
    expect(ids([meal("a", iso)])).toEqual(counts ? ["a"] : []);
  });

  it("uses the shipped constants: 21:00 inclusive to midnight exclusive", () => {
    expect(LATE_EVENING.startMinute).toBe(21 * 60);
    expect(LATE_EVENING.endMinute).toBe(24 * 60);
    expect(LATE_EVENING.kind).toBe("late_evening_meals");
  });
});

describe("detectLateEvening: one occurrence per evening", () => {
  it("collapses two late meals on one evening into the earliest", () => {
    const result = detect([meal("later", "2027-01-12T20:30:00Z"), meal("earlier", "2027-01-12T19:15:00Z")]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ mealId: "earlier", localDay: "2027-01-12" });
    expect(result[0].occurredAt.toISOString()).toBe("2027-01-12T19:15:00.000Z");
  });

  it("breaks an exact tie by id", () => {
    const iso = "2027-01-12T19:15:00Z";
    expect(ids([meal("b", iso), meal("a", iso)])).toEqual(["a"]);
    expect(ids([meal("a", iso), meal("b", iso)])).toEqual(["a"]);
  });

  it("gives one occurrence per different evening, ascending by time", () => {
    const result = detect([
      meal("d3", "2027-01-14T19:30:00Z"),
      meal("d1", "2027-01-12T19:30:00Z"),
      meal("d2", "2027-01-13T20:10:00Z"),
      meal("d2b", "2027-01-13T21:00:00Z"),
    ]);
    expect(result.map((o) => o.mealId)).toEqual(["d1", "d2", "d3"]);
    expect(result.map((o) => o.localDay)).toEqual(["2027-01-12", "2027-01-13", "2027-01-14"]);
  });

  it("does not count a meal after midnight toward the evening before", () => {
    // Evening of the 12th has 22:00; a 00:30 meal on the 13th is nothing, and does not make a second occurrence.
    expect(ids([meal("late", "2027-01-12T20:00:00Z"), meal("after-midnight", "2027-01-12T22:30:00Z")])).toEqual(["late"]);
  });

  it("ignores a daytime meal of an evening that also has a late one", () => {
    expect(ids([meal("lunch", "2027-01-12T10:00:00Z"), meal("late", "2027-01-12T20:00:00Z")])).toEqual(["late"]);
  });
});

describe("detectLateEvening: the zone (wall clock, never UTC hours)", () => {
  it("counts 18:30Z in July (21:30 in Jerusalem) and not 18:30Z in January (20:30)", () => {
    expect(ids([meal("july", "2027-07-12T18:30:00Z")])).toEqual(["july"]);
    expect(ids([meal("jan", "2027-01-12T18:30:00Z")])).toEqual([]);
  });

  it("handles the fall-back night (2026-10-25): both late meals of that evening are one occurrence", () => {
    // 21:30 IST = 19:30Z and 22:15 IST = 20:15Z, after the repeated hour at 01:00 to 02:00.
    const result = detect([meal("a", "2026-10-25T19:30:00Z"), meal("b", "2026-10-25T20:15:00Z")]);
    expect(result.map((o) => o.mealId)).toEqual(["a"]);
    expect(result[0].localDay).toBe("2026-10-25");
  });

  it("sees 21:30 local on both sides of the change as two different evenings with different UTC instants", () => {
    const result = detect([meal("before", "2026-10-24T18:30:00Z"), meal("after", "2026-10-25T19:30:00Z")]); // IDT, then IST
    expect(result.map((o) => o.localDay)).toEqual(["2026-10-24", "2026-10-25"]);
    // The UTC hour of the two differs, the wall clock does not.
    expect(result.map((o) => o.occurredAt.getUTCHours())).toEqual([18, 19]);
  });

  it("does not count the repeated 01:30 of the fall-back night", () => {
    expect(ids([meal("first", "2026-10-24T22:30:00Z"), meal("second", "2026-10-24T23:30:00Z")])).toEqual([]);
  });

  it("handles the spring-forward evening (2027-03-26): 21:30 IDT is 18:30Z", () => {
    expect(ids([meal("a", "2027-03-26T18:30:00Z")])).toEqual(["a"]);
    expect(ids([meal("b", "2027-03-26T17:59:00Z")])).toEqual([]); // 20:59 IDT
    expect(ids([meal("c", "2027-03-26T18:00:00Z")])).toEqual(["c"]); // 21:00 IDT
  });

  it("answers in the profile zone: 19:30Z in January is 14:30 in New York (no), 21:30 in Jerusalem (yes)", () => {
    const meals = [meal("a", "2027-01-12T19:30:00Z")];
    expect(detect(meals, ASOF, TZ)).toHaveLength(1);
    expect(detect(meals, ASOF, "America/New_York")).toHaveLength(0);
  });

  it("treats a garbage zone like Jerusalem", () => {
    const meals = [meal("a", "2027-01-12T19:30:00Z"), meal("b", "2027-01-13T18:30:00Z")];
    expect(detect(meals, ASOF, "Not/AZone")).toEqual(detect(meals, ASOF, TZ));
    expect(ids(meals)).toEqual(["a"]);
  });
});

describe("detectLateEvening: the clock (asOf)", () => {
  const evenings = [
    meal("d1", "2027-01-12T19:30:00Z"),
    meal("d2", "2027-01-13T19:30:00Z"),
    meal("d3", "2027-01-14T19:30:00Z"),
    meal("d4", "2027-01-15T19:30:00Z"),
  ];

  it("ignores a meal after asOf, so 'as of day 3' ignores the meal seeded for day 4", () => {
    expect(ids(evenings, new Date("2027-01-14T21:00:00Z"))).toEqual(["d1", "d2", "d3"]);
    expect(ids(evenings, new Date("2027-01-13T21:00:00Z"))).toEqual(["d1", "d2"]);
  });

  it("counts a meal exactly at asOf, and not one a millisecond later", () => {
    expect(ids(evenings, new Date("2027-01-14T19:30:00.000Z"))).toEqual(["d1", "d2", "d3"]);
    expect(ids(evenings, new Date("2027-01-14T19:29:59.999Z"))).toEqual(["d1", "d2"]);
  });

  it("gives nothing for an invalid asOf", () => {
    expect(detect(evenings, new Date("nope"))).toEqual([]);
  });
});

describe("detectLateEvening: robustness", () => {
  const base = [
    meal("d1", "2027-01-12T19:30:00Z"),
    meal("d2", "2027-01-13T19:30:00Z"),
    meal("d3", "2027-01-14T19:30:00Z"),
  ];

  it("returns [] for no meals", () => {
    expect(detect([])).toEqual([]);
  });

  it("ignores meals with an invalid date", () => {
    expect(ids([meal("bad", "not a date"), ...base])).toEqual(["d1", "d2", "d3"]);
  });

  it("counts a repeated id once, at its earliest time, whatever the order", () => {
    const first = [meal("x", "2027-01-12T19:30:00Z"), meal("x", "2027-01-20T19:30:00Z")];
    expect(detect(first).map((o) => o.localDay)).toEqual(["2027-01-12"]);
    expect(detect([...first].reverse()).map((o) => o.localDay)).toEqual(["2027-01-12"]);
  });

  it("gives the same result for any input order", () => {
    const expected = detect(base);
    expect(detect([...base].reverse())).toEqual(expected);
    expect(detect([base[1], base[2], base[0]])).toEqual(expected);
  });

  it("does not mutate its input", () => {
    const input = [base[2], base[0], base[1]];
    const snapshot = input.map((m) => ({ id: m.id, at: m.occurredAt.getTime() }));
    detect(input);
    expect(input.map((m) => ({ id: m.id, at: m.occurredAt.getTime() }))).toEqual(snapshot);
  });

  it("returns ascending by time", () => {
    const result = detect([base[2], base[0], base[1]]);
    const times = result.map((o) => o.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
