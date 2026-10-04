import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRow } from "@/domain/onboarding";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { createFakeWeeklySupabase, type WeeklyAnswer, type WeeklyCall, type WeeklyConfig } from "./fakeWeeklySupabase";
import { loadWeeklyStory, type WeeklyStoryLoad } from "./load";

// The switches are read at call time, so one mutable stand-in serves every case.
const flow = vi.hoisted(() => ({ enabled: true, patternQuestionEnabled: true, starterExperimentsEnabled: false, aiLineEnabled: true, weightLineEnabled: true }));
vi.mock("@/domain/weekly/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/weekly/types")>()),
  WEEKLY_FLOW: flow,
}));
const patternFlow = vi.hoisted(() => ({ detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true }));
vi.mock("@/domain/patterns/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/patterns/types")>()),
  PATTERN_FLOW: patternFlow,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const TZ = "Asia/Jerusalem";

// January 2027, Jerusalem is UTC+2. The story is about the week Sunday 2027-01-03 .. Saturday 2027-01-09, read on Sunday 11:00.
const NOW = new Date("2027-01-10T09:00:00Z");
const WEEK_START = "2027-01-03";
const WEEK_START_UTC = "2027-01-02T22:00:00.000Z";
const WEEK_END_UTC = "2027-01-09T22:00:00.000Z";
const NEXT_WEEK_END_UTC = "2027-01-16T22:00:00.000Z";
const PERIODS_FROM = "2026-12-05T22:00:00.000Z";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const meal = (n: number, iso: string, aggregated = false) => ({ id: uuid(n), occurred_at: iso, aggregated });
// Three meal days make a week meaningful on their own (a LEARN week).
const THREE_MEAL_DAYS = [meal(1, "2027-01-03T10:00:00Z"), meal(2, "2027-01-04T10:00:00Z"), meal(3, "2027-01-05T10:00:00Z")];
const LATE_EVENINGS = [1, 2, 3].map((d) => ({ id: uuid(100 + d), occurred_at: `2027-01-0${2 + d}T19:30:00Z` })); // 21:30 local on three days

const MEALS_COLUMNS = "id, occurred_at, aggregated";
const SIGNAL_COLUMNS = "id, occurred_at";
const SERIES_COLUMNS = "id, weight_kg, measured_at";

interface World {
  /** The profile's transition stamp. */
  firstWeekEndedAt?: string | null;
  periods?: unknown[];
  meals?: unknown[];
  lastBefore?: unknown[];
  signalMeals?: unknown[];
  patterns?: unknown[];
  weights?: unknown[];
  weeklyRow?: unknown[];
  history?: unknown[];
}
type Overrides = Partial<Record<string, WeeklyConfig>>;

const rowsOf = (rows: unknown[]): WeeklyAnswer => ({ rows });

function tablesFor(world: World, over: Overrides = {}): Record<string, WeeklyConfig> {
  return {
    profiles: rowsOf([{ first_week_ended_at: world.firstWeekEndedAt === undefined ? "2026-12-20T10:00:00Z" : world.firstWeekEndedAt }]),
    offline_periods: rowsOf(world.periods ?? []),
    meal_entries: (call: WeeklyCall) =>
      call.columns === MEALS_COLUMNS
        ? rowsOf(world.meals ?? THREE_MEAL_DAYS)
        : call.columns === SIGNAL_COLUMNS
          ? rowsOf(world.signalMeals ?? [])
          : rowsOf(world.lastBefore ?? []),
    weight_entries: rowsOf(world.weights ?? []),
    weekly_summaries: rowsOf(world.weeklyRow ?? []),
    experiments: rowsOf(world.history ?? []),
    patterns: rowsOf(world.patterns ?? []),
    ...over,
  };
}

function profileContext(supabase: Extract<OnboardingContext, { kind: "ready" }>["supabase"], over: Record<string, unknown> = {}): OnboardingContext {
  const row = normalizeRow({ lifecycle_state: "WEEKLY_CYCLE", timezone: TZ, observes_shabbat: false, goal_focus: ["improve_eating", "understand_overeating"], ...over }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase };
}

async function run(world: World = {}, over: Overrides = {}, profile: Record<string, unknown> = {}, now: Date = NOW) {
  const { client, calls } = createFakeWeeklySupabase(tablesFor(world, over));
  const result = await loadWeeklyStory(profileContext(client, profile), now);
  return { result, calls };
}

