import { describe, expect, it } from "vitest";
import type { OfflinePeriod } from "../offline";
import { zonedInstantUtc } from "../time";
import type { WeightEntry } from "../weight/types";
import type { WeeklyMeal } from "./derive";
import { buildWeeklyStory, chooseOpeningMode, type WeeklyStory } from "./story";
import type { ExperimentRecord, PatternSignal } from "./types";
import { shiftWeek, weekWindowOf } from "./week";
import { weeklyWeightFacts, type WeeklyWeightFacts } from "./weightFacts";

const TZ = "Asia/Jerusalem";
const DAY = 86_400_000;

function local(day: string, time = "08:00"): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedInstantUtc(y, m, d, hh, mm, TZ);
}
const shabbat = (friday: string, saturday: string): OfflinePeriod => ({ type: "SHABBAT", start: local(friday, "17:00"), end: local(saturday, "18:00") });

// The summarised week is 2027-01-03 .. 2027-01-09 (Sunday to Saturday); the story is read on Sunday 2027-01-10 05:00.
const WEEK = weekWindowOf(local("2027-01-05", "12:00"), TZ);
const NEXT_WEEK = shiftWeek(WEEK, 1, TZ);
const NOW = local("2027-01-10", "05:00");
const PERIODS = [shabbat("2027-01-01", "2027-01-02"), shabbat("2027-01-08", "2027-01-09")];

const meal = (day: string, time = "08:00", over: Partial<WeeklyMeal> = {}): WeeklyMeal => ({ id: `${day}T${time}`, occurredAt: local(day, time), aggregated: false, ...over });
/** `n` meals on n different available days of the week (Sunday, Monday, Tuesday, ...). */
const mealDays = (n: number): WeeklyMeal[] => ["2027-01-03", "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07"].slice(0, n).map((d) => meal(d));

function weight(over: Partial<WeeklyWeightFacts> = {}): WeeklyWeightFacts {
  return { known: true, line: { kind: "NONE" }, milestone: null, weighedThisWeek: false, lastEntryAt: null, hasBaselineOrEntry: true, ...over };
}

const record = (over: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
  id: "x1",
  status: "DONE",
  key: "eat_intentionally",
  variantId: "default",
  sourcePatternId: null,
  startedAt: local("2026-12-30", "10:00"),
  endedAt: local("2027-01-11", "09:00"),
  helpfulness: "SOMEWHAT",
  tried: "YES",
  ...over,
});
const signal = (view: PatternSignal["view"], over: Partial<PatternSignal> = {}): PatternSignal => ({
  kind: "late_evening_meals",
  patternId: "p1",
  view,
  feedback: null,
  feedbackAt: null,
  ...over,
});

type Input = Parameters<typeof buildWeeklyStory>[0];
function build(over: Partial<Input> = {}): WeeklyStory {
  return buildWeeklyStory({
    now: NOW,
    timeZone: TZ,
    window: { start: WEEK.start, end: WEEK.end },
    week: { start: WEEK.start, end: WEEK.end },
    answerWindow: { start: WEEK.end, end: NEXT_WEEK.end },
    periods: PERIODS,
    periodsComplete: true,
    meals: [],
    lastMealBefore: null,
    weight: weight(),
    signals: [],
    experiments: [],
    ...over,
  });
}

/** A return: the last meal before the week is Tuesday, the first this week is on Monday (Wednesday, Thursday, Friday, Sunday between). */
const RETURN: Pick<Input, "meals" | "lastMealBefore"> = { meals: [meal("2027-01-04")], lastMealBefore: local("2026-12-29", "20:00") };

