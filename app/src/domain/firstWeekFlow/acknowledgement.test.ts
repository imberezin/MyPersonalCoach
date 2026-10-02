import { describe, expect, it } from "vitest";
import { eveningOfDay } from "../asOf";
import type { LifecycleState } from "../firstWeek";
import { acknowledgementFor } from "./acknowledgement";
import { FIRST_WEEK_LIMITS, type Acknowledgement } from "./types";

const TZ = "Asia/Jerusalem";
// Thursday 2026-10-01 (local); day N below is the N-th local day from it.
const STARTED = new Date("2026-10-01T07:00:00Z");
const at = (day: number, time: string) => eveningOfDay({ startedAt: STARTED, day, time, timeZone: TZ });

function ack(thisMealAt: Date, mealTimes: readonly Date[], lifecycle: LifecycleState = "FIRST_WEEK"): Acknowledgement {
  return acknowledgementFor({ lifecycle, thisMealAt, mealTimes, timeZone: TZ });
}

describe("acknowledgementFor: the B2 line and the rotation", () => {
  it("gives the B2 line to the first meal ever", () => {
    expect(ack(at(1, "12:30"), [at(1, "12:30")])).toEqual({ kind: "first" });
    expect(ack(at(1, "12:30"), [])).toEqual({ kind: "first" });
  });

  it("says nothing for a second meal on the same day", () => {
    expect(ack(at(1, "19:00"), [at(1, "12:30"), at(1, "19:00")])).toEqual({ kind: "none" });
  });

  it.each([
    [2, 0],
    [3, 1],
    [4, 2],
    [5, 0],
    [6, 1],
  ] as const)("gives the first meal of day %i rotating line %i when every earlier day had a meal", (day, index) => {
    const earlier = Array.from({ length: day - 1 }, (_, i) => at(i + 1, "12:30"));
    const thisMeal = at(day, "08:15");
    expect(ack(thisMeal, [...earlier, thisMeal])).toEqual({ kind: "rotating", index });
  });

  it("does not advance the rotation on days without a report", () => {
    // Meals on days 1 and 4, then day 6: two earlier days with meals, so the same line as day 3 after two days.
    const sparse = [at(1, "12:00"), at(4, "12:00")];
    const consecutive = [at(1, "12:00"), at(2, "12:00")];
    const sparseResult = ack(at(6, "09:00"), sparse);
    expect(sparseResult).toEqual({ kind: "rotating", index: 1 });
    expect(sparseResult).toEqual(ack(at(3, "09:00"), consecutive));
  });

  it("counts several meals of one earlier day once", () => {
    const earlier = [at(1, "08:00"), at(1, "13:00"), at(1, "20:00")];
    expect(ack(at(2, "09:00"), earlier)).toEqual({ kind: "rotating", index: 0 });
  });

  it("is the same whatever the order of the meal times", () => {
    const meals = [at(1, "12:00"), at(2, "12:00"), at(3, "12:00")];
    const expected = ack(at(4, "09:00"), meals);
    expect(expected).toEqual({ kind: "rotating", index: 2 });
    expect(ack(at(4, "09:00"), [...meals].reverse())).toEqual(expected);
    expect(ack(at(4, "09:00"), [meals[1], meals[2], meals[0]])).toEqual(expected);
  });

  it("is not changed by the meal itself being in the list", () => {
    const earlier = [at(1, "12:00"), at(2, "12:00")];
    const thisMeal = at(3, "09:00");
    expect(ack(thisMeal, earlier)).toEqual(ack(thisMeal, [...earlier, thisMeal]));
  });

  it("treats a meal confirmed later than this one as not earlier (a revisit of an old Saved URL stays stable)", () => {
    const first = at(1, "12:00");
    expect(ack(first, [first, at(2, "12:00"), at(3, "12:00")])).toEqual({ kind: "first" });
  });

  it("gives two meals with the very same stamp both the first-meal line (a strict comparison)", () => {
    const stamp = at(1, "12:00");
    expect(ack(stamp, [stamp, new Date(stamp.getTime())])).toEqual({ kind: "first" });
  });
});

describe("acknowledgementFor: when there is no line", () => {
  it.each<LifecycleState>(["WEEKLY_CYCLE", "ONBOARDING", "NEW"])("is none in the lifecycle state %s", (lifecycle) => {
    expect(ack(at(1, "12:00"), [at(1, "12:00")], lifecycle)).toEqual({ kind: "none" });
    expect(ack(at(2, "09:00"), [at(1, "12:00")], lifecycle)).toEqual({ kind: "none" });
  });

  it("is none when the history is full (it may be incomplete), and works one meal below that", () => {
    const limit = FIRST_WEEK_LIMITS.acknowledgementHistory;
    const day = (i: number) => new Date(at(1, "00:30").getTime() + i * 60_000);
    const full = Array.from({ length: limit }, (_, i) => day(i));
    const almostFull = Array.from({ length: limit - 1 }, (_, i) => day(i));
    expect(ack(at(2, "09:00"), full)).toEqual({ kind: "none" });
    expect(ack(at(2, "09:00"), almostFull)).toEqual({ kind: "rotating", index: 0 });
  });

  it("is none for an invalid meal time, and ignores invalid times in the list", () => {
    expect(ack(new Date("nope"), [at(1, "12:00")])).toEqual({ kind: "none" });
    expect(ack(at(2, "09:00"), [new Date("nope"), at(1, "12:00")])).toEqual({ kind: "rotating", index: 0 });
  });
});

describe("acknowledgementFor: the local day, not the UTC day", () => {
  it("treats 23:59 and 00:01 in Jerusalem as different days, though both are the same UTC day", () => {
    const before = new Date("2026-10-01T20:59:00Z"); // 23:59 Thursday local
    const after = new Date("2026-10-01T21:01:00Z"); // 00:01 Friday local
    expect(ack(after, [before, after])).toEqual({ kind: "rotating", index: 0 });
  });

  it("treats two instants on different UTC days as one Jerusalem day", () => {
    const early = new Date("2026-10-01T21:30:00Z"); // 00:30 Friday local, still Thursday in UTC
    const later = new Date("2026-10-02T08:00:00Z"); // 11:00 Friday local
    expect(ack(later, [early, later])).toEqual({ kind: "none" });
  });

  it("treats the repeated hour of the fall-back night (01:30 IDT and 01:30 IST) as one day", () => {
    const first = new Date("2026-10-24T22:30:00Z"); // 01:30 IDT, 2026-10-25
    const second = new Date("2026-10-24T23:30:00Z"); // 01:30 IST, the same local day
    expect(ack(second, [first, second])).toEqual({ kind: "none" });
  });

  it("uses the profile zone, and Jerusalem for a garbage zone", () => {
    const a = new Date("2026-10-01T21:30:00Z");
    const b = new Date("2026-10-02T08:00:00Z");
    expect(acknowledgementFor({ lifecycle: "FIRST_WEEK", thisMealAt: b, mealTimes: [a, b], timeZone: "UTC" })).toEqual({
      kind: "rotating",
      index: 0,
    });
    expect(acknowledgementFor({ lifecycle: "FIRST_WEEK", thisMealAt: b, mealTimes: [a, b], timeZone: "Not/AZone" })).toEqual({
      kind: "none",
    });
  });

  it("does not mutate the list", () => {
    const meals = [at(2, "12:00"), at(1, "12:00")];
    const snapshot = meals.map((d) => d.getTime());
    ack(at(3, "09:00"), meals);
    expect(meals.map((d) => d.getTime())).toEqual(snapshot);
  });
});
