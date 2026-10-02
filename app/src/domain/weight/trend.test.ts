import { describe, expect, it } from "vitest";
import {
  addDaysToDayKey,
  buildWeightTrend,
  parseDayKey,
  weekStartOfDayKey,
  weeklyDirection,
  weeklyPoints,
  weeksBetween,
  type TrendPoint,
} from "./trend";
import type { WeightEntry } from "./types";

const TZ = "Asia/Jerusalem";
// Sundays: 09-13, 09-20, 09-27, 10-04, 10-11, 10-18, 10-25, 11-01.
const FIRST_SUNDAY = "2026-09-13";

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const entry = (iso: string, weightKg: number, entryId = id()): WeightEntry => ({ id: entryId, weightKg, measuredAt: new Date(iso) });

const point = (weekStart: string, averageKg: number, complete = true, entries = 1): TrendPoint => ({ weekStart, averageKg, entries, complete });
const weekKey = (i: number) => addDaysToDayKey(FIRST_SUNDAY, 7 * i);
/** Consecutive complete weeks starting on 2026-09-13. */
const weeks = (averages: number[], from = 0): TrendPoint[] => averages.map((kg, i) => point(weekKey(from + i), kg));

describe("date key helpers", () => {
  it("parse real calendar days only", () => {
    expect(parseDayKey("2026-10-02")).toEqual({ year: 2026, month: 10, day: 2 });
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("2026-2-3")).toBeNull();
    expect(parseDayKey("")).toBeNull();
  });

  it("add days across months, years and leap days", () => {
    expect(addDaysToDayKey("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDaysToDayKey("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysToDayKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDayKey("2026-10-18", -7)).toBe("2026-10-11");
    expect(addDaysToDayKey("garbage", 3)).toBe("garbage");
  });

  it("find the Sunday that starts the week", () => {
    expect(weekStartOfDayKey("2026-10-10")).toBe("2026-10-04"); // Saturday
    expect(weekStartOfDayKey("2026-10-11")).toBe("2026-10-11"); // Sunday
    expect(weekStartOfDayKey("2026-10-14")).toBe("2026-10-11"); // Wednesday
    expect(weekStartOfDayKey("2027-01-01")).toBe("2026-12-27"); // across a year
  });

  it("count whole weeks between week starts", () => {
    expect(weeksBetween("2026-09-13", "2026-10-04")).toBe(3);
    expect(weeksBetween("2026-10-04", "2026-09-13")).toBe(-3);
    expect(weeksBetween("2026-10-25", "2026-10-25")).toBe(0);
  });
});

