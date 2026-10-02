import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRow } from "@/domain/onboarding";
import { WEIGHT_TREND } from "@/domain/weight";
import { createFakeReadSupabase, type FakeTable } from "@/lib/home/fakeReadSupabase";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadMilestoneMoment, loadProgress } from "./load";

// The switch is read at call time, so one mutable stand-in serves every case.
const flow = vi.hoisted(() => ({ reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true }));
vi.mock("@/domain/weight/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/weight/types")>()),
  WEIGHT_FLOW: flow,
}));

const USER = "00000000-0000-4000-8000-000000000001";
// Wednesday 09:00 in Jerusalem (UTC+3 until 2026-10-25). Weeks start on Sunday: this one began on 2026-10-11.
const NOW = new Date("2026-10-14T06:00:00Z");

const EMPTY: FakeTable = { rows: [] };
const FAILS: FakeTable = { error: { code: "42501" } };
const THROWS: FakeTable = "throw";

let counter = 0;
const entry = (isoDay: string, kg: number) => ({
  id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  weight_kg: kg,
  measured_at: `${isoDay}T08:00:00+00:00`,
});

/** Start 80, goal 70: the landmarks are 80, 75 and 70. */
const NUMERIC = { goal_type: "numeric", start_weight_kg: 80, goal_weight_kg: 70 };

function context(supabase: SupabaseClient, over: Record<string, unknown> = {}): OnboardingContext {
  const row = normalizeRow({ lifecycle_state: "WEEKLY_CYCLE", timezone: "Asia/Jerusalem", ...NUMERIC, ...over }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase };
}

/** Two completed weeks at or below 75 (the weeks of 27 September and 4 October), the second one confirming the landmark. */
const REACHED_75 = () => [entry("2026-09-29", 74.9), entry("2026-10-06", 74.5)];
/** The same two weeks at or below 70: the goal. */
const REACHED_GOAL = () => [entry("2026-09-29", 69.5), entry("2026-10-06", 69.0)];

const tables = (over: Record<string, FakeTable> = {}): Record<string, FakeTable> => ({
  weight_entries: { rows: REACHED_75() },
  events: EMPTY,
  meal_entries: EMPTY,
  patterns: EMPTY,
  experiments: EMPTY,
  ...over,
});

const shape = (queries: Array<{ table: string; columns: string }>) => queries.map((q) => `${q.table}:${q.columns}`);
const SERIES = "weight_entries:id, weight_kg, measured_at";

beforeEach(() => {
  flow.milestoneMomentEnabled = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadMilestoneMoment: when it reads nothing at all", () => {
  it.each(["not_configured", "signed_out", "unavailable", "profile_missing"] as const)("%s: null and zero queries", async (kind) => {
    const { client, queries } = createFakeReadSupabase(tables());
    const ctx = { kind, supabase: client, userId: USER } as unknown as OnboardingContext;
    expect(await loadMilestoneMoment(ctx, NOW)).toBeNull();
    expect(queries).toEqual([]);
  });

  it("the switch off: null and zero queries, even with a landmark waiting", async () => {
    flow.milestoneMomentEnabled = false;
    const { client, queries } = createFakeReadSupabase(tables());
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
    expect(queries).toEqual([]);
  });

  it.each([
    ["goal_type none", { goal_type: "none" }],
    ["goal_type behavioral", { goal_type: "behavioral" }],
    ["a goal weight above the start weight", { goal_weight_kg: 85 }],
    ["a goal weight equal to the start weight", { goal_weight_kg: 80 }],
    ["no goal weight", { goal_weight_kg: null }],
    ["no start weight", { start_weight_kg: null }],
  ])("%s: no landmarks, null and zero queries", async (_name, over) => {
    const { client, queries } = createFakeReadSupabase(tables());
    expect(await loadMilestoneMoment(context(client, over), NOW)).toBeNull();
    expect(queries).toEqual([]);
  });
});

