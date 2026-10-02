import { describe, expect, it } from "vitest";
import { decideMilestoneMoment, milestoneProgress, type MilestoneProgress, type MilestoneStep } from "./milestoneProgress";
import { addDaysToDayKey, type TrendPoint } from "./trend";

const TZ = "Asia/Jerusalem";
const FIRST_SUNDAY = "2026-09-13"; // weeks: 09-13, 09-20, 09-27, 10-04, 10-11, 10-18, 10-25, 11-01
const weekKey = (i: number) => addDaysToDayKey(FIRST_SUNDAY, 7 * i);
const point = (weekIndex: number, averageKg: number, complete = true): TrendPoint => ({ weekStart: weekKey(weekIndex), averageKg, entries: 1, complete });
/** Consecutive complete weeks from week index 0. */
const weeks = (averages: number[]): TrendPoint[] => averages.map((kg, i) => point(i, kg));

const progressOf = (points: TrendPoint[], over: Partial<Parameters<typeof milestoneProgress>[0]> = {}): MilestoneProgress =>
  milestoneProgress({ startKg: 80, goalKg: 72, goalType: "numeric", weeklyPoints: points, complete: true, ...over });

function list(p: MilestoneProgress): readonly MilestoneStep[] {
  if (p.kind !== "LIST") throw new Error(`expected LIST, got ${p.kind}`);
  return p.steps;
}
const states = (p: MilestoneProgress) => list(p).map((s) => s.state);

describe("milestoneProgress: the landmarks", () => {
  it("is the specification example for 80 to 72 (80, 75, 72) with kinds and indexes", () => {
    const steps = list(progressOf([]));
    expect(steps.map((s) => [s.index, s.kg, s.kind])).toEqual([
      [0, 80, "START"],
      [1, 75, "STEP"],
      [2, 72, "GOAL"],
    ]);
  });

  it("is the specification example for 120 to 99", () => {
    const steps = list(progressOf([], { startKg: 120, goalKg: 99 }));
    expect(steps.map((s) => s.kg)).toEqual([120, 115, 110, 105, 99]);
    expect(steps.map((s) => s.kind)).toEqual(["START", "STEP", "STEP", "STEP", "GOAL"]);
  });

  it("steps from a decimal start weight", () => {
    expect(list(progressOf([], { startKg: 118.7, goalKg: 99 })).map((s) => s.kg)).toEqual([118.7, 113.7, 108.7, 103.7, 99]);
  });

  it("has just the start and the goal when they are within one step", () => {
    const steps = list(progressOf([], { startKg: 76, goalKg: 72 }));
    expect(steps.map((s) => s.kind)).toEqual(["START", "GOAL"]);
  });

  it("marks the start reached with no week, the first unreached step NEXT and the rest AHEAD", () => {
    const p = progressOf([]);
    expect(states(p)).toEqual(["REACHED", "NEXT", "AHEAD"]);
    expect(list(p)[0]).toMatchObject({ reachedWeekStart: null, confirmedWeekStart: null });
    expect(p).toMatchObject({ goalReached: false });
  });
});