describe("weeklyPoints: the weeks", () => {
  const NOW = new Date("2026-11-04T09:00:00Z");

  it("puts Saturday 23:59 and Sunday 00:00 (local) in different weeks", () => {
    const points = weeklyPoints(
      [entry("2026-10-10T20:59:00Z", 80), entry("2026-10-10T21:00:00Z", 79)], // Sat 23:59 and Sun 00:00 local (UTC+3)
      TZ,
      NOW,
    );
    expect(points.map((p) => [p.weekStart, p.averageKg])).toEqual([
      ["2026-10-04", 80],
      ["2026-10-11", 79],
    ]);
  });

  it("is ascending whatever the input order", () => {
    const points = weeklyPoints([entry("2026-10-20T08:00:00Z", 78), entry("2026-09-15T08:00:00Z", 80), entry("2026-10-01T08:00:00Z", 79)], TZ, NOW);
    expect(points.map((p) => p.weekStart)).toEqual(["2026-09-13", "2026-09-27", "2026-10-18"]);
  });

  it("keeps the 25-hour week (DST ends 2026-10-25 02:00) in one piece", () => {
    const points = weeklyPoints(
      [
        entry("2026-10-24T21:30:00Z", 80), // Sunday 2026-10-25 00:30 local (UTC+3)
        entry("2026-10-31T21:30:00Z", 79), // Saturday 2026-10-31 23:30 local (UTC+2)
        entry("2026-10-31T22:00:00Z", 70), // Sunday 2026-11-01 00:00 local
      ],
      TZ,
      NOW,
    );
    expect(points.map((p) => [p.weekStart, p.entries, p.averageKg])).toEqual([
      ["2026-10-25", 2, 79.5],
      ["2026-11-01", 1, 70],
    ]);
  });

  it("keeps the 23-hour week (DST starts 2026-03-27 02:00) in one piece", () => {
    const points = weeklyPoints(
      [
        entry("2026-03-21T22:00:00Z", 80), // Sunday 2026-03-22 00:00 local (UTC+2)
        entry("2026-03-28T20:59:00Z", 79), // Saturday 2026-03-28 23:59 local (UTC+3)
      ],
      TZ,
      new Date("2026-04-10T09:00:00Z"),
    );
    expect(points.map((p) => [p.weekStart, p.entries])).toEqual([["2026-03-22", 2]]);
  });

  it("uses the profile's zone, and Jerusalem for a garbage zone", () => {
    const e = [entry("2026-10-10T22:00:00Z", 80)]; // Sunday 2026-10-11 01:00 in Jerusalem, Saturday 22:00 in UTC
    expect(weeklyPoints(e, TZ, NOW)[0].weekStart).toBe("2026-10-11");
    expect(weeklyPoints(e, "UTC", NOW)[0].weekStart).toBe("2026-10-04");
    expect(weeklyPoints(e, "Not/AZone", NOW)[0].weekStart).toBe("2026-10-11");
  });
});

describe("weeklyPoints: complete", () => {
  const e = [entry("2026-10-07T08:00:00Z", 80), entry("2026-10-14T08:00:00Z", 79)]; // weeks 10-04 and 10-11

  it("marks the week that contains `now` as unfinished and every earlier week as complete", () => {
    const points = weeklyPoints(e, TZ, new Date("2026-10-15T09:00:00Z")); // Thursday of the week 10-11
    expect(points.map((p) => [p.weekStart, p.complete])).toEqual([
      ["2026-10-04", true],
      ["2026-10-11", false],
    ]);
  });

  it("flips exactly at Sunday 00:00 local", () => {
    const before = weeklyPoints(e, TZ, new Date("2026-10-17T20:59:59Z")); // Saturday 23:59:59 local
    const after = weeklyPoints(e, TZ, new Date("2026-10-17T21:00:00Z")); // Sunday 2026-10-18 00:00 local
    expect(before.map((p) => p.complete)).toEqual([true, false]);
    expect(after.map((p) => p.complete)).toEqual([true, true]);
  });

  it("is right across the 25-hour Sunday (DST ends 2026-10-25 02:00)", () => {
    const dst = [entry("2026-10-21T08:00:00Z", 80), entry("2026-10-28T08:00:00Z", 79)]; // weeks 10-18 and 10-25
    // Saturday 2026-10-24 23:59:59 local: still the week of 10-18.
    expect(weeklyPoints(dst, TZ, new Date("2026-10-24T20:59:59Z")).map((p) => p.complete)).toEqual([false]);
    // Sunday 2026-10-25 00:00 local (UTC+3, the clock has not fallen back yet): the week of 10-18 has ended.
    expect(weeklyPoints(dst, TZ, new Date("2026-10-24T21:00:00Z")).map((p) => p.complete)).toEqual([true]);
    // Inside the long week and after it.
    expect(weeklyPoints(dst, TZ, new Date("2026-10-28T09:00:00Z")).map((p) => p.complete)).toEqual([true, false]);
    expect(weeklyPoints(dst, TZ, new Date("2026-10-31T21:59:59Z")).map((p) => p.complete)).toEqual([true, false]); // Saturday 23:59:59 (UTC+2)
    expect(weeklyPoints(dst, TZ, new Date("2026-10-31T22:00:00Z")).map((p) => p.complete)).toEqual([true, true]); // Sunday 2026-11-01 00:00
  });

  it("treats the week of `now` as unfinished even when `now` is its first second", () => {
    const sunday = [entry("2026-10-18T05:00:00Z", 80)]; // Sunday 08:00 local, week 10-18
    expect(weeklyPoints(sunday, TZ, new Date("2026-10-18T05:00:00Z"))[0].complete).toBe(false);
  });
});