function ready(result: WeeklyStoryLoad) {
  if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
  return result;
}

const FAILS: WeeklyAnswer = { error: { code: "42501" } };
const THROWS: WeeklyAnswer = "throw";

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  flow.enabled = true;
  flow.starterExperimentsEnabled = false;
  flow.weightLineEnabled = true;
  patternFlow.detectionEnabled = true;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadWeeklyStory: no query when there is nothing to read", () => {
  it.each(["not_configured", "signed_out", "unavailable", "profile_missing"] as const)("%s: not_weekly_cycle with zero queries", async (kind) => {
    const { client, calls } = createFakeWeeklySupabase(tablesFor({}));
    const context = { kind, supabase: client, userId: USER } as unknown as OnboardingContext;
    expect(await loadWeeklyStory(context, NOW)).toEqual({ kind: "not_weekly_cycle" });
    expect(calls).toEqual([]);
  });

  it.each(["NEW", "ONBOARDING", "FIRST_WEEK"])("%s: not_weekly_cycle with zero queries", async (lifecycle_state) => {
    const { result, calls } = await run({}, {}, { lifecycle_state });
    expect(result).toEqual({ kind: "not_weekly_cycle" });
    expect(calls).toEqual([]);
  });

  it("the switch off: not_ready with zero queries", async () => {
    flow.enabled = false;
    const { result, calls } = await run();
    expect(result).toEqual({ kind: "not_ready" });
    expect(calls).toEqual([]);
  });

  it("a malformed context (no row) is unavailable, never a throw", async () => {
    const { client } = createFakeWeeklySupabase(tablesFor({}));
    const malformed = { kind: "ready", userId: USER, supabase: client } as unknown as OnboardingContext;
    expect(await loadWeeklyStory(malformed, NOW)).toEqual({ kind: "unavailable" });
  });

  it("an invalid instant is not ready with zero queries", async () => {
    const { result, calls } = await run({}, {}, {}, new Date(Number.NaN));
    expect(result).toEqual({ kind: "not_ready" });
    expect(calls).toEqual([]);
  });
});

describe("loadWeeklyStory: a moment that is not ready reads no meal, weight or history", () => {
  const STAGE_ONE = ["offline_periods", "profiles"];

  it.each([
    ["no transition stamp", { firstWeekEndedAt: null }],
    ["a window under 4 available days (continued on Thursday)", { firstWeekEndedAt: "2027-01-07T08:00:00Z" }],
  ])("%s: not_ready after the two stage-1 reads only", async (_name, world) => {
    const { result, calls } = await run(world);
    expect(result).toEqual({ kind: "not_ready" });
    expect(calls.map((c) => c.table).sort()).toEqual(STAGE_ONE);
  });

  it("before the week is ready (Sunday 04:59 local) the earlier week is the candidate, but a transition after it is not ready either", async () => {
    // The transition was on Sunday 2027-01-03 itself: the candidate week before Sunday 05:00 is 2026-12-27, which ended before the transition.
    const { result, calls } = await run({ firstWeekEndedAt: "2027-01-03T08:00:00Z" }, {}, {}, new Date("2027-01-10T02:59:00Z"));
    expect(result).toEqual({ kind: "not_ready" });
    expect(calls.map((c) => c.table).sort()).toEqual(STAGE_ONE);
  });
});