describe("milestoneProgress: when a step is reached", () => {
  it("needs TWO consecutive complete weekly averages at or below it: one low week is not enough", () => {
    expect(states(progressOf(weeks([79, 74.8, 76])))).toEqual(["REACHED", "NEXT", "AHEAD"]);
    expect(states(progressOf(weeks([79, 78, 74.8])))).toEqual(["REACHED", "NEXT", "AHEAD"]);
  });

  it("is reached by two low weeks in a row", () => {
    const p = progressOf(weeks([79, 74.9, 74.6]));
    expect(states(p)).toEqual(["REACHED", "REACHED", "NEXT"]);
    expect(list(p)[1]).toMatchObject({ reachedWeekStart: weekKey(1), confirmedWeekStart: weekKey(2) });
  });

  it("is not reached by one low complete week plus a low UNFINISHED week", () => {
    const p = progressOf([...weeks([79, 74.9]), point(2, 74.6, false)]);
    expect(states(p)).toEqual(["REACHED", "NEXT", "AHEAD"]);
  });

  it("is not reached by low, high, low (not consecutive)", () => {
    expect(states(progressOf(weeks([74.9, 76, 74.9])))).toEqual(["REACHED", "NEXT", "AHEAD"]);
  });

  it("counts two low weigh-in weeks with a week without a weigh-in between them (a gap is skipped, never a zero)", () => {
    const p = progressOf([point(0, 79), point(3, 74.9), point(5, 74.6)]);
    expect(states(p)).toEqual(["REACHED", "REACHED", "NEXT"]);
    expect(list(p)[1]).toMatchObject({ reachedWeekStart: weekKey(3), confirmedWeekStart: weekKey(5) });
  });

  it("counts an average EXACTLY at the step", () => {
    expect(states(progressOf(weeks([75, 75])))).toEqual(["REACHED", "REACHED", "NEXT"]);
    expect(states(progressOf(weeks([75.1, 75])))).toEqual(["REACHED", "NEXT", "AHEAD"]);
  });

  it("takes the first and second week of the EARLIEST qualifying pair", () => {
    const p = progressOf(weeks([79, 74.9, 74.8, 74.7, 74.6]));
    expect(list(p)[1]).toMatchObject({ reachedWeekStart: weekKey(1), confirmedWeekStart: weekKey(2) });
  });

  it("keeps a reached step reached when the weight rises again (landmarks are not pass/fail)", () => {
    const p = progressOf(weeks([79, 74.9, 74.8, 79, 81]));
    expect(states(p)).toEqual(["REACHED", "REACHED", "NEXT"]);
    expect(list(p)[1]).toMatchObject({ reachedWeekStart: weekKey(1), confirmedWeekStart: weekKey(2) });
  });

  it("reaches the goal and says so", () => {
    const p = progressOf(weeks([74, 71.9, 71.8]));
    expect(states(p)).toEqual(["REACHED", "REACHED", "REACHED"]);
    expect(p).toMatchObject({ goalReached: true });
    expect(list(p)[1]).toMatchObject({ reachedWeekStart: weekKey(0), confirmedWeekStart: weekKey(1) });
    expect(list(p)[2]).toMatchObject({ reachedWeekStart: weekKey(1), confirmedWeekStart: weekKey(2) });
  });

  it("reads ALL the points, not a window of them", () => {
    const old = weeks([79, 74.9, 74.8]);
    const later = Array.from({ length: 60 }, (_, i) => point(3 + i, 81));
    expect(states(progressOf([...old, ...later]))).toEqual(["REACHED", "REACHED", "NEXT"]);
  });

  it("accepts the points in any order", () => {
    expect(states(progressOf(weeks([79, 74.9, 74.8]).reverse()))).toEqual(["REACHED", "REACHED", "NEXT"]);
  });
});

describe("milestoneProgress: when the section does not exist", () => {
  const pts = weeks([79, 74.9, 74.8]);

  it.each(["behavioral", "none"] as const)("is NONE for the goal type %s whatever the numbers say", (goalType) => {
    expect(progressOf(pts, { goalType })).toEqual({ kind: "NONE" });
  });

  it("is NONE when a number is missing or the goal is not below the start", () => {
    expect(progressOf(pts, { startKg: null })).toEqual({ kind: "NONE" });
    expect(progressOf(pts, { goalKg: null })).toEqual({ kind: "NONE" });
    expect(progressOf(pts, { startKg: 72, goalKg: 72 })).toEqual({ kind: "NONE" });
    expect(progressOf(pts, { startKg: 70, goalKg: 72 })).toEqual({ kind: "NONE" });
  });

  it("is UNKNOWN for a truncated history only when milestones exist", () => {
    expect(progressOf(pts, { complete: false })).toEqual({ kind: "UNKNOWN" });
    expect(progressOf(pts, { complete: false, goalType: "none" })).toEqual({ kind: "NONE" });
    expect(progressOf(pts, { complete: false, goalKg: 90 })).toEqual({ kind: "NONE" });
  });
});