describe("weeklyPoints: the mean", () => {
  const NOW = new Date("2026-11-04T09:00:00Z");
  const avg = (kgs: number[]) => weeklyPoints(kgs.map((kg, i) => entry(`2026-10-0${i + 1}T08:00:00Z`, kg)), TZ, NOW)[0].averageKg;

  it("rounds half up in hundredths: 80.0 and 80.1 give 80.1", () => {
    expect(avg([80.0, 80.1])).toBe(80.1);
  });

  it("rounds down below the half: 79.9, 80.0, 80.1 give 80.0", () => {
    expect(avg([79.9, 80.0, 80.1])).toBe(80.0);
  });

  it("is not thrown by float noise (0.1 + 0.2 style sums)", () => {
    expect(avg([80.1, 80.2])).toBe(80.2);
    expect(avg([0.1 + 0.2 + 80, 80.3])).toBe(80.3);
    expect(avg([118.7, 118.7, 118.7])).toBe(118.7);
    // Exact means of 79.35 and 79.55 and 79.85 sit on the rounding line: float sums fall just below it.
    expect(avg([79.1, 79.6])).toBe(79.4);
    expect(avg([79.35, 79.35])).toBe(79.4);
    expect(avg([79.1, 80.6])).toBe(79.9);
  });

  it("handles two-decimal values that came from numeric(5,2)", () => {
    expect(avg([80.04, 80.05])).toBe(80.0); // 80.045 -> 80.0 (hundredths 8004 + 8005 = 16009 -> 80.045)
    expect(avg([80.05, 80.05])).toBe(80.1); // exactly 80.05 rounds up
  });

  it("counts the entries", () => {
    expect(weeklyPoints([entry("2026-10-01T08:00:00Z", 80), entry("2026-10-02T08:00:00Z", 81)], TZ, NOW)[0].entries).toBe(2);
  });
});

describe("weeklyPoints: what is ignored", () => {
  const NOW = new Date("2026-10-15T09:00:00Z");

  it("drops entries after `now`, but keeps one at exactly `now`", () => {
    const points = weeklyPoints([entry("2026-10-15T09:00:00Z", 80), entry("2026-10-15T09:00:01Z", 50), entry("2026-11-20T09:00:00Z", 40)], TZ, NOW);
    expect(points).toHaveLength(1);
    expect(points[0].averageKg).toBe(80);
  });

  it("drops an invalid date and a non-finite weight", () => {
    const points = weeklyPoints(
      [
        { id: id(), weightKg: 80, measuredAt: new Date("nope") },
        { id: id(), weightKg: Number.NaN, measuredAt: new Date("2026-10-01T08:00:00Z") },
        { id: id(), weightKg: Number.POSITIVE_INFINITY, measuredAt: new Date("2026-10-01T08:00:00Z") },
        entry("2026-10-01T08:00:00Z", 79),
      ],
      TZ,
      NOW,
    );
    expect(points).toHaveLength(1);
    expect(points[0].averageKg).toBe(79);
  });

  it("counts a repeated id once", () => {
    const same = "11111111-1111-4111-8111-111111111111";
    const points = weeklyPoints([entry("2026-10-01T08:00:00Z", 80, same), entry("2026-10-01T08:00:00Z", 80, same), entry("2026-10-02T08:00:00Z", 82)], TZ, NOW);
    expect(points[0].entries).toBe(2);
    expect(points[0].averageKg).toBe(81);
  });

  it("returns nothing for no entries or an invalid `now`", () => {
    expect(weeklyPoints([], TZ, NOW)).toEqual([]);
    expect(weeklyPoints([entry("2026-10-01T08:00:00Z", 80)], TZ, new Date("nope"))).toEqual([]);
  });

  it("does not slice: every week is returned", () => {
    const many = Array.from({ length: 70 }, (_, i) => entry(new Date(Date.UTC(2025, 5, 1 + 7 * i, 8)).toISOString(), 80));
    expect(weeklyPoints(many, TZ, new Date("2027-03-01T09:00:00Z"))).toHaveLength(70);
  });
});