describe("loadWeeklyStory: the exact queries", () => {
  it("stage 1 is the transition stamp and the bounded periods of the candidate week", async () => {
    const { calls } = await run();
    const profile = calls.find((c) => c.table === "profiles");
    const periods = calls.find((c) => c.table === "offline_periods");
    expect(profile).toMatchObject({ columns: "first_week_ended_at", filters: [["eq", "user_id", USER]], limit: 1 });
    expect(periods).toMatchObject({
      columns: "type, start_at, end_at",
      filters: [
        ["eq", "user_id", USER],
        ["gt", "end_at", PERIODS_FROM],
        ["lte", "start_at", WEEK_END_UTC],
      ],
      order: [{ column: "start_at", ascending: true }],
      limit: 120,
    });
  });

  it("stage 2 asks for the week's meals, the last meal before the window, the row, the history, the signal and the weight series", async () => {
    const { calls } = await run();
    const meals = calls.find((c) => c.table === "meal_entries" && c.columns === MEALS_COLUMNS);
    const lastBefore = calls.find((c) => c.table === "meal_entries" && c.columns === "occurred_at");
    expect(meals).toMatchObject({
      filters: [
        ["eq", "user_id", USER],
        ["gte", "occurred_at", WEEK_START_UTC],
        ["lt", "occurred_at", WEEK_END_UTC],
      ],
      order: [{ column: "occurred_at", ascending: true }],
      limit: 300,
    });
    expect(lastBefore).toMatchObject({
      filters: [
        ["eq", "user_id", USER],
        ["eq", "aggregated", false],
        ["lt", "occurred_at", WEEK_START_UTC],
      ],
      order: [{ column: "occurred_at", ascending: false }],
      limit: 1,
    });
    expect(calls.find((c) => c.table === "weekly_summaries")).toMatchObject({
      columns: "opening_mode, content, viewed_at",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "week_start", WEEK_START],
      ],
      limit: 1,
    });
    expect(calls.find((c) => c.table === "experiments")).toMatchObject({
      columns: expect.stringContaining("intervention_key"),
      filters: [["eq", "user_id", USER]],
      order: [{ column: "created_at", ascending: false }],
      limit: 20,
    });
    expect(calls.find((c) => c.table === "weight_entries")).toMatchObject({ columns: SERIES_COLUMNS, filters: [["eq", "user_id", USER]], limit: 1500 });
    expect(calls.find((c) => c.table === "patterns")).toBeDefined();
    expect(calls.find((c) => c.table === "meal_entries" && c.columns === SIGNAL_COLUMNS)).toBeDefined();
  });

  it("the meals read starts at the WINDOW start, which is the day after the transition day in the first eligible week", async () => {
    // Transition on Tuesday 2027-01-05 10:00 local: the window starts Wednesday 00:00 local.
    const { calls } = await run({ firstWeekEndedAt: "2027-01-05T08:00:00Z" });
    const windowStart = "2027-01-05T22:00:00.000Z";
    expect(calls.find((c) => c.table === "meal_entries" && c.columns === MEALS_COLUMNS)?.filters).toEqual([
      ["eq", "user_id", USER],
      ["gte", "occurred_at", windowStart],
      ["lt", "occurred_at", WEEK_END_UTC],
    ]);
    expect(calls.find((c) => c.table === "meal_entries" && c.columns === "occurred_at")?.filters).toContainEqual(["lt", "occurred_at", windowStart]);
  });

  it("never writes: every call is a select", async () => {
    const { calls } = await run();
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((c) => c.kind === "select")).toBe(true);
  });
});