describe("chooseOpeningMode", () => {
  const base = { meaningful: true, milestone: null, experimentHelpful: false, returned: false, periodsComplete: true };

  it("is LEARN with data and nothing special", () => {
    expect(chooseOpeningMode(base)).toEqual({ mode: "LEARN", reason: "data", lineKey: "learn" });
  });

  it("is RESET (a quiet week) when nothing is meaningful, whatever else is true", () => {
    const quiet = { mode: "RESET", reason: "little_data", lineKey: "quiet" };
    expect(chooseOpeningMode({ ...base, meaningful: false })).toEqual(quiet);
    expect(chooseOpeningMode({ ...base, meaningful: false, milestone: { index: 1, isGoal: false }, experimentHelpful: true, returned: true })).toEqual(quiet);
  });

  it("is CELEBRATE for a landmark, with the goal line for the goal", () => {
    expect(chooseOpeningMode({ ...base, milestone: { index: 1, isGoal: false } })).toEqual({ mode: "CELEBRATE", reason: "milestone", lineKey: "celebrateMilestone" });
    expect(chooseOpeningMode({ ...base, milestone: { index: 3, isGoal: true } })).toEqual({ mode: "CELEBRATE", reason: "milestone", lineKey: "celebrateGoal" });
  });

  it("is CELEBRATE for an experiment that really helped", () => {
    expect(chooseOpeningMode({ ...base, experimentHelpful: true })).toEqual({ mode: "CELEBRATE", reason: "experiment_helpful", lineKey: "celebrateExperiment" });
  });

  it("is RECOVER for a return, and only when the offline rows are complete", () => {
    expect(chooseOpeningMode({ ...base, returned: true })).toEqual({ mode: "RECOVER", reason: "returned", lineKey: "recover" });
    expect(chooseOpeningMode({ ...base, returned: true, periodsComplete: false })).toEqual({ mode: "LEARN", reason: "data", lineKey: "learn" });
  });

  it("precedence: a milestone beats an experiment that helped, which beats a return", () => {
    expect(chooseOpeningMode({ ...base, milestone: { index: 1, isGoal: false }, experimentHelpful: true, returned: true }).reason).toBe("milestone");
    expect(chooseOpeningMode({ ...base, experimentHelpful: true, returned: true }).reason).toBe("experiment_helpful");
    expect(chooseOpeningMode({ ...base, milestone: { index: 1, isGoal: false }, returned: true }).mode).toBe("CELEBRATE");
  });
});

describe("buildWeeklyStory: the mode table", () => {
  it("two meal days alone are a quiet week (RESET) and three are LEARN", () => {
    expect(build({ meals: mealDays(2) })).toMatchObject({ mode: "RESET", reason: "little_data", lineKey: "quiet" });
    expect(build({ meals: mealDays(3) })).toMatchObject({ mode: "LEARN", reason: "data", lineKey: "learn" });
  });

  it("an empty week is a quiet week", () => {
    expect(build()).toMatchObject({ mode: "RESET" });
  });

  it("a weigh-in alone makes the week meaningful (LEARN)", () => {
    expect(build({ weight: weight({ weighedThisWeek: true, line: { kind: "FIRST" } }) })).toMatchObject({ mode: "LEARN" });
  });

  it("an answered result alone makes the week meaningful (LEARN)", () => {
    expect(build({ experiments: [record()] })).toMatchObject({ mode: "LEARN" });
    // "I did not get to try" is an answer too, and is never a failure.
    expect(build({ experiments: [record({ tried: "NO", helpfulness: null })] })).toMatchObject({ mode: "LEARN" });
  });

  it("a return alone (periods complete) is RECOVER; with incomplete periods it is a quiet week with no RETURNED line", () => {
    const recovered = build({ ...RETURN });
    expect(recovered).toMatchObject({ mode: "RECOVER", reason: "returned", lineKey: "recover" });
    expect(recovered.happened).toContainEqual({ kind: "RETURNED" });

    const shaky = build({ ...RETURN, periodsComplete: false });
    expect(shaky).toMatchObject({ mode: "RESET" });
    expect(shaky.happened).not.toContainEqual({ kind: "RETURNED" });
  });

  it("a return with enough meal days is still RECOVER (the return is the story)", () => {
    expect(build({ meals: [...mealDays(4)], lastMealBefore: local("2026-12-28", "20:00") })).toMatchObject({ mode: "RECOVER" });
  });

  it("precedence: a milestone beats a return and an experiment that helped; the helped experiment beats a return", () => {
    expect(build({ ...RETURN, weight: weight({ weighedThisWeek: true, milestone: { index: 1, isGoal: false } }) })).toMatchObject({ mode: "CELEBRATE", reason: "milestone" });
    expect(build({ ...RETURN, experiments: [record({ helpfulness: "HELPFUL" })] })).toMatchObject({ mode: "CELEBRATE", reason: "experiment_helpful" });
    expect(build({ weight: weight({ weighedThisWeek: true, milestone: { index: 2, isGoal: true } }), experiments: [record({ helpfulness: "HELPFUL" })] })).toMatchObject({
      reason: "milestone",
      lineKey: "celebrateGoal",
    });
  });

  it("an UP week never changes the mode, never removes a milestone, and holds no negative field", () => {
    const up = weight({ weighedThisWeek: true, line: { kind: "UP" } });
    expect(build({ meals: mealDays(3), weight: up })).toMatchObject({ mode: "LEARN", weight: { kind: "UP" } });
    expect(build({ meals: mealDays(3), weight: { ...up, milestone: { index: 1, isGoal: false } } })).toMatchObject({ mode: "CELEBRATE", reason: "milestone", weight: { kind: "UP" } });
    expect(Object.keys(build({ meals: mealDays(3), weight: up })).sort()).toEqual(["happened", "invite", "learned", "lineKey", "mode", "patternQuestion", "reason", "weight"]);
  });
});