describe("weeklyDirection", () => {
  it.each([
    ["78.1, 77.4, 76.9, 76.2 (the worked example, d = -24)", [78.1, 77.4, 76.9, 76.2], "DOWN"],
    ["78.1, 78.3, 78.2, 78.1 (d = -1)", [78.1, 78.3, 78.2, 78.1], "STEADY"],
    ["77.0, 77.4, 77.9, 78.5 (d = +20)", [77.0, 77.4, 77.9, 78.5], "UP"],
  ] as const)("%s -> %s", (_name, averages, expected) => {
    expect(weeklyDirection(weeks([...averages]))).toBe(expected);
  });

  it("is on the boundary at exactly a 0.5 kg difference between the two-week means (d = -10 and +10 in tenths)", () => {
    expect(weeklyDirection(weeks([80.0, 80.0, 79.5, 79.5]))).toBe("DOWN"); // d = -10
    expect(weeklyDirection(weeks([80.0, 80.0, 79.5, 79.6]))).toBe("STEADY"); // d = -9
    expect(weeklyDirection(weeks([80.0, 80.0, 80.4, 80.5]))).toBe("STEADY"); // d = +9
    expect(weeklyDirection(weeks([80.0, 80.0, 80.5, 80.5]))).toBe("UP"); // d = +10
  });

  it("compares the newest two weeks with the two before, not first against last", () => {
    // first-vs-last would say DOWN (81 -> 80.6); two-week means say UP.
    expect(weeklyDirection(weeks([81.0, 79.0, 80.6, 80.6]))).toBe("UP");
  });

  it("is null with fewer than four complete points", () => {
    expect(weeklyDirection([])).toBeNull();
    expect(weeklyDirection(weeks([80, 79, 78]))).toBeNull();
  });

  it("is null with five points when only three are complete (the others are unfinished)", () => {
    const pts = [...weeks([80, 79, 78]), point(weekKey(3), 70, false), point(weekKey(4), 60, false)];
    expect(weeklyDirection(pts)).toBeNull();
  });

  it("never lets the unfinished week change the answer", () => {
    const four = weeks([78.1, 78.3, 78.2, 78.1]);
    const withTail = [...four, point(weekKey(4), 60, false)];
    expect(weeklyDirection(withTail)).toBe(weeklyDirection(four));
    expect(weeklyDirection(withTail)).toBe("STEADY");
  });

  it("uses the person's own weigh-in weeks: a week without a weigh-in is skipped, not a zero", () => {
    // Weeks 0, 1, 3, 4 have a point; week 2 has none. The four are those.
    const pts = [point(weekKey(0), 78.1), point(weekKey(1), 77.4), point(weekKey(3), 76.9), point(weekKey(4), 76.2)];
    expect(weeklyDirection(pts)).toBe("DOWN");
  });

  it("looks only at the newest four of a longer history", () => {
    const pts = weeks([90, 85, 80, 78.1, 78.3, 78.2, 78.1]);
    expect(weeklyDirection(pts)).toBe("STEADY");
  });

  it("stays STEADY under ordinary scatter of 0.3 kg around a flat line", () => {
    for (const scatter of [
      [78.0, 78.3, 77.9, 78.2],
      [78.3, 78.0, 78.3, 78.0],
      [78.0, 78.3, 78.0, 78.3],
      [78.2, 77.9, 78.3, 78.0],
    ]) {
      expect(weeklyDirection(weeks(scatter))).toBe("STEADY");
    }
  });

  it("accepts the points in any order", () => {
    expect(weeklyDirection(weeks([78.1, 77.4, 76.9, 76.2]).reverse())).toBe("DOWN");
  });

  it("is silent when the newest four weigh-in weeks are spread over more than eight weeks (they are not 'the last weeks')", () => {
    const at = (indexes: number[]) => indexes.map((i, n) => point(weekKey(i), [78.1, 77.4, 76.9, 76.2][n]));
    expect(weeklyDirection(at([0, 1, 2, 3]))).toBe("DOWN");
    expect(weeklyDirection(at([0, 3, 5, 8]))).toBe("DOWN"); // first to last: exactly 8 weeks
    expect(weeklyDirection(at([0, 3, 5, 9]))).toBeNull(); // 9 weeks
    expect(weeklyDirection(at([0, 1, 2, 30]))).toBeNull(); // spring weeks and an autumn week
  });

  it("measures the span of the newest four only, however long the history behind them", () => {
    const old = [point(weekKey(-40), 90), point(weekKey(-39), 89)];
    expect(weeklyDirection([...old, ...weeks([78.1, 77.4, 76.9, 76.2])])).toBe("DOWN");
  });
});