describe("loadWeeklyStory: the story", () => {
  it("a LEARN week: three meal days, no pattern, no experiment, nothing opened", async () => {
    const r = ready((await run()).result);
    expect(r.moment).toMatchObject({ kind: "READY", availableDays: 7, week: { weekStart: WEEK_START }, window: { start: new Date(WEEK_START_UTC), end: new Date(WEEK_END_UTC) } });
    expect(r.availableDays).toBe(7);
    expect(r.story).toMatchObject({ mode: "LEARN", lineKey: "learn", weight: { kind: "NONE" } });
    expect(r.story.happened).toEqual([{ kind: "MEALS" }]);
    expect(r.experiment).toEqual({ decision: { kind: "NONE", reason: "none_eligible" }, open: null });
    expect(r.row).toBeNull();
    expect(r.signal).toEqual({ occurrences: [], row: null, view: expect.anything() });
    expect(r.patterns).toEqual([{ kind: "late_evening_meals", patternId: null, view: r.signal?.view, feedback: null, feedbackAt: null }]);
    expect(r.goalFocus).toEqual(["improve_eating", "understand_overeating"]);
  });

  it("two meal days alone are a quiet week (the enum is RESET, the line key is quiet)", async () => {
    const r = ready((await run({ meals: THREE_MEAL_DAYS.slice(0, 2) })).result);
    expect(r.story).toMatchObject({ mode: "RESET", lineKey: "quiet" });
  });

  it("aggregated meals and meals inside an offline period are not meal days", async () => {
    const shabbat = { type: "SHABBAT", start_at: "2027-01-08T14:10:00Z", end_at: "2027-01-09T16:25:00Z" };
    const meals = [meal(1, "2027-01-03T10:00:00Z"), meal(2, "2027-01-04T10:00:00Z", true), meal(3, "2027-01-09T09:00:00Z")];
    const r = ready((await run({ meals, periods: [shabbat] })).result);
    expect(r.story.mode).toBe("RESET");
  });

  it("the experiment decision is computed with the story's mode: a returning week offers nothing new", async () => {
    // The last meal before the window was on Monday 2026-12-28; the week's first meal is on Sunday 2027-01-03.
    flow.starterExperimentsEnabled = true;
    const r = ready((await run({ lastBefore: [{ occurred_at: "2026-12-28T10:00:00Z" }] })).result);
    expect(r.story.mode).toBe("RECOVER");
    expect(r.experiment.decision).toEqual({ kind: "NONE", reason: "recovering" });

    const learn = ready((await run({ lastBefore: [{ occurred_at: "2027-01-01T08:00:00Z" }] })).result);
    expect(learn.story.mode).toBe("LEARN");
    expect(learn.experiment.decision).toMatchObject({ kind: "OFFER", origin: "starter", key: "eat_intentionally" });
  });

  it("starter experiments are off by default: a LEARN week without a pattern offers nothing", async () => {
    expect(ready((await run()).result).experiment.decision).toEqual({ kind: "NONE", reason: "none_eligible" });
  });

  it("an established late-evening pattern is a signal, a pattern fact, a question and a pattern offer", async () => {
    const r = ready((await run({ signalMeals: LATE_EVENINGS })).result);
    expect(r.signal?.view).toBe("CANDIDATE");
    expect(r.patterns).toEqual([{ kind: "late_evening_meals", patternId: null, view: r.signal?.view, feedback: null, feedbackAt: null }]);
    expect(r.story.patternQuestion).toEqual({ kind: "ASK", patternKind: "late_evening_meals" });
    expect(r.experiment.decision).toMatchObject({ kind: "OFFER", origin: "pattern", key: "eat_intentionally", patternId: null, rationale: { kind: "PATTERN" } });
  });

  it("the person's own pattern row is carried into the pattern fact", async () => {
    const row = { id: "p1", status: "CANDIDATE", user_feedback: "confirm", user_feedback_at: "2027-01-06T09:00:00Z" };
    const r = ready((await run({ signalMeals: LATE_EVENINGS, patterns: [row] })).result);
    expect(r.patterns[0]).toMatchObject({ patternId: "p1", feedback: "confirm", feedbackAt: new Date("2027-01-06T09:00:00Z") });
    expect(r.story.patternQuestion).toEqual({ kind: "NONE" });
  });

  it("an unknown signal (its read failed) is no pattern, and the rest still renders", async () => {
    const r = ready((await run({ signalMeals: LATE_EVENINGS }, { patterns: FAILS })).result);
    expect(r.signal).toBeNull();
    expect(r.patterns).toEqual([]);
    expect(r.story.mode).toBe("LEARN");
  });

  it("with detection switched off the signal is unknown and no pattern query is made", async () => {
    patternFlow.detectionEnabled = false;
    const { result, calls } = await run({ signalMeals: LATE_EVENINGS });
    expect(ready(result).patterns).toEqual([]);
    expect(calls.map((c) => c.table)).not.toContain("patterns");
  });
});