describe("loadMilestoneMoment: the queries it makes", () => {
  it("ONE query (the series) when there is no candidate", async () => {
    const { client, queries } = createFakeReadSupabase(tables({ weight_entries: { rows: [entry("2026-10-06", 74.5)] } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
    expect(shape(queries)).toEqual([SERIES]);
    expect(queries[0].filters).toEqual([["eq", "user_id", USER]]);
    expect(queries[0].order).toEqual({ column: "measured_at", ascending: false });
    expect(queries[0].limit).toBe(WEIGHT_TREND.maxEntriesRead);
  });

  it("an empty history is also one query and no moment", async () => {
    const { client, queries } = createFakeReadSupabase(tables({ weight_entries: EMPTY }));
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
    expect(shape(queries)).toEqual([SERIES]);
  });

  it("a low UNFINISHED week is not a candidate, so the acknowledgements are not read", async () => {
    const rows = [entry("2026-10-06", 74.5), entry("2026-10-12", 74.0)];
    const { client, queries } = createFakeReadSupabase(tables({ weight_entries: { rows } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
    expect(shape(queries)).toEqual([SERIES]);
  });

  it("TWO queries (the series, then the acknowledgements) when there is a candidate, asked in that order", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    expect(await loadMilestoneMoment(context(client), NOW)).toEqual({ week: "2026-10-04", isGoal: false });
    expect(shape(queries)).toEqual([SERIES, "events:payload"]);
    expect(queries[1].filters).toEqual([
      ["eq", "user_id", USER],
      ["eq", "name", "milestone_acknowledged"],
    ]);
    expect(queries[1].order).toEqual({ column: "occurred_at", ascending: false });
    expect(queries[1].limit).toBe(50);
  });

  it("the goal reached: isGoal", async () => {
    const { client } = createFakeReadSupabase(tables({ weight_entries: { rows: REACHED_GOAL() } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toEqual({ week: "2026-10-04", isGoal: true });
  });

  it("is a moment from the first day of the next week to the end of the 14th day, and not before or after", async () => {
    const at = (iso: string) => {
      const { client } = createFakeReadSupabase(tables());
      return loadMilestoneMoment(context(client), new Date(iso));
    };
    // The week after the confirming week (4 October) starts on Sunday 11 October, 00:00 in Jerusalem (UTC+3).
    expect(await at("2026-10-10T20:59:00Z")).toBeNull();
    expect(await at("2026-10-10T21:00:00Z")).toEqual({ week: "2026-10-04", isGoal: false });
    // The window ends at the local midnight 14 days later (25 October 00:00, still UTC+3: the clocks change at 02:00).
    expect(await at("2026-10-24T20:59:00Z")).toEqual({ week: "2026-10-04", isGoal: false });
    expect(await at("2026-10-24T21:00:00Z")).toBeNull();
  });
});

describe("loadMilestoneMoment: acknowledgements", () => {
  it("an acknowledged WEEK is null", async () => {
    const { client } = createFakeReadSupabase(tables({ events: { rows: [{ payload: { week: "2026-10-04" } }] } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
  });

  it("an acknowledgement of another week does not hide this one", async () => {
    const { client } = createFakeReadSupabase(tables({ events: { rows: [{ payload: { week: "2026-09-27" } }] } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toEqual({ week: "2026-10-04", isGoal: false });
  });

  it("a malformed payload (no week, a non-date week, a number, null, a bad row) acknowledges nothing", async () => {
    const rows = [{ payload: {} }, { payload: { week: "2026-02-30" } }, { payload: { week: 20261004 } }, { payload: null }, { payload: "2026-10-04" }, null, "x"];
    const { client } = createFakeReadSupabase(tables({ events: { rows } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toEqual({ week: "2026-10-04", isGoal: false });
  });

  it("a failed or thrown acknowledgements read is silence, not 'no acknowledgements yet'", async () => {
    for (const events of [FAILS, THROWS]) {
      const { client, queries } = createFakeReadSupabase(tables({ events }));
      expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
      expect(shape(queries)).toEqual([SERIES, "events:payload"]);
    }
  });
});

describe("loadMilestoneMoment: unknown is never a celebration", () => {
  it.each([
    ["a failed series", FAILS],
    ["a thrown series", THROWS],
  ])("%s: null", async (_name, weight_entries) => {
    const { client, queries } = createFakeReadSupabase(tables({ weight_entries }));
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
    expect(shape(queries)).toEqual([SERIES]);
  });

  it("a truncated history (exactly the limit back) is null, even with a landmark in the weeks that were read, and the acknowledgements are not read", async () => {
    // The two weeks that would confirm the 75 landmark are in the rows; the rest is older filler that fills the limit.
    const filler = Array.from({ length: WEIGHT_TREND.maxEntriesRead - 2 }, () => entry("2026-01-06", 79.0));
    const full = [...REACHED_75(), ...filler];
    expect(full).toHaveLength(WEIGHT_TREND.maxEntriesRead);
    const { client, queries } = createFakeReadSupabase(tables({ weight_entries: { rows: full } }));
    expect(await loadMilestoneMoment(context(client), NOW)).toBeNull();
    expect(shape(queries)).toEqual([SERIES]);
  });

  it("never throws, even on a malformed context", async () => {
    const broken = { kind: "ready", userId: USER } as unknown as OnboardingContext;
    expect(await loadMilestoneMoment(broken, NOW)).toBeNull();
    expect(await loadMilestoneMoment(context({} as SupabaseClient), NOW)).toBeNull();
  });
});

describe("loadProgress", () => {
  it.each(["not_configured", "signed_out", "unavailable", "profile_missing"] as const)("%s: unavailable and zero queries", async (kind) => {
    const { client, queries } = createFakeReadSupabase(tables());
    const ctx = { kind, supabase: client, userId: USER } as unknown as OnboardingContext;
    expect(await loadProgress(ctx, NOW)).toEqual({ kind: "unavailable" });
    expect(queries).toEqual([]);
  });

  it("builds the trend and the landmarks from the same weekly points", async () => {
    const { client } = createFakeReadSupabase(tables());
    const load = await loadProgress(context(client), NOW);
    expect(load.kind).toBe("ready");
    if (load.kind !== "ready") return;

    expect(load.weight.kind).toBe("ready");
    if (load.weight.kind !== "ready") return;
    const trend = load.weight.trend;
    expect(trend.state).toBe("LINE");
    expect(trend.baselineKg).toBe(80);
    expect(trend.points.map((p) => [p.weekStart, p.averageKg, p.complete])).toEqual([
      ["2026-09-27", 74.9, true],
      ["2026-10-04", 74.5, true],
    ]);
    expect(trend.sinceStart).toEqual({ kind: "LOWER", kg: 5.5 });

    expect(load.milestones.kind).toBe("LIST");
    if (load.milestones.kind !== "LIST") return;
    expect(load.milestones.steps.map((s) => [s.kg, s.state])).toEqual([
      [80, "REACHED"],
      [75, "REACHED"],
      [70, "NEXT"],
    ]);
    expect(load.milestones.goalReached).toBe(false);
    expect(load.noticed).toEqual({ patterns: [], activeExperiment: null });
  });

  it("reads the landmarks from ALL the weekly points, not the sliced chart", async () => {
    // 60 weekly points, the 75 landmark confirmed in the very first two: the chart keeps 52, the landmark stays reached.
    const rows: ReturnType<typeof entry>[] = [];
    const start = new Date("2025-08-03T08:00:00Z"); // a Sunday
    for (let w = 0; w < 60; w++) {
      const d = new Date(start.getTime() + w * 7 * 86_400_000);
      rows.push(entry(d.toISOString().slice(0, 10), w < 2 ? 74.5 : 79.0));
    }
    const { client } = createFakeReadSupabase(tables({ weight_entries: { rows: rows.reverse() } }));
    const load = await loadProgress(context(client), new Date("2026-10-14T06:00:00Z"));
    if (load.kind !== "ready" || load.weight.kind !== "ready" || load.milestones.kind !== "LIST") throw new Error("expected a ready load");
    expect(load.weight.trend.points).toHaveLength(WEIGHT_TREND.maxChartWeeks);
    expect(load.milestones.steps[1].state).toBe("REACHED");
  });

  it("a failed series: weight unknown and the landmarks UNKNOWN (a numeric goal) or NONE", async () => {
    const withGoal = createFakeReadSupabase(tables({ weight_entries: FAILS }));
    const a = await loadProgress(context(withGoal.client), NOW);
    expect(a).toMatchObject({ kind: "ready", weight: { kind: "unknown" }, milestones: { kind: "UNKNOWN" } });

    const noGoal = createFakeReadSupabase(tables({ weight_entries: THROWS }));
    const b = await loadProgress(context(noGoal.client, { goal_type: "none", goal_weight_kg: null }), NOW);
    expect(b).toMatchObject({ kind: "ready", weight: { kind: "unknown" }, milestones: { kind: "NONE" } });
  });

  it("a truncated history: the weight still shows, the landmarks are UNKNOWN", async () => {
    const full = Array.from({ length: WEIGHT_TREND.maxEntriesRead }, () => entry("2026-10-06", 74.5));
    const { client } = createFakeReadSupabase(tables({ weight_entries: { rows: full } }));
    const load = await loadProgress(context(client), NOW);
    expect(load).toMatchObject({ kind: "ready", weight: { kind: "ready" }, milestones: { kind: "UNKNOWN" } });
  });

  it("no numeric goal: no landmarks, whatever the weights say", async () => {
    const { client } = createFakeReadSupabase(tables());
    const load = await loadProgress(context(client, { goal_type: "none", goal_weight_kg: null }), NOW);
    expect(load).toMatchObject({ kind: "ready", weight: { kind: "ready" }, milestones: { kind: "NONE" } });
  });

  it("no weights yet: the start weight alone", async () => {
    const { client } = createFakeReadSupabase(tables({ weight_entries: EMPTY }));
    const load = await loadProgress(context(client), NOW);
    expect(load).toMatchObject({ kind: "ready", weight: { kind: "ready", trend: { state: "START_ONLY", baselineKg: 80 } } });
  });

  it("the weight series and what we noticed fail independently", async () => {
    const noticedDown = createFakeReadSupabase(tables({ patterns: FAILS, experiments: THROWS }));
    const a = await loadProgress(context(noticedDown.client), NOW);
    expect(a).toMatchObject({ kind: "ready", weight: { kind: "ready" }, noticed: { patterns: [], activeExperiment: null } });

    const weightDown = createFakeReadSupabase(tables({ weight_entries: FAILS }));
    const b = await loadProgress(context(weightDown.client), NOW);
    expect(b).toMatchObject({ kind: "ready", weight: { kind: "unknown" }, noticed: { patterns: [], activeExperiment: null } });
  });

  it("never reads the acknowledgements or writes anything", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    await loadProgress(context(client), NOW);
    expect(queries.map((q) => q.table)).not.toContain("events");
  });
});
