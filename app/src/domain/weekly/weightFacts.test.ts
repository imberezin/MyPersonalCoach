import { describe, expect, it } from "vitest";
import { zonedInstantUtc } from "../time";
import { WEIGHT_TREND, type WeightEntry } from "../weight/types";
import { weeklyWeightFacts, type WeeklyWeightFacts } from "./weightFacts";
import { weekWindowOf } from "./week";

// These rows go through the Weight item's REAL weeklyPoints, buildWeightTrend and milestoneProgress (nothing is mocked), so
// they also pin the seam between the two items.

const TZ = "Asia/Jerusalem";

function local(day: string, time = "08:00"): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedInstantUtc(y, m, d, hh, mm, TZ);
}

const entry = (day: string, kg: number, time = "08:00"): WeightEntry => ({ id: `e-${day}-${time}`, weightKg: kg, measuredAt: local(day, time) });
/** One entry per week, each on the Sunday morning, from the given first Sunday. */
const weekly = (firstSunday: string, kgs: number[]): WeightEntry[] =>
  kgs.map((kg, i) => {
    const d = new Date(Date.UTC(2000, 0, 1));
    const [y, m, day] = firstSunday.split("-").map(Number);
    d.setUTCFullYear(y, m - 1, day + 7 * i);
    return entry(d.toISOString().slice(0, 10), kg);
  });

// The summarised week is 2027-01-03 .. 2027-01-09; it is read on Sunday 2027-01-10 05:00.
const SUMMARISED = weekWindowOf(local("2027-01-05", "12:00"), TZ);
const NOW = local("2027-01-10", "05:00");
const FOUR_WEEKS_FROM = "2026-12-13"; // 12-13, 12-20, 12-27, 01-03

type Input = Parameters<typeof weeklyWeightFacts>[0];
function facts(entries: WeightEntry[] | null, over: Partial<Input> = {}): WeeklyWeightFacts {
  return weeklyWeightFacts({
    entries,
    truncated: false,
    week: SUMMARISED,
    windowStart: SUMMARISED.start,
    timeZone: TZ,
    now: NOW,
    profile: { startWeightKg: 80, goalWeightKg: 72, goalType: "numeric" },
    ...over,
  });
}

describe("weeklyWeightFacts: the line", () => {
  it("one weekly point is FIRST", () => {
    expect(facts([entry("2027-01-04", 78)]).line).toEqual({ kind: "FIRST" });
  });

  it("two points and three points are BUILDING (a direction needs four complete weeks)", () => {
    expect(facts(weekly("2026-12-27", [78.2, 78.0])).line).toEqual({ kind: "BUILDING" });
    expect(facts(weekly("2026-12-20", [78.4, 78.2, 78.0])).line).toEqual({ kind: "BUILDING" });
  });

  it.each([
    ["DOWN", [78.1, 77.4, 76.9, 76.2]],
    ["STEADY", [78.1, 78.3, 78.2, 78.1]],
    ["UP", [77.0, 77.4, 77.9, 78.5]],
  ] as const)("four complete weeks that go %s say %s, with the Weight item's own worked values", (kind, kgs) => {
    expect(facts(weekly(FOUR_WEEKS_FROM, [...kgs])).line).toEqual({ kind });
  });

  it("is BUILDING when the series is stale (read many weeks later)", () => {
    const later = local("2027-03-14", "05:00");
    expect(facts(weekly(FOUR_WEEKS_FROM, [78.1, 77.4, 76.9, 76.2]), { now: later }).line).toEqual({ kind: "BUILDING" });
  });

  it("is NONE without a counted weigh-in in the summarised week, even when older points exist", () => {
    const older = weekly(FOUR_WEEKS_FROM, [78.1, 77.4, 76.9]); // the last Sunday is 12-27: nothing in 01-03
    const result = facts(older);
    expect(result.line).toEqual({ kind: "NONE" });
    expect(result.weighedThisWeek).toBe(false);
    expect(result.known).toBe(true);
  });

  it("a weigh-in made in the NEW week never changes the summarised week's line", () => {
    const four = weekly(FOUR_WEEKS_FROM, [78.1, 77.4, 76.9, 76.2]);
    const withNewWeek = [...four, entry("2027-01-10", 90, "03:00")];
    expect(facts(withNewWeek).line).toEqual({ kind: "DOWN" });
    // Everything about the summarised week is the same; only "when did you last weigh in" moves, as it should.
    expect({ ...facts(withNewWeek), lastEntryAt: null }).toEqual({ ...facts(four), lastEntryAt: null });
    // And a high single day never produces an UP line.
    expect(facts([...four, entry("2027-01-10", 120, "04:00")]).line).toEqual({ kind: "DOWN" });
  });

  it("a weigh-in in the new week does not turn a first weigh-in into 'building' either (the slice is at the summarised week)", () => {
    const first = entry("2027-01-04", 78);
    expect(facts([first]).line).toEqual({ kind: "FIRST" });
    expect(facts([first, entry("2027-01-10", 77.5, "03:00")]).line).toEqual({ kind: "FIRST" });
  });

  it("entries after `now` are ignored", () => {
    const four = weekly(FOUR_WEEKS_FROM, [78.1, 77.4, 76.9, 76.2]);
    expect(facts([...four, entry("2027-01-12", 120)]).line).toEqual({ kind: "DOWN" });
  });

  it("carries no number at all", () => {
    const result = facts(weekly(FOUR_WEEKS_FROM, [78.1, 77.4, 76.9, 76.2]));
    expect(JSON.stringify(result.line)).toBe('{"kind":"DOWN"}');
  });
});