describe("buildWeeklyStory: the milestone and the line through the real weight facts", () => {
  // Landmarks of 80 -> 72 are [80, 75, 72]; one entry on each Sunday.
  const entry = (day: string, kg: number, time = "08:00"): WeightEntry => ({ id: `e-${day}-${time}`, weightKg: kg, measuredAt: local(day, time) });
  const sundays = (kgs: number[]): WeightEntry[] => kgs.map((kg, i) => entry(["2026-12-20", "2026-12-27", "2027-01-03"].slice(-kgs.length)[i], kg));
  const real = (entries: WeightEntry[], over: Partial<Parameters<typeof weeklyWeightFacts>[0]> = {}) =>
    weeklyWeightFacts({
      entries,
      truncated: false,
      week: WEEK,
      windowStart: WEEK.start,
      timeZone: TZ,
      now: NOW,
      profile: { startWeightKg: 80, goalWeightKg: 72, goalType: "numeric" },
      ...over,
    });

  it("a landmark CONFIRMED in this week (the second of two consecutive complete averages) celebrates; the goal gets its own line", () => {
    expect(build({ weight: real(sundays([74.8, 74.6])) })).toMatchObject({ mode: "CELEBRATE", reason: "milestone", lineKey: "celebrateMilestone" });
    expect(build({ weight: real(sundays([71.9, 71.8])) })).toMatchObject({ mode: "CELEBRATE", reason: "milestone", lineKey: "celebrateGoal" });
  });

  it("the FIRST week of such a pair does not celebrate yet", () => {
    const first = weekWindowOf(local("2026-12-30", "12:00"), TZ); // the week of 2026-12-27
    const story = build({
      week: { start: first.start, end: first.end },
      window: { start: first.start, end: first.end },
      answerWindow: { start: first.end, end: WEEK.end },
      weight: real(sundays([74.8, 74.6]), { week: first, windowStart: first.start, now: local("2027-01-03", "05:00") }),
      meals: [meal("2026-12-27"), meal("2026-12-28"), meal("2026-12-29")],
    });
    expect(story.mode).toBe("LEARN");
  });

  it("a landmark confirmed in an earlier week is not celebrated again", () => {
    const after = weekWindowOf(local("2027-01-12", "12:00"), TZ); // the week of 2027-01-10
    const entries = [...sundays([74.8, 74.6]), entry("2027-01-10", 74.5)];
    const story = build({
      week: { start: after.start, end: after.end },
      window: { start: after.start, end: after.end },
      answerWindow: { start: after.end, end: shiftWeek(after, 1, TZ).end },
      weight: real(entries, { week: after, windowStart: after.start, now: local("2027-01-17", "05:00") }),
    });
    expect(story.mode).toBe("LEARN");
  });

  it("an unknown series gives no milestone and no line", () => {
    const story = build({ meals: mealDays(3), weight: real(sundays([74.8, 74.6]), { truncated: true }) });
    expect(story).toMatchObject({ mode: "LEARN", weight: { kind: "NONE" }, invite: { weighIn: false } });
  });

  it("the weight line is NONE without a counted weigh-in this week (one made before the window start does not count)", () => {
    const story = build({
      window: { start: local("2027-01-04", "00:00"), end: WEEK.end },
      meals: mealDays(3),
      weight: real([entry("2027-01-03", 78)], { windowStart: local("2027-01-04", "00:00") }),
    });
    expect(story.weight).toEqual({ kind: "NONE" });
    expect(story.happened).not.toContainEqual({ kind: "WEIGHED" });
  });
});