describe("buildWeightTrend: state", () => {
  const NOW = new Date("2026-10-28T09:00:00Z");
  const trend = (points: TrendPoint[], baselineKg: number | null) => buildWeightTrend({ points, baselineKg, timeZone: TZ, now: NOW });

  it.each([
    [null, 0, "NONE"],
    [80, 0, "START_ONLY"],
    [null, 1, "NOT_ENOUGH"],
    [80, 1, "NOT_ENOUGH"],
    [null, 2, "LINE"],
    [80, 2, "LINE"],
  ] as const)("baseline %s with %s points -> %s", (baseline, count, expected) => {
    expect(trend(weeks([79, 78].slice(0, count), 5), baseline).state).toBe(expected);
  });

  it("counts the unfinished week as a point for the state (it is drawn)", () => {
    expect(trend([point(weekKey(5), 79), point(weekKey(6), 78, false)], 80).state).toBe("LINE");
  });

  it("slices to the newest 52 weekly points but keeps the newest as `latest`", () => {
    const all = weeks(Array.from({ length: 60 }, (_, i) => 90 - i * 0.1), -30);
    const t = buildWeightTrend({ points: all, baselineKg: 90, timeZone: TZ, now: new Date("2028-01-01T09:00:00Z") });
    expect(t.points).toHaveLength(52);
    expect(t.points[0]).toEqual(all[8]);
    expect(t.points[51]).toEqual(all[59]);
    expect(t.latest).toEqual(all[59]);
  });

  it("gives latest, latestComplete and the baseline", () => {
    const pts = [...weeks([79, 78], 4), point(weekKey(6), 77, false)];
    const t = trend(pts, 80);
    expect(t.latest).toEqual(pts[2]);
    expect(t.latestComplete).toEqual(pts[1]);
    expect(t.baselineKg).toBe(80);
  });

  it("has no latest with no points, and ignores a non-finite baseline", () => {
    const t = trend([], Number.NaN);
    expect(t).toMatchObject({ state: "NONE", latest: null, latestComplete: null, baselineKg: null, stale: false, direction: null, plateau: false, sinceStart: null });
  });
});