describe("loadWeeklyStory: the answer window", () => {
  const done = (endedAt: string, over: Record<string, unknown> = {}) => ({
    id: "e1",
    status: "DONE",
    intervention_key: "eat_intentionally",
    variant: "default",
    source_pattern_id: null,
    started_at: "2026-12-29T08:00:00Z",
    ended_at: endedAt,
    helpfulness: "HELPFUL",
    tried: "YES",
    wording: "x",
    wording_source: "library",
    wording_locale: "he",
    ...over,
  });

  it("a 'really helped' given AFTER the week ended (inside [week.end, next week.end)) celebrates this story", async () => {
    const r = ready((await run({ history: [done("2027-01-10T07:00:00Z")] })).result);
    expect(r.story).toMatchObject({ mode: "CELEBRATE", reason: "experiment_helpful", lineKey: "celebrateExperiment" });
  });

  it("the same answer given inside the week itself belongs to the previous story", async () => {
    const r = ready((await run({ history: [done("2027-01-06T07:00:00Z")], meals: THREE_MEAL_DAYS.slice(0, 2) })).result);
    expect(r.story.mode).toBe("RESET");
  });

  it("an answer at exactly week.end counts; one at exactly the next week.end belongs to the next story", async () => {
    expect(ready((await run({ history: [done(WEEK_END_UTC)] })).result).story.mode).toBe("CELEBRATE");
    expect(ready((await run({ history: [done(NEXT_WEEK_END_UTC)], meals: THREE_MEAL_DAYS.slice(0, 2) })).result).story.mode).toBe("RESET");
  });

  it("a start inside the week is 'started'; a start after it is not", async () => {
    const active = (startedAt: string) => ({ ...done("2027-01-20T00:00:00Z"), status: "ACTIVE", ended_at: null, helpfulness: null, tried: null, started_at: startedAt });
    const inside = ready((await run({ history: [active("2027-01-04T08:00:00Z")] })).result);
    expect(inside.story.happened).toContainEqual({ kind: "EXPERIMENT_STARTED" });
    const after = ready((await run({ history: [active("2027-01-10T08:00:00Z")] })).result);
    expect(after.story.happened).not.toContainEqual({ kind: "EXPERIMENT_STARTED" });
  });

  it("the history and its open experiment come from the same read", async () => {
    const offered = { ...done("2027-01-20T00:00:00Z"), id: "o1", status: "OFFERED", started_at: null, ended_at: null, helpfulness: null, tried: null };
    const r = ready((await run({ history: [offered] })).result);
    expect(r.experiment.decision).toEqual({ kind: "PENDING", experimentId: "o1" });
    expect(r.experiment.open).toMatchObject({ id: "o1", status: "OFFERED", key: "eat_intentionally", origin: "starter" });
  });
});

describe("loadWeeklyStory: the weight", () => {
  const weight = (n: number, kg: string, iso: string) => ({ id: uuid(200 + n), weight_kg: kg, measured_at: iso });
  const MONDAY_WEIGH_IN = weight(1, "79.5", "2027-01-04T06:00:00Z");

  it("a weigh-in in the week is the FIRST line, and carries no figure", async () => {
    const r = ready((await run({ weights: [MONDAY_WEIGH_IN] }, {}, { start_weight_kg: 80, goal_weight_kg: 72, goal_type: "numeric" })).result);
    expect(r.story.weight).toEqual({ kind: "FIRST" });
    expect(r.story.happened).toContainEqual({ kind: "WEIGHED" });
    expect(JSON.stringify(r.story)).not.toContain("79.5");
  });

  it("a weigh-in made BEFORE the window start belongs to the First Week summary: no weighed-this-week, no line", async () => {
    // Transition on Tuesday 10:00 local: the window starts Wednesday 00:00, and the weigh-in was on Monday.
    const r = ready((await run({ firstWeekEndedAt: "2027-01-05T08:00:00Z", weights: [MONDAY_WEIGH_IN] })).result);
    expect(r.story.weight).toEqual({ kind: "NONE" });
    expect(r.story.happened).not.toContainEqual({ kind: "WEIGHED" });
  });

  it("an entry on or after the window start counts", async () => {
    const wednesday = weight(2, "79.4", "2027-01-06T06:00:00Z");
    const r = ready((await run({ firstWeekEndedAt: "2027-01-05T08:00:00Z", weights: [wednesday] })).result);
    expect(r.story.weight).toEqual({ kind: "FIRST" });
  });

  it("a series that came back truncated (1500 rows) omits the weight line and the invitation, and the rest is rendered", async () => {
    const full = Array.from({ length: 1500 }, (_, i) => weight(300 + i, "79.5", "2027-01-04T06:00:00Z"));
    const r = ready((await run({ weights: full }, {}, { start_weight_kg: 80 })).result);
    expect(r.story.weight).toEqual({ kind: "NONE" });
    expect(r.story.invite).toEqual({ weighIn: false });
    expect(r.story.mode).toBe("LEARN");
  });

  it("just under the cap is not truncated", async () => {
    const almost = Array.from({ length: 1499 }, (_, i) => weight(300 + i, "79.5", "2027-01-04T06:00:00Z"));
    expect(ready((await run({ weights: almost })).result).story.weight).toEqual({ kind: "FIRST" });
  });

  it.each([
    ["an error", FAILS],
    ["a thrown read", THROWS],
  ])("a failing weight read (%s) omits the weight and leaves the story", async (_name, answer) => {
    const r = ready((await run({}, { weight_entries: answer }, { start_weight_kg: 80 })).result);
    expect(r.story.weight).toEqual({ kind: "NONE" });
    expect(r.story.invite).toEqual({ weighIn: false });
    expect(r.story.mode).toBe("LEARN");
  });

  it("the soft weigh-in invitation shows for a LEARN week with a known start weight and no entry", async () => {
    expect(ready((await run({}, {}, { start_weight_kg: 80 })).result).story.invite).toEqual({ weighIn: true });
    expect(ready((await run()).result).story.invite).toEqual({ weighIn: false });
  });

  it("the switch off for the weight line: no line, no invitation", async () => {
    flow.weightLineEnabled = false;
    const r = ready((await run({ weights: [MONDAY_WEIGH_IN] }, {}, { start_weight_kg: 80 })).result);
    expect(r.story.weight).toEqual({ kind: "NONE" });
    expect(r.story.invite).toEqual({ weighIn: false });
  });
});