describe("buildWeeklyStory: experiment facts belong to ONE story", () => {
  const helped = (over: Partial<ExperimentRecord> = {}) => record({ helpfulness: "HELPFUL", endedAt: local("2027-01-11", "09:00"), ...over });

  it("the same 'really helped' answer celebrates in the story of the week it was answered for, and NOT in the next consecutive story", () => {
    const answeredOn = helped({ endedAt: local("2027-01-11", "09:00") });
    expect(build({ experiments: [answeredOn] })).toMatchObject({ mode: "CELEBRATE", reason: "experiment_helpful", lineKey: "celebrateExperiment" });

    // The next story summarises 2027-01-10 .. 2027-01-16; the answer was given INSIDE that week, so it belongs to the previous story.
    const story = build({
      now: local("2027-01-17", "05:00"),
      week: { start: NEXT_WEEK.start, end: NEXT_WEEK.end },
      window: { start: NEXT_WEEK.start, end: NEXT_WEEK.end },
      answerWindow: { start: NEXT_WEEK.end, end: shiftWeek(NEXT_WEEK, 1, TZ).end },
      experiments: [answeredOn],
    });
    expect(story.mode).toBe("RESET");
    expect(story.learned).toEqual([{ kind: "NOT_YET" }]);
    expect(story.happened).toEqual([]);
  });

  it("an answer exactly at week.end counts, and one exactly at the next week.end belongs to the next story", () => {
    expect(build({ experiments: [helped({ endedAt: WEEK.end })] }).reason).toBe("experiment_helpful");
    expect(build({ experiments: [helped({ endedAt: NEXT_WEEK.end })] }).mode).toBe("RESET");
    expect(build({ experiments: [helped({ endedAt: new Date(NEXT_WEEK.end.getTime() - 1) })] }).reason).toBe("experiment_helpful");
  });

  it("an answer given inside the week itself (before week.end) is invisible to this story", () => {
    const inside = helped({ endedAt: local("2027-01-06", "09:00") });
    expect(build({ experiments: [inside] })).toMatchObject({ mode: "RESET", learned: [{ kind: "NOT_YET" }] });
  });

  it("EXPERIMENT_STARTED appears once for a start inside the week, never for a start at or after week.end", () => {
    const inside = record({ status: "ACTIVE", endedAt: null, helpfulness: null, tried: null, startedAt: local("2027-01-05", "12:00") });
    expect(build({ meals: mealDays(3), experiments: [inside] }).happened.filter((h) => h.kind === "EXPERIMENT_STARTED")).toHaveLength(1);

    const after = record({ status: "ACTIVE", endedAt: null, helpfulness: null, tried: null, startedAt: WEEK.end });
    expect(build({ meals: mealDays(3), experiments: [after] }).happened.some((h) => h.kind === "EXPERIMENT_STARTED")).toBe(false);
    const justBefore = record({ status: "ACTIVE", endedAt: null, helpfulness: null, tried: null, startedAt: new Date(WEEK.end.getTime() - 1) });
    expect(build({ meals: mealDays(3), experiments: [justBefore] }).happened.some((h) => h.kind === "EXPERIMENT_STARTED")).toBe(true);
  });

  it("a start before the window (the transition day) does not count either", () => {
    const early = record({ status: "ACTIVE", endedAt: null, helpfulness: null, tried: null, startedAt: local("2027-01-03", "10:00") });
    const story = build({ window: { start: local("2027-01-04", "00:00"), end: WEEK.end }, meals: mealDays(5).slice(1), experiments: [early] });
    expect(story.happened.some((h) => h.kind === "EXPERIMENT_STARTED")).toBe(false);
  });

  it("EXPERIMENT_TRIED supersedes EXPERIMENT_STARTED, and a 'did not get to try' answer is not 'tried'", () => {
    const tried = record({ startedAt: local("2027-01-05", "12:00") });
    expect(build({ meals: mealDays(3), experiments: [tried] }).happened).toEqual([{ kind: "MEALS" }, { kind: "EXPERIMENT_TRIED" }]);
    const notTried = record({ startedAt: local("2027-01-05", "12:00"), tried: "NO", helpfulness: null });
    expect(build({ meals: mealDays(3), experiments: [notTried] }).happened).toEqual([{ kind: "MEALS" }, { kind: "EXPERIMENT_STARTED" }]);
  });

  it("a skipped or merely offered experiment says nothing", () => {
    const skipped = record({ status: "SKIPPED", helpfulness: null, tried: null, endedAt: local("2027-01-11", "09:00") });
    const offered = record({ status: "OFFERED", helpfulness: null, tried: null, startedAt: null, endedAt: null });
    expect(build({ meals: mealDays(3), experiments: [skipped, offered] })).toMatchObject({ happened: [{ kind: "MEALS" }], learned: [{ kind: "NOT_YET" }] });
  });
});