describe("weeklyWeightFacts: the window start", () => {
  const monday = local("2027-01-04", "00:00");
  const sunday = entry("2027-01-03", 80, "08:00");
  const wednesday = entry("2027-01-06", 72, "08:00");

  it("an entry before the window start (made before 'Let's continue') is not 'weighed this week' and gives no line", () => {
    const result = facts([sunday], { windowStart: monday });
    expect(result.weighedThisWeek).toBe(false);
    expect(result.line).toEqual({ kind: "NONE" });
    expect(result.milestone).toBeNull();
    expect(result.lastEntryAt?.toISOString()).toBe(sunday.measuredAt.toISOString());
  });

  it("an entry on or after the window start counts", () => {
    expect(facts([wednesday], { windowStart: monday }).weighedThisWeek).toBe(true);
    expect(facts([{ ...wednesday, measuredAt: monday }], { windowStart: monday }).weighedThisWeek).toBe(true);
    expect(facts([{ ...wednesday, measuredAt: new Date(monday.getTime() - 1) }], { windowStart: monday }).weighedThisWeek).toBe(false);
  });

  it("the weekly AVERAGE still includes the entry made before the window start", () => {
    // Sunday 80 and Wednesday 72 average 76 (above the 75 landmark); the Wednesday alone would be 72 (below it).
    const lowBefore = weekly("2026-12-27", [74.6]); // the previous week is already at or below 75
    const result = facts([...lowBefore, sunday, wednesday], { windowStart: monday });
    expect(result.weighedThisWeek).toBe(true);
    expect(result.milestone).toBeNull();
    // Without the Sunday entry the average is 72 and the landmark is confirmed this week.
    expect(facts([...lowBefore, wednesday], { windowStart: monday }).milestone).toEqual({ index: 1, isGoal: false });
  });

  it("an entry at the week's end exactly is not in the week", () => {
    expect(facts([{ ...wednesday, measuredAt: SUMMARISED.end }], { now: local("2027-01-11", "05:00") }).weighedThisWeek).toBe(false);
  });
});