describe("buildWeightTrend: stale", () => {
  const lastWeek = weekKey(0); // 2026-09-13
  const pts = [point(weekKey(-1), 79), point(lastWeek, 78)];
  const at = (iso: string) => buildWeightTrend({ points: pts, baselineKg: 80, timeZone: TZ, now: new Date(iso) });

  it("is not stale 3 weeks after the newest point's week, and stale at 4", () => {
    expect(at("2026-10-07T09:00:00Z").stale).toBe(false); // week of now: 10-04 = 3 weeks after 09-13
    expect(at("2026-10-10T20:59:00Z").stale).toBe(false); // Saturday night of that same week
    expect(at("2026-10-10T21:00:00Z").stale).toBe(true); // Sunday 2026-10-11 00:00 local: 4 weeks
    expect(at("2026-10-14T09:00:00Z").stale).toBe(true);
  });

  it("is not stale in the very week of the newest point", () => {
    expect(at("2026-09-16T09:00:00Z").stale).toBe(false);
  });

  it("suppresses BOTH the direction and the since-the-start sentence", () => {
    const four = weeks([78.1, 77.4, 76.9, 76.2]);
    const fresh = buildWeightTrend({ points: four, baselineKg: 80, timeZone: TZ, now: new Date("2026-10-14T09:00:00Z") }); // week of 10-11: 1 week after 10-04
    expect(fresh.stale).toBe(false);
    expect(fresh.direction).toBe("DOWN");
    expect(fresh.sinceStart).not.toBeNull();

    const old = buildWeightTrend({ points: four, baselineKg: 80, timeZone: TZ, now: new Date("2026-11-11T09:00:00Z") }); // week of 11-08: 5 weeks after 10-04
    expect(old.stale).toBe(true);
    expect(old.direction).toBeNull();
    expect(old.plateau).toBe(false);
    expect(old.sinceStart).toBeNull();
    expect(old.state).toBe("LINE");
  });

  describe("a fresh unfinished week over an old completed history", () => {
    // Weeks 0..3 are complete (78.1, 77.4, 76.9, 76.2); the newest point is the unfinished week `now` is in.
    const history = weeks([78.1, 77.4, 76.9, 76.2]);
    const withThisWeek = (weekIndex: number, iso: string) =>
      buildWeightTrend({ points: [...history, point(weekKey(weekIndex), 86, false)], baselineKg: 80, timeZone: TZ, now: new Date(iso) });

    it("says nothing about the old weeks: not stale (the chart is current), but no direction and no since-the-start sentence", () => {
      const t = withThisWeek(20, "2027-02-03T09:00:00Z"); // week of 2027-01-31 = index 20: 17 weeks after the newest completed week
      expect(t.state).toBe("LINE");
      expect(t.latest?.complete).toBe(false);
      expect(t.stale).toBe(false);
      expect(t.latestComplete?.averageKg).toBe(76.2);
      expect(t.direction).toBeNull();
      expect(t.plateau).toBe(false);
      expect(t.sinceStart).toBeNull();
    });

    it("still speaks when the newest completed week is 3 weeks back, and is silent at 4", () => {
      const three = withThisWeek(6, "2026-10-28T09:00:00Z"); // week of 10-25 = index 6; the newest completed week is index 3
      expect(three.direction).toBe("DOWN");
      expect(three.sinceStart).not.toBeNull();
      const four = withThisWeek(7, "2026-11-04T09:00:00Z"); // week of 11-01 = index 7: 4 weeks after index 3
      expect(four.direction).toBeNull();
      expect(four.sinceStart).toBeNull();
    });

    it("does not print a months-old average as the since-the-start sentence after a single old reading", () => {
      const t = buildWeightTrend({
        points: [point("2026-07-05", 80, true), point("2026-10-04", 79, false)],
        baselineKg: 80,
        timeZone: TZ,
        now: new Date("2026-10-07T09:00:00Z"),
      });
      expect(t.state).toBe("LINE");
      expect(t.stale).toBe(false);
      expect(t.sinceStart).toBeNull();
    });
  });

  it("is never stale for a point in the future week (a skewed clock)", () => {
    const t = buildWeightTrend({ points: [point("2026-12-06", 79), point("2026-12-13", 78)], baselineKg: 80, timeZone: TZ, now: new Date("2026-10-14T09:00:00Z") });
    expect(t.stale).toBe(false);
  });
});