describe("buildWeeklyStory: happened and learned", () => {
  it("lists what happened in order, with no number", () => {
    const story = build({
      meals: mealDays(3),
      weight: weight({ weighedThisWeek: true, line: { kind: "FIRST" } }),
      experiments: [record({ startedAt: local("2027-01-05") })],
      lastMealBefore: RETURN.lastMealBefore,
    });
    expect(story.happened.map((h) => h.kind)).toEqual(["MEALS", "WEIGHED", "RETURNED", "EXPERIMENT_TRIED"]);
  });

  it("omits MEALS when no meal day counts and may be empty", () => {
    expect(build({ meals: [meal("2027-01-04", "09:00", { aggregated: true })] }).happened).toEqual([]);
  });

  it("learned is never empty: NOT_YET when nothing else", () => {
    expect(build({ meals: mealDays(3) }).learned).toEqual([{ kind: "NOT_YET" }]);
  });

  it("maps the late-evening levels: EARLY_SIGNAL stays EARLY_SIGNAL, CANDIDATE and VALIDATED are ESTABLISHED", () => {
    expect(build({ signals: [signal("EARLY_SIGNAL")] }).learned).toEqual([{ kind: "LATE_EVENING", level: "EARLY_SIGNAL" }]);
    expect(build({ signals: [signal("CANDIDATE")] }).learned).toEqual([{ kind: "LATE_EVENING", level: "ESTABLISHED" }]);
    expect(build({ signals: [signal("VALIDATED")] }).learned).toEqual([{ kind: "LATE_EVENING", level: "ESTABLISHED" }]);
  });

  it("a REJECTED or empty pattern yields no line", () => {
    expect(build({ signals: [signal("REJECTED", { feedback: "reject" })] }).learned).toEqual([{ kind: "NOT_YET" }]);
    expect(build({ signals: [signal("NONE")] }).learned).toEqual([{ kind: "NOT_YET" }]);
  });

  it.each([
    ["HELPFUL", "YES", "helpful"],
    ["SOMEWHAT", "YES", "somewhat"],
    ["NOT_REALLY", "YES", "not_really"],
    ["UNKNOWN", "YES", "unknown"],
    [null, "NO", "not_tried"],
  ] as const)("shows the answer %s / tried %s as %s", (helpfulness, tried, result) => {
    const story = build({ experiments: [record({ helpfulness, tried })] });
    expect(story.learned).toEqual([{ kind: "EXPERIMENT", result }]);
  });

  it("puts the pattern line before the experiment line, and shows the NEWEST answer only", () => {
    const older = record({ id: "a", helpfulness: "NOT_REALLY", endedAt: local("2027-01-11", "09:00") });
    const newer = record({ id: "b", helpfulness: "SOMEWHAT", endedAt: local("2027-01-12", "09:00") });
    const story = build({ signals: [signal("VALIDATED")], experiments: [older, newer] });
    expect(story.learned).toEqual([
      { kind: "LATE_EVENING", level: "ESTABLISHED" },
      { kind: "EXPERIMENT", result: "somewhat" },
    ]);
  });
});

describe("buildWeeklyStory: the pattern question", () => {
  it("asks for an unanswered CANDIDATE", () => {
    expect(build({ signals: [signal("CANDIDATE")] }).patternQuestion).toEqual({ kind: "ASK", patternKind: "late_evening_meals" });
    expect(build({ signals: [signal("CANDIDATE", { patternId: null })] }).patternQuestion).toEqual({ kind: "ASK", patternKind: "late_evening_meals" });
  });

  it("never asks at VALIDATED, REJECTED, EARLY_SIGNAL or NONE", () => {
    for (const view of ["VALIDATED", "REJECTED", "EARLY_SIGNAL", "NONE"] as const) {
      expect(build({ signals: [signal(view)] }).patternQuestion).toEqual({ kind: "NONE" });
    }
  });

  it("does not ask again after 'Sounds right' or 'Not related to me'", () => {
    expect(build({ signals: [signal("CANDIDATE", { feedback: "confirm", feedbackAt: NOW })] }).patternQuestion).toEqual({ kind: "NONE" });
    expect(build({ signals: [signal("CANDIDATE", { feedback: "reject", feedbackAt: NOW })] }).patternQuestion).toEqual({ kind: "NONE" });
  });

  it("asks again 14 days after 'Not sure', not before", () => {
    const unsure = (daysAgo: number) => signal("CANDIDATE", { feedback: "unsure", feedbackAt: new Date(NOW.getTime() - daysAgo * DAY) });
    expect(build({ signals: [unsure(13)] }).patternQuestion).toEqual({ kind: "NONE" });
    expect(build({ signals: [unsure(14)] }).patternQuestion).toEqual({ kind: "ASK", patternKind: "late_evening_meals" });
    expect(build({ signals: [signal("CANDIDATE", { feedback: "unsure", feedbackAt: null })] }).patternQuestion).toEqual({ kind: "NONE" });
  });
});