describe("loadWeeklyStory: periodsComplete", () => {
  const RETURNING = { lastBefore: [{ occurred_at: "2026-12-28T10:00:00Z" }] };
  const shabbatOfTheWeek = { type: "SHABBAT", start_at: "2027-01-08T14:10:00Z", end_at: "2027-01-09T16:25:00Z" };

  it("a person who does not observe Shabbat is complete: a return is a return", async () => {
    expect(ready((await run(RETURNING, {}, { observes_shabbat: false })).result).story.mode).toBe("RECOVER");
  });

  it("an observant person with a SHABBAT period overlapping the week is complete", async () => {
    expect(ready((await run({ ...RETURNING, periods: [shabbatOfTheWeek] }, {}, { observes_shabbat: true })).result).story.mode).toBe("RECOVER");
  });

  it("an observant person with NO SHABBAT row for the week is incomplete: RECOVER is disabled and no return is claimed", async () => {
    const r = ready((await run(RETURNING, {}, { observes_shabbat: true })).result);
    expect(r.story.mode).toBe("LEARN");
    expect(r.story.happened).not.toContainEqual({ kind: "RETURNED" });
  });

  it("a SHABBAT row of another week does not make this week complete", async () => {
    const lastWeek = { type: "SHABBAT", start_at: "2027-01-01T14:10:00Z", end_at: "2027-01-02T16:25:00Z" };
    expect(ready((await run({ ...RETURNING, periods: [lastWeek] }, {}, { observes_shabbat: true })).result).story.mode).toBe("LEARN");
  });

  it("a row of another type does not count as Shabbat", async () => {
    const vacation = { type: "VACATION", start_at: "2027-01-08T14:10:00Z", end_at: "2027-01-09T16:25:00Z" };
    expect(ready((await run({ ...RETURNING, periods: [vacation] }, {}, { observes_shabbat: true })).result).story.mode).toBe("LEARN");
  });
});