describe("buildWeightTrend: plateau", () => {
  const NOW = new Date("2026-10-14T09:00:00Z");

  it("is true exactly when the direction is STEADY", () => {
    const steady = buildWeightTrend({ points: weeks([78.1, 78.3, 78.2, 78.1]), baselineKg: 80, timeZone: TZ, now: NOW });
    const down = buildWeightTrend({ points: weeks([78.1, 77.4, 76.9, 76.2]), baselineKg: 80, timeZone: TZ, now: NOW });
    const up = buildWeightTrend({ points: weeks([77.0, 77.4, 77.9, 78.5]), baselineKg: 80, timeZone: TZ, now: NOW });
    const few = buildWeightTrend({ points: weeks([78.1, 78.3, 78.2]), baselineKg: 80, timeZone: TZ, now: NOW });
    expect([steady.direction, steady.plateau]).toEqual(["STEADY", true]);
    expect([down.direction, down.plateau]).toEqual(["DOWN", false]);
    expect([up.direction, up.plateau]).toEqual(["UP", false]);
    expect([few.direction, few.plateau]).toEqual([null, false]);
  });

  it("does not use the unfinished week", () => {
    const pts = [...weeks([78.1, 78.3, 78.2]), point(weekKey(3), 78.1, false)];
    const t = buildWeightTrend({ points: pts, baselineKg: 80, timeZone: TZ, now: new Date("2026-10-08T09:00:00Z") });
    expect(t.direction).toBeNull();
    expect(t.plateau).toBe(false);
  });
});

describe("buildWeightTrend: since the start", () => {
  const NOW = new Date("2026-10-07T09:00:00Z"); // week of 10-04
  const since = (newest: number, baseline: number | null = 80) =>
    buildWeightTrend({ points: weeks([81, newest]), baselineKg: baseline, timeZone: TZ, now: NOW }).sinceStart;

  it("is SAME below 0.5 kg either way, and LOWER or HIGHER from 0.5 kg", () => {
    expect(since(79.6)).toEqual({ kind: "SAME", kg: 0.4 });
    expect(since(80.4)).toEqual({ kind: "SAME", kg: 0.4 });
    expect(since(80)).toEqual({ kind: "SAME", kg: 0 });
    expect(since(79.5)).toEqual({ kind: "LOWER", kg: 0.5 });
    expect(since(80.5)).toEqual({ kind: "HIGHER", kg: 0.5 });
  });

  it("gives the same absolute number with the same words for the same distance in either direction", () => {
    expect(since(76.2)).toEqual({ kind: "LOWER", kg: 3.8 });
    expect(since(83.8)).toEqual({ kind: "HIGHER", kg: 3.8 });
  });

  it("works from a decimal baseline without float noise", () => {
    expect(since(113.7, 118.7)).toEqual({ kind: "LOWER", kg: 5 });
    expect(since(118.2, 118.7)).toEqual({ kind: "LOWER", kg: 0.5 });
  });

  it("is about the newest COMPLETE week, not the unfinished one", () => {
    const pts = [...weeks([81, 79.0]), point(weekKey(2), 60, false)];
    const t = buildWeightTrend({ points: pts, baselineKg: 80, timeZone: TZ, now: new Date("2026-10-07T09:00:00Z") });
    expect(t.sinceStart).toEqual({ kind: "LOWER", kg: 1 });
  });

  it("is null without a baseline, with no complete point, and without a line", () => {
    expect(since(79, null)).toBeNull();
    const unfinished = buildWeightTrend({ points: [point(weekKey(2), 79, false), point(weekKey(3), 78, false)], baselineKg: 80, timeZone: TZ, now: new Date("2026-10-07T09:00:00Z") });
    expect(unfinished.latestComplete).toBeNull();
    expect(unfinished.sinceStart).toBeNull();
    const one = buildWeightTrend({ points: weeks([79]), baselineKg: 80, timeZone: TZ, now: NOW });
    expect(one.sinceStart).toBeNull();
  });
});

describe("buildWeightTrend: slicing by the caller", () => {
  it("answers for the week the points stop at (Weekly Learning slices the points, not the clock)", () => {
    const all = weeks([78.1, 77.4, 76.9, 76.2, 70]);
    const now = new Date("2026-10-21T09:00:00Z"); // week of 10-18 = index 5
    const full = buildWeightTrend({ points: all, baselineKg: 80, timeZone: TZ, now });
    const upToFour = buildWeightTrend({ points: all.slice(0, 4), baselineKg: 80, timeZone: TZ, now });
    expect(full.direction).toBe("DOWN");
    expect(upToFour.direction).toBe("DOWN");
    expect(upToFour.latestComplete?.averageKg).toBe(76.2);
  });
});