describe("buildWeeklyStory: the soft weigh-in invitation", () => {
  const silent = (days: number | null, over: Partial<WeeklyWeightFacts> = {}) =>
    weight({ lastEntryAt: days === null ? null : new Date(NOW.getTime() - days * DAY), ...over });

  it("is false after 13 days of silence and true after 14", () => {
    expect(build({ meals: mealDays(3), weight: silent(13) }).invite.weighIn).toBe(false);
    expect(build({ meals: mealDays(3), weight: silent(14) }).invite.weighIn).toBe(true);
    expect(build({ meals: mealDays(3), weight: silent(60) }).invite.weighIn).toBe(true);
  });

  it("is true when there has never been an entry but a start weight exists", () => {
    expect(build({ meals: mealDays(3), weight: silent(null) }).invite.weighIn).toBe(true);
    expect(build({ meals: mealDays(3), weight: silent(null, { hasBaselineOrEntry: false }) }).invite.weighIn).toBe(false);
  });

  it("is true in a celebrating week and false in a returning or quiet week", () => {
    expect(build({ weight: silent(20, { milestone: { index: 1, isGoal: false }, weighedThisWeek: true }) })).toMatchObject({ mode: "CELEBRATE", invite: { weighIn: true } });
    expect(build({ ...RETURN, weight: silent(20) })).toMatchObject({ mode: "RECOVER", invite: { weighIn: false } });
    expect(build({ weight: silent(20) })).toMatchObject({ mode: "RESET", invite: { weighIn: false } });
  });

  it("is false when the weight series is unknown", () => {
    expect(build({ meals: mealDays(3), weight: silent(30, { known: false }) }).invite.weighIn).toBe(false);
  });
});

describe("buildWeeklyStory: shape", () => {
  const hasNumber = (value: unknown): boolean => {
    if (typeof value === "number") return true;
    if (Array.isArray(value)) return value.some(hasNumber);
    if (value !== null && typeof value === "object") return Object.values(value).some(hasNumber);
    return false;
  };

  it("contains no number at all, in any mode", () => {
    const stories = [
      build(),
      build({ meals: mealDays(5), signals: [signal("CANDIDATE")], experiments: [record({ helpfulness: "HELPFUL" })] }),
      build({ ...RETURN }),
      build({ meals: mealDays(3), weight: weight({ weighedThisWeek: true, line: { kind: "DOWN" }, milestone: { index: 2, isGoal: true }, lastEntryAt: local("2026-12-01") }) }),
    ];
    for (const story of stories) expect(hasNumber(story)).toBe(false);
  });

  it("does not mutate its input", () => {
    const input: Input = {
      now: NOW,
      timeZone: TZ,
      window: { start: WEEK.start, end: WEEK.end },
      week: { start: WEEK.start, end: WEEK.end },
      answerWindow: { start: WEEK.end, end: NEXT_WEEK.end },
      periods: PERIODS,
      periodsComplete: true,
      meals: [...mealDays(3), meal("2027-01-07", "21:30")],
      lastMealBefore: local("2026-12-29", "20:00"),
      weight: weight({ weighedThisWeek: true, line: { kind: "STEADY" } }),
      signals: [signal("CANDIDATE")],
      experiments: [record({ helpfulness: "HELPFUL" })],
    };
    const snapshot = JSON.stringify(input);
    buildWeeklyStory(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("is deterministic", () => {
    const args = { meals: mealDays(4), signals: [signal("CANDIDATE")] };
    expect(build(args)).toEqual(build(args));
  });
});