describe("loadWeeklyStory: the stored row and its line", () => {
  const line = { text: "עוד חלק קטן נכנס לתמונה.", locale: "he", source: "ai", mode: "LEARN", key: "learn" };
  const weeklyRow = (content: unknown, over: Record<string, unknown> = {}) => [{ opening_mode: "LEARN", content, viewed_at: "2027-01-10T07:30:00Z", ...over }];

  it("an opened week with its line", async () => {
    const r = ready((await run({ weeklyRow: weeklyRow({ v: 1, line }) })).result);
    expect(r.row).toEqual({
      openingMode: "LEARN",
      viewedAt: new Date("2027-01-10T07:30:00Z"),
      line: { text: line.text, locale: "he", mode: "LEARN", key: "learn" },
    });
  });

  it("an opened week without a line", async () => {
    const r = ready((await run({ weeklyRow: weeklyRow({ v: 1 }) })).result);
    expect(r.row).toEqual({ openingMode: "LEARN", viewedAt: new Date("2027-01-10T07:30:00Z"), line: null });
  });

  it.each([
    ["a CELEBRATE line", { ...line, mode: "CELEBRATE", key: "celebrateMilestone" }],
    ["another key", { ...line, key: "quiet" }],
    ["an unknown locale", { ...line, locale: "fr" }],
    ["an empty text", { ...line, text: "  " }],
    ["a text over 400 characters", { ...line, text: "x".repeat(401) }],
    ["a text that is not a string", { ...line, text: 5 }],
    ["a line that is not an object", "line"],
    ["a null line", null],
  ])("%s is no line (only a LEARN line is ever stored)", async (_name, bad) => {
    const r = ready((await run({ weeklyRow: weeklyRow({ v: 1, line: bad }) })).result);
    expect(r.row?.line).toBeNull();
    expect(r.row?.openingMode).toBe("LEARN");
  });

  it("a content that is not an object has no line", async () => {
    expect(ready((await run({ weeklyRow: weeklyRow([1, 2]) })).result).row?.line).toBeNull();
  });

  it("an unknown opening mode is no row; an unreadable viewed_at is null", async () => {
    expect(ready((await run({ weeklyRow: weeklyRow({ v: 1 }, { opening_mode: "RESTART" }) })).result).row).toBeNull();
    expect(ready((await run({ weeklyRow: weeklyRow({ v: 1 }, { viewed_at: "soon" }) })).result).row?.viewedAt).toBeNull();
  });
});

describe("loadWeeklyStory: unknown is unavailable, never a guess", () => {
  it.each([
    ["profiles", FAILS],
    ["profiles", THROWS],
    ["offline_periods", FAILS],
    ["offline_periods", THROWS],
    ["weekly_summaries", FAILS],
    ["weekly_summaries", THROWS],
    ["experiments", FAILS],
    ["experiments", THROWS],
  ])("%s failing (%j) is unavailable", async (table, answer) => {
    expect((await run({}, { [table]: answer })).result).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["the week's meals", MEALS_COLUMNS],
    ["the last meal before the window", "occurred_at"],
  ])("%s failing is unavailable (the other meal read still answers)", async (_name, columns) => {
    for (const bad of [FAILS, THROWS]) {
      const over: Overrides = { meal_entries: (call: WeeklyCall) => (call.columns === columns ? bad : rowsOf(call.columns === MEALS_COLUMNS ? THREE_MEAL_DAYS : [])) };
      expect((await run({}, over)).result).toEqual({ kind: "unavailable" });
    }
  });

  it("exactly 300 meals back is truncated, so unavailable; 299 is a story", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => meal(400 + i, "2027-01-04T10:00:00Z"));
    expect((await run({ meals: many(300) })).result).toEqual({ kind: "unavailable" });
    expect((await run({ meals: many(299) })).result.kind).toBe("ready");
  });

  it("exactly 120 offline periods back is truncated, so unavailable", async () => {
    const period = { type: "SHABBAT", start_at: "2026-12-05T14:10:00Z", end_at: "2026-12-06T16:25:00Z" };
    expect((await run({ periods: Array.from({ length: 120 }, () => period) })).result).toEqual({ kind: "unavailable" });
    expect((await run({ periods: Array.from({ length: 119 }, () => period) })).result.kind).toBe("ready");
  });

  it("an answer that is not a list is unavailable", async () => {
    const odd = { data: "nope" } as const;
    for (const table of ["profiles", "offline_periods", "weekly_summaries", "experiments"]) {
      expect((await run({}, { [table]: odd })).result, table).toEqual({ kind: "unavailable" });
    }
  });

  it("a client that throws on from() is unavailable", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof profileContext>[0];
    expect(await loadWeeklyStory(profileContext(broken), NOW)).toEqual({ kind: "unavailable" });
  });

  it("logs only codes, never the user id", async () => {
    await run({}, { weekly_summaries: FAILS });
    for (const call of errorLog.mock.calls) expect(JSON.stringify(call)).not.toContain(USER);
  });

  it("takes the instant it is given", async () => {
    // One week earlier the same data is the previous week's story.
    const r = ready((await run({}, {}, {}, new Date("2027-01-17T09:00:00Z"))).result);
    expect(r.moment.week.weekStart).toBe("2027-01-10");
  });
});