describe("decideMilestoneMoment", () => {
  // 75 is confirmed by the weeks 10-11 and 10-18 (the `w-milestone` shape).
  const reached = progressOf(weeks([79.6, 78.9, 78.1, 77.4, 74.9, 74.6]));
  const decide = (iso: string, over: Partial<Parameters<typeof decideMilestoneMoment>[0]> = {}) =>
    decideMilestoneMoment({ progress: reached, now: new Date(iso), timeZone: TZ, acknowledged: new Set(), ...over });

  it("opens at the local midnight that starts the week after the confirming week, and closes 14 calendar days later", () => {
    // confirmed 2026-10-18 -> window 2026-10-25 00:00 local .. 2026-11-08 00:00 local; DST ends 2026-10-25 02:00, inside the first day.
    expect(decide("2026-10-24T20:59:00Z")).toBeNull(); // Saturday 2026-10-24 23:59 local
    expect(decide("2026-10-24T21:00:00Z")).toEqual({ week: "2026-10-18", isGoal: false }); // 2026-10-25 00:00 local
    expect(decide("2026-11-07T21:59:00Z")).toEqual({ week: "2026-10-18", isGoal: false }); // 2026-11-07 23:59 local (UTC+2)
    expect(decide("2026-11-07T22:00:00Z")).toBeNull(); // 2026-11-08 00:00 local: no longer fresh
  });

  it("is not a moment during the confirming week itself", () => {
    expect(decide("2026-10-21T09:00:00Z")).toBeNull();
  });

  it("is nothing once that WEEK was acknowledged, and an unrelated acknowledgement hides nothing", () => {
    expect(decide("2026-10-28T09:00:00Z", { acknowledged: new Set(["2026-10-18"]) })).toBeNull();
    expect(decide("2026-10-28T09:00:00Z", { acknowledged: new Set(["2026-10-11", "2026-10-25"]) })).toEqual({ week: "2026-10-18", isGoal: false });
  });

  it("looks only at the HIGHEST reached step: a lower unacknowledged step is never dug up", () => {
    // 75 confirmed 10-04 (weeks 09-27, 10-04), 72 confirmed 10-25 (weeks 10-18, 10-25).
    const goal = progressOf(weeks([79, 77, 74.8, 74.0, 72.6, 71.9, 71.6]));
    const now = new Date("2026-11-04T09:00:00Z");
    expect(decideMilestoneMoment({ progress: goal, now, timeZone: TZ, acknowledged: new Set() })).toEqual({ week: "2026-10-25", isGoal: true });
    expect(decideMilestoneMoment({ progress: goal, now, timeZone: TZ, acknowledged: new Set(["2026-10-25"]) })).toBeNull();
    // Inside the older step's own window (10-11 .. 10-25) the goal is not open yet, and the older step is not dug up.
    expect(decideMilestoneMoment({ progress: goal, now: new Date("2026-10-14T09:00:00Z"), timeZone: TZ, acknowledged: new Set() })).toBeNull();
  });

  it("tells the goal from a landmark", () => {
    const goal = progressOf(weeks([79, 77, 74.8, 74.0, 72.6, 71.9, 71.6]));
    expect(decideMilestoneMoment({ progress: goal, now: new Date("2026-11-04T09:00:00Z"), timeZone: TZ, acknowledged: new Set() })?.isGoal).toBe(true);
    expect(decide("2026-10-28T09:00:00Z")?.isGoal).toBe(false);
  });

  it("is nothing when only the start is reached, and for NONE and UNKNOWN progress", () => {
    expect(decideMilestoneMoment({ progress: progressOf(weeks([79])), now: new Date("2026-10-28T09:00:00Z"), timeZone: TZ, acknowledged: new Set() })).toBeNull();
    for (const progress of [{ kind: "NONE" }, { kind: "UNKNOWN" }] as const) {
      expect(decideMilestoneMoment({ progress, now: new Date("2026-10-28T09:00:00Z"), timeZone: TZ, acknowledged: new Set() })).toBeNull();
    }
  });

  it("cannot be confirmed by the unfinished week", () => {
    const p = progressOf([...weeks([79, 78.9, 78.1, 77.4, 74.9]), point(5, 74.6, false)]);
    expect(decideMilestoneMoment({ progress: p, now: new Date("2026-10-28T09:00:00Z"), timeZone: TZ, acknowledged: new Set() })).toBeNull();
  });

  it("uses the profile's zone, and Jerusalem for a garbage one", () => {
    // In UTC the window opens at 2026-10-25 00:00Z, three hours later than in Jerusalem.
    expect(decide("2026-10-24T22:00:00Z", { timeZone: "UTC" })).toBeNull();
    expect(decide("2026-10-25T00:00:00Z", { timeZone: "UTC" })).not.toBeNull();
    expect(decide("2026-10-24T21:00:00Z", { timeZone: "Not/AZone" })).not.toBeNull();
  });

  it("never throws for an invalid instant", () => {
    expect(decide("nope")).toBeNull();
  });
});