describe("weeklyWeightFacts: the milestone is celebrated in the week that CONFIRMED it", () => {
  // Landmarks of 80 -> 72: [80, 75, 72]. Weekly averages are one entry on each Sunday.
  const run = (kgs: number[], firstSunday: string, week = SUMMARISED, now = NOW) =>
    facts(weekly(firstSunday, kgs), { week, windowStart: week.start, now });

  it("the SECOND of two consecutive complete averages at or below a step gives { index, isGoal }", () => {
    expect(run([74.8, 74.6], "2026-12-27").milestone).toEqual({ index: 1, isGoal: false });
  });

  it("the FIRST week of the pair does not celebrate yet", () => {
    const firstOfPair = weekWindowOf(local("2026-12-30", "12:00"), TZ); // the week of 2026-12-27
    expect(run([74.8, 74.6], "2026-12-27", firstOfPair, local("2027-01-03", "05:00")).milestone).toBeNull();
  });

  it("the week after the confirming week does not celebrate again", () => {
    const after = weekWindowOf(local("2027-01-12", "12:00"), TZ); // the week of 2027-01-10
    expect(run([74.8, 74.6, 74.5], "2026-12-27", after, local("2027-01-17", "05:00")).milestone).toBeNull();
  });

  it("a single low week never confirms", () => {
    expect(run([74.6], "2027-01-03").milestone).toBeNull();
    expect(run([79.0, 74.6], "2026-12-27").milestone).toBeNull();
  });

  it("two low weeks with a week of no weigh-in between them are still consecutive weigh-in weeks", () => {
    expect(facts([entry("2026-12-20", 74.8), entry("2027-01-04", 74.6)]).milestone).toEqual({ index: 1, isGoal: false });
  });

  it("the goal step gives isGoal true", () => {
    expect(run([71.9, 71.8], "2026-12-27").milestone).toEqual({ index: 2, isGoal: true });
  });

  it("returns the HIGHEST index when two landmarks are confirmed in the same week", () => {
    expect(run([71.5, 71.4], "2026-12-27").milestone).toEqual({ index: 2, isGoal: true });
    // 90 -> 70: [90, 85, 80, 75, 70]. 79.5 is at or below 85 and 80, so both are confirmed this week.
    const result = facts(weekly("2026-12-27", [79.5, 79.4]), { profile: { startWeightKg: 90, goalWeightKg: 70, goalType: "numeric" } });
    expect(result.milestone).toEqual({ index: 2, isGoal: false });
  });

  it("is null for a non-numeric goal, no goal weight and no start weight", () => {
    const entries = weekly("2026-12-27", [74.8, 74.6]);
    expect(facts(entries, { profile: { startWeightKg: 80, goalWeightKg: 72, goalType: "behavioral" } }).milestone).toBeNull();
    expect(facts(entries, { profile: { startWeightKg: 80, goalWeightKg: 72, goalType: "none" } }).milestone).toBeNull();
    expect(facts(entries, { profile: { startWeightKg: 80, goalWeightKg: null, goalType: "numeric" } }).milestone).toBeNull();
    expect(facts(entries, { profile: { startWeightKg: null, goalWeightKg: 72, goalType: "numeric" } }).milestone).toBeNull();
  });

  it("a weight line can still be BUILDING or FIRST without a baseline", () => {
    expect(facts([entry("2027-01-04", 78)], { profile: { startWeightKg: null, goalWeightKg: null, goalType: "none" } }).line).toEqual({ kind: "FIRST" });
  });
});

describe("weeklyWeightFacts: unknown series and the rest", () => {
  const four = weekly(FOUR_WEEKS_FROM, [78.1, 77.4, 76.9, 76.2]);

  it("truncated entries are unknown: no line, no milestone, nothing", () => {
    expect(facts(four, { truncated: true })).toEqual({
      known: false,
      line: { kind: "NONE" },
      milestone: null,
      weighedThisWeek: false,
      lastEntryAt: null,
      hasBaselineOrEntry: false,
    });
  });

  it("null entries (a failed read) are unknown", () => {
    expect(facts(null).known).toBe(false);
    expect(facts(null).line).toEqual({ kind: "NONE" });
  });

  it("an invalid `now` is unknown", () => {
    expect(facts(four, { now: new Date(Number.NaN) }).known).toBe(false);
  });

  it("lastEntryAt is the newest entry at or before `now`", () => {
    const result = facts([entry("2027-01-04", 78), entry("2027-01-08", 77.5), entry("2027-01-12", 70)]);
    expect(result.lastEntryAt?.toISOString()).toBe(local("2027-01-08").toISOString());
  });

  it("lastEntryAt is null without entries", () => {
    expect(facts([]).lastEntryAt).toBeNull();
  });

  it("hasBaselineOrEntry is true with a start weight or any entry, false with neither", () => {
    expect(facts([]).hasBaselineOrEntry).toBe(true);
    expect(facts([], { profile: { startWeightKg: null, goalWeightKg: null, goalType: "none" } }).hasBaselineOrEntry).toBe(false);
    expect(facts([entry("2027-01-04", 78)], { profile: { startWeightKg: null, goalWeightKg: null, goalType: "none" } }).hasBaselineOrEntry).toBe(true);
  });

  it("does not mutate its input", () => {
    const copy = JSON.stringify(four);
    facts(four);
    expect(JSON.stringify(four)).toBe(copy);
  });
});

describe("the Weight item's week is this item's week", () => {
  it("both start on Sunday (a change there must fail here, not shift a weigh-in into the wrong week)", () => {
    expect(WEIGHT_TREND.weekStartsOn).toBe(0);
    expect(SUMMARISED.weekStart).toBe("2027-01-03");
    expect(new Date(Date.UTC(2027, 0, 3)).getUTCDay()).toBe(WEIGHT_TREND.weekStartsOn);
  });
});
