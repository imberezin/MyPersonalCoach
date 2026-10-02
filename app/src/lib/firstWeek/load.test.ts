import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_WEEK_LIMITS, NOT_SNOOZED } from "@/domain/firstWeekFlow";
import { normalizeRow } from "@/domain/onboarding";
import { createFakeReadSupabase, type FakeTable } from "@/lib/home/fakeReadSupabase";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadConfirmedMealTimes, loadFirstWeekProgress, loadFirstWeekSnooze, loadFirstWeekSummary } from "./load";

const USER = "00000000-0000-4000-8000-000000000001";
const ZONE = "Asia/Jerusalem"; // UTC+3 until 2026-10-25
const STARTED_AT = "2026-10-01T09:30:00Z"; // Thursday 12:30 local
const FIRST_DAY_START = "2026-09-30T21:00:00.000Z"; // 00:00 local on 1 October
const NOW = new Date("2026-10-07T08:00:00Z"); // Wednesday 11:00 local: five available days have ended (Saturday is mostly offline)
const GOAL_WEIGHT = 71.37;

const EMPTY: FakeTable = { rows: [] };
const FAILS: FakeTable = { error: { code: "42501" } };
const THROWS: FakeTable = "throw";

/** Local Jerusalem `hh:mm` on October `day`, as a UTC instant. */
const at = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, day, hh - 3, mm)).toISOString();
const mealRow = (id: string, when: string) => ({ id, confirmed_at: when, occurred_at: when });

const SHABBAT = { type: "SHABBAT", start_at: "2026-10-02T14:20:00Z", end_at: "2026-10-03T15:20:00Z" };

/** Ten daytime meals on 1 to 6 October, none of them late. */
const DAYTIME_TEN = [1, 1, 2, 2, 4, 4, 5, 5, 6, 6].map((day, i) => mealRow(`d${i}`, at(day, 12 + (i % 2))));
/** The same ten, but three of them at 21:30 on three different evenings: a Candidate. */
const WITH_THREE_LATE = [...DAYTIME_TEN.slice(0, 7), mealRow("l1", at(4, 21, 30)), mealRow("l2", at(5, 21, 30)), mealRow("l3", at(6, 21, 30))];

const profileTable: FakeTable = { rows: [{ first_week_started_at: STARTED_AT }] };

/** Every table the First Week loaders read, answering the happy path unless overridden. */
const tables = (over: Record<string, FakeTable> = {}): Record<string, FakeTable> => ({
  profiles: profileTable,
  meal_entries: { rows: WITH_THREE_LATE },
  offline_periods: { rows: [SHABBAT] },
  patterns: EMPTY,
  experiments: EMPTY,
  events: EMPTY,
  ...over,
});

function context(supabase: SupabaseClient, row: Record<string, unknown> = {}, lifecycle = "FIRST_WEEK"): OnboardingContext {
  const normalized = normalizeRow(
    {
      lifecycle_state: lifecycle,
      timezone: ZONE,
      goal_focus: ["improve_eating", "understand_overeating"],
      goal_type: "numeric",
      goal_weight_kg: GOAL_WEIGHT,
      motivation: "I want to feel at home in my body",
      ...row,
    },
    null,
  );
  if (!normalized) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row: normalized, supabase };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadFirstWeekProgress: the recorded queries (3.4)", () => {
  it("reads the start date, the newest ten meals and the periods since the START of the first local day", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    await loadFirstWeekProgress(client, USER, ZONE, NOW);

    expect(queries).toEqual([
      { table: "profiles", columns: "first_week_started_at", filters: [["eq", "user_id", USER]], limit: 1 },
      {
        table: "meal_entries",
        columns: "confirmed_at",
        filters: [["eq", "user_id", USER]],
        order: { column: "confirmed_at", ascending: false },
        limit: 10,
      },
      {
        table: "offline_periods",
        columns: "type, start_at, end_at",
        filters: [
          ["eq", "user_id", USER],
          ["gt", "end_at", FIRST_DAY_START],
          ["lte", "start_at", NOW.toISOString()],
        ],
        order: { column: "start_at", ascending: true },
        limit: 120,
      },
    ]);
  });

  it("the lower bound is the start of the first day, not the instant onboarding finished", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    await loadFirstWeekProgress(client, USER, ZONE, NOW);
    const bound = queries[2].filters.find(([op, column]) => op === "gt" && column === "end_at")?.[2];
    expect(bound).toBe(FIRST_DAY_START);
    expect(bound).not.toBe(new Date(STARTED_AT).toISOString());
  });

  it("makes the periods query only after the start date is known", async () => {
    const { client, queries } = createFakeReadSupabase(tables({ profiles: EMPTY }));
    expect(await loadFirstWeekProgress(client, USER, ZONE, NOW)).toBeNull();
    expect(queries.map((q) => q.table)).toEqual(["profiles", "meal_entries"]);
  });
});

describe("loadFirstWeekProgress: counts", () => {
  it("counts the available days that ended and the confirmed meals", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: { rows: DAYTIME_TEN } }));
    expect(await loadFirstWeekProgress(client, USER, ZONE, NOW)).toEqual({ availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 });
  });

  it("empty tables are zeros, and no meal is null since-last", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: EMPTY, offline_periods: EMPTY }));
    expect(await loadFirstWeekProgress(client, USER, ZONE, NOW)).toEqual({ availableDays: 6, confirmedMeals: 0, availableDaysSinceLastMeal: null });
  });

  it("an offline period that ended on the morning of the first day still counts against that day", async () => {
    // Started 14:00 local; offline from 21:00 the evening before until 13:00: thirteen of that day's 24 hours.
    const morning = { type: "USER_DEFINED", start_at: "2026-09-30T18:00:00Z", end_at: "2026-10-01T10:00:00Z" };
    const started = { rows: [{ first_week_started_at: "2026-10-01T11:00:00Z" }] };
    const now = new Date("2026-10-02T21:00:00Z"); // 00:00 local on the 3rd: the 1st and the 2nd have ended
    const without = await loadFirstWeekProgress(createFakeReadSupabase(tables({ profiles: started, offline_periods: EMPTY })).client, USER, ZONE, now);
    const withMorning = await loadFirstWeekProgress(createFakeReadSupabase(tables({ profiles: started, offline_periods: { rows: [morning] } })).client, USER, ZONE, now);
    expect(without?.availableDays).toBe(2);
    expect(withMorning?.availableDays).toBe(1);
  });

  it("stops counting at the end of the first week (a card nobody pressed is not counted day by day forever)", async () => {
    const { client } = createFakeReadSupabase(tables({ offline_periods: EMPTY }));
    expect((await loadFirstWeekProgress(client, USER, ZONE, new Date("2027-03-01T10:00:00Z")))?.availableDays).toBe(15);
  });

  it("drops a meal row it cannot read instead of guessing", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: { rows: [{ confirmed_at: at(1, 12) }, { confirmed_at: "later" }, null, "x"] } }));
    expect((await loadFirstWeekProgress(client, USER, ZONE, NOW))?.confirmedMeals).toBe(1);
  });

  it("a garbage zone falls back to the app's zone", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: EMPTY }));
    expect(await loadFirstWeekProgress(client, USER, "Not/AZone", NOW)).toEqual(
      await loadFirstWeekProgress(createFakeReadSupabase(tables({ meal_entries: EMPTY })).client, USER, ZONE, NOW),
    );
  });
});

describe("loadFirstWeekProgress: anything unknown is null, and it never throws", () => {
  it.each<[string, Record<string, FakeTable>]>([
    ["the profile read failing", { profiles: FAILS }],
    ["the profile read throwing", { profiles: THROWS }],
    ["no profile row", { profiles: EMPTY }],
    ["a null start date", { profiles: { rows: [{ first_week_started_at: null }] } }],
    ["an invalid start date", { profiles: { rows: [{ first_week_started_at: "yesterday" }] } }],
    ["the meals read failing", { meal_entries: FAILS }],
    ["the meals read throwing", { meal_entries: THROWS }],
    ["the periods read failing", { offline_periods: FAILS }],
    ["the periods read throwing", { offline_periods: THROWS }],
  ])("%s", async (_name, over) => {
    const { client } = createFakeReadSupabase(tables({ ...over }));
    expect(await loadFirstWeekProgress(client, USER, ZONE, NOW)).toBeNull();
  });

  it("exactly 120 period rows back is truncated, so unknown; 119 is fine", async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "SHABBAT", start_at: new Date(Date.UTC(2026, 9, 2) + i * 60_000).toISOString(), end_at: new Date(Date.UTC(2026, 9, 2) + i * 60_000 + 1000).toISOString() }));
    expect(await loadFirstWeekProgress(createFakeReadSupabase(tables({ offline_periods: { rows: rows(120) } })).client, USER, ZONE, NOW)).toBeNull();
    expect(await loadFirstWeekProgress(createFakeReadSupabase(tables({ offline_periods: { rows: rows(119) } })).client, USER, ZONE, NOW)).not.toBeNull();
  });

  it("an invalid now, and a client that throws", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    expect(await loadFirstWeekProgress(client, USER, ZONE, new Date("nope"))).toBeNull();
    expect(queries).toEqual([]);
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    expect(await loadFirstWeekProgress(broken, USER, ZONE, NOW)).toBeNull();
  });
});

describe("loadFirstWeekSnooze", () => {
  const event = (card: unknown, occurred_at: string) => ({ payload: card === undefined ? {} : { card }, occurred_at });

  it("asks for the snooze events of the last 24 hours, newest first, at most 10", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    await loadFirstWeekSnooze(client, USER, NOW);
    expect(queries).toEqual([
      {
        table: "events",
        columns: "payload, occurred_at",
        filters: [
          ["eq", "user_id", USER],
          ["eq", "name", "first_week_card_snoozed"],
          ["gt", "occurred_at", new Date(NOW.getTime() - 24 * 3_600_000).toISOString()],
        ],
        order: { column: "occurred_at", ascending: false },
        limit: 10,
      },
    ]);
  });

  it("maps the card of each event through the pure rule", async () => {
    const recent = new Date(NOW.getTime() - 3_600_000).toISOString();
    const read = async (rows: unknown[]) => loadFirstWeekSnooze(createFakeReadSupabase(tables({ events: { rows } })).client, USER, NOW);
    expect(await read([event("summary", recent)])).toEqual({ summary: true, welcomeBack: false });
    expect(await read([event("welcome_back", recent)])).toEqual({ summary: false, welcomeBack: true });
    expect(await read([event("summary", recent), event("welcome_back", recent)])).toEqual({ summary: true, welcomeBack: true });
    expect(await read([])).toEqual(NOT_SNOOZED);
  });

  it("an event in the future, an unknown card, a missing card and an unreadable time are ignored", async () => {
    const recent = new Date(NOW.getTime() - 3_600_000).toISOString();
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    const rows = [event("summary", future), event("bedtime", recent), event(undefined, recent), event("welcome_back", "later"), { payload: null, occurred_at: recent }, null, "x"];
    expect(await loadFirstWeekSnooze(createFakeReadSupabase(tables({ events: { rows } })).client, USER, NOW)).toEqual(NOT_SNOOZED);
  });

  it.each([
    ["an error", FAILS],
    ["a throw", THROWS],
  ])("%s is NOT_SNOOZED (a card coming back is calm; a card hidden by a failed read would be invisible)", async (_name, events) => {
    expect(await loadFirstWeekSnooze(createFakeReadSupabase(tables({ events })).client, USER, NOW)).toEqual(NOT_SNOOZED);
  });

  it("an invalid now is NOT_SNOOZED and never throws", async () => {
    expect(await loadFirstWeekSnooze(createFakeReadSupabase(tables()).client, USER, new Date("nope"))).toEqual(NOT_SNOOZED);
  });

  it("returns a fresh object, never the shared constant", async () => {
    const result = await loadFirstWeekSnooze(createFakeReadSupabase(tables()).client, USER, NOW);
    expect(result).not.toBe(NOT_SNOOZED);
  });
});

describe("loadConfirmedMealTimes", () => {
  it("asks for the earliest 100 confirmed_at values of the person", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    await loadConfirmedMealTimes(client, USER);
    expect(queries).toEqual([
      {
        table: "meal_entries",
        columns: "confirmed_at",
        filters: [["eq", "user_id", USER]],
        order: { column: "confirmed_at", ascending: true },
        limit: 100,
      },
    ]);
  });

  it("maps rows to dates and drops the ones it cannot read", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: { rows: [{ confirmed_at: at(1, 12) }, { confirmed_at: "x" }, { confirmed_at: null }, null, { confirmed_at: at(2, 9) }] } }));
    expect(await loadConfirmedMealTimes(client, USER)).toEqual([new Date(at(1, 12)), new Date(at(2, 9))]);
  });

  it("no meals is an empty list, not null", async () => {
    expect(await loadConfirmedMealTimes(createFakeReadSupabase(tables({ meal_entries: EMPTY })).client, USER)).toEqual([]);
  });

  it("an error and a throw are unknown", async () => {
    expect(await loadConfirmedMealTimes(createFakeReadSupabase(tables({ meal_entries: FAILS })).client, USER)).toBeNull();
    expect(await loadConfirmedMealTimes(createFakeReadSupabase(tables({ meal_entries: THROWS })).client, USER)).toBeNull();
  });
});

describe("loadFirstWeekSummary: when there is nothing to load", () => {
  it.each(["not_configured", "signed_out", "unavailable", "profile_missing"] as const)("%s: not_first_week with ZERO queries", async (kind) => {
    const { client, queries } = createFakeReadSupabase(tables());
    const ctx = { kind, supabase: client, userId: USER } as unknown as OnboardingContext;
    expect(await loadFirstWeekSummary(ctx, NOW)).toEqual({ kind: "not_first_week" });
    expect(queries).toEqual([]);
  });

  it.each(["NEW", "ONBOARDING", "WEEKLY_CYCLE"])("lifecycle %s: not_first_week with ZERO queries", async (lifecycle) => {
    const { client, queries } = createFakeReadSupabase(tables());
    expect(await loadFirstWeekSummary(context(client, {}, lifecycle), NOW)).toEqual({ kind: "not_first_week" });
    expect(queries).toEqual([]);
  });

  it("the rules say not yet: not_ready, and the 500-meal read is NOT issued (nor any Phase 2 read)", async () => {
    const { client, queries } = createFakeReadSupabase(tables({ meal_entries: { rows: DAYTIME_TEN.slice(0, 4) } }));
    expect(await loadFirstWeekSummary(context(client), NOW)).toEqual({ kind: "not_ready" });
    expect(queries.map((q) => q.table)).toEqual(["profiles", "meal_entries", "offline_periods"]);
    expect(queries.some((q) => q.limit === 500)).toBe(false);
  });

  it("a failed progress read is unavailable", async () => {
    for (const profiles of [FAILS, THROWS, EMPTY]) {
      const { client } = createFakeReadSupabase(tables({ profiles }));
      expect(await loadFirstWeekSummary(context(client), NOW)).toEqual({ kind: "unavailable" });
    }
  });

  it("a failed read of the 500 meal times is unavailable (the page cannot be true without them)", async () => {
    const happy = createFakeReadSupabase(tables({ meal_entries: { rows: DAYTIME_TEN } })).client;
    const failing = createFakeReadSupabase({ meal_entries: FAILS }).client;
    let mealReads = 0;
    // The progress read is the first meal_entries read; the summary's is the second.
    const sabotaged = { from: (table: string) => (table === "meal_entries" && ++mealReads === 2 ? failing.from(table) : happy.from(table)) } as unknown as SupabaseClient;
    expect(await loadFirstWeekSummary(context(sabotaged), NOW)).toEqual({ kind: "unavailable" });
  });
});

describe("loadFirstWeekSummary: ready", () => {
  it("builds the summary from the live data, with the recorded query list of the whole page", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client), NOW);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.reason).toBe("enough_data");
    expect(result.hadEnoughData).toBe(true);
    expect(result.progress).toEqual({ availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 });
    expect(result.summary.tone).toBe("ENOUGH");
    expect(result.summary.did).toEqual([{ kind: "MEALS" }]);

    expect(queries.map((q) => `${q.table}:${q.columns}:${q.limit}`)).toEqual([
      "profiles:first_week_started_at:1",
      "meal_entries:confirmed_at:10",
      "offline_periods:type, start_at, end_at:120",
      "meal_entries:confirmed_at:500",
      "meal_entries:id, occurred_at:400",
      "patterns:id, status, user_feedback, user_feedback_at:1",
      `experiments:${"id, status, source_pattern_id, intervention_key, variant, wording, wording_source, wording_locale, ended_at"}:20`,
    ]);
    // The summary query reads confirmed_at only and in ascending order.
    expect(queries[3]).toMatchObject({ order: { column: "confirmed_at", ascending: true } });
  });

  it("the max-days reason is reported with the neutral data flag", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: EMPTY, offline_periods: EMPTY }));
    const result = await loadFirstWeekSummary(context(client), new Date("2026-10-20T10:00:00Z"));
    expect(result).toMatchObject({ kind: "ready", reason: "max_days_reached", hadEnoughData: false });
    if (result.kind === "ready") expect(result.summary.tone).toBe("NO_MEALS");
  });

  it("the 'Why we started' part comes from the context's row with NO extra query, and the weight target appears nowhere", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");

    expect(result.summary.why).toEqual({
      kind: "SOME",
      focus: ["improve_eating", "understand_overeating"],
      notSure: false,
      motivation: "I want to feel at home in my body",
    });
    expect(queries.map((q) => q.table)).not.toContain("profiles_goals");
    expect(queries.filter((q) => q.table === "profiles")).toHaveLength(1);
    const json = JSON.stringify(result);
    expect(json).not.toContain(String(GOAL_WEIGHT));
    expect(json).not.toContain("goal_weight");
  });

  it("'not sure' is a valid answer: shown as such, with no goal list", async () => {
    const { client } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client, { goal_focus: ["not_sure"], motivation: null }), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.why).toEqual({ kind: "SOME", focus: [], notSure: true, motivation: null });
  });

  it("a long motivation arrives shortened at a word boundary; the stored value is not touched", async () => {
    const stored = "I want to feel at home in my body and in my kitchen. ".repeat(20).trim();
    const { client } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client, { motivation: stored }), NOW);
    if (result.kind !== "ready" || result.summary.why.kind !== "SOME") throw new Error("expected a ready summary with a reason");
    const shown = result.summary.why.motivation as string;
    expect(shown.endsWith("…")).toBe(true);
    expect(Array.from(shown).length).toBeLessThanOrEqual(FIRST_WEEK_LIMITS.motivationChars);
    expect(stored.startsWith(shown.slice(0, -1))).toBe(true);
  });

  it("a numeric goal alone is an answer (an empty SOME), and the target never reaches the result, whatever the goals", async () => {
    const { client } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client, { goal_focus: [], motivation: null }), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.why).toEqual({ kind: "SOME", focus: [], notSure: false, motivation: null });
    const json = JSON.stringify(result);
    expect(json).not.toContain(String(GOAL_WEIGHT));
    expect(json).not.toContain("numeric");
  });

  it("a behavioral goal (no target) with nothing else said is NONE", async () => {
    const { client } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(
      context(client, { goal_focus: [], motivation: null, goal_type: "behavioral", goal_weight_kg: null }),
      NOW,
    );
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.why).toEqual({ kind: "NONE" });
  });

  it("a failed read the page depends on makes the whole page unavailable, so the part is absent with it and nothing is invented", async () => {
    const { client } = createFakeReadSupabase(tables({ profiles: FAILS }));
    expect(await loadFirstWeekSummary(context(client), NOW)).toEqual({ kind: "unavailable" });
  });

  it("never logs the person's words or goals, even when reads fail", async () => {
    const spies = (["error", "warn", "log", "info"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const failing = createFakeReadSupabase(tables({ meal_entries: FAILS, experiments: FAILS }));
    await loadFirstWeekSummary(context(failing.client), NOW);
    await loadFirstWeekSummary(context(failing.client, { motivation: "SECRET-WORDS" }), NOW);
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain("SECRET-WORDS");
    expect(logged).not.toContain("improve_eating");
    expect(logged).not.toContain(String(GOAL_WEIGHT));
  });

  it("no goals, no motivation and no numeric goal: NONE", async () => {
    const { client } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client, { goal_focus: [], motivation: null, goal_type: "none", goal_weight_kg: null }), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.why).toEqual({ kind: "NONE" });
  });

  it("three late evenings: the observation, a Candidate signal and an OFFER", async () => {
    const { client } = createFakeReadSupabase(tables());
    const result = await loadFirstWeekSummary(context(client), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");

    expect(result.signal?.view).toBe("CANDIDATE");
    expect(result.summary.noticed).toEqual({ kind: "OBSERVATIONS", items: [{ kind: "LATE_EVENING_MEALS" }] });
    expect(result.experiment.selection).toMatchObject({ kind: "OFFER", key: "eat_intentionally", variantId: "default", scope: "next_meal" });
    expect(result.summary.next).toEqual({ kind: "OFFER" });
    expect(result.experiment.open).toBeNull();
  });

  it("no late evening: too early to say, and no experiment", async () => {
    const { client } = createFakeReadSupabase(tables({ meal_entries: { rows: DAYTIME_TEN } }));
    const result = await loadFirstWeekSummary(context(client), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.noticed).toEqual({ kind: "NOT_ENOUGH_YET" });
    expect(result.experiment.selection).toMatchObject({ kind: "NONE", reason: "no_pattern" });
    expect(result.summary.next).toEqual({ kind: "NO_EXPERIMENT" });
  });

  it("an OFFERED experiment whose pattern is still established is PENDING, with its stored text", async () => {
    const experimentRow = {
      id: "e1",
      status: "OFFERED",
      source_pattern_id: "p1",
      intervention_key: "eat_intentionally",
      variant: "default",
      wording: "sit down for a few minutes",
      wording_source: "library",
      wording_locale: "en",
      ended_at: null,
    };
    const { client } = createFakeReadSupabase(
      tables({
        experiments: { rows: [experimentRow] },
        patterns: { rows: [{ id: "p1", status: "CANDIDATE", user_feedback: null, user_feedback_at: null }] },
      }),
    );
    const result = await loadFirstWeekSummary(context(client), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.experiment.selection).toEqual({ kind: "PENDING", experimentId: "e1" });
    expect(result.experiment.open).toMatchObject({ id: "e1", status: "OFFERED", wording: "sit down for a few minutes" });
    expect(result.summary.next).toEqual({ kind: "PENDING" });
  });

  it("an ACTIVE experiment is shown whatever the meals say", async () => {
    const active = { id: "e2", status: "ACTIVE", source_pattern_id: null, intervention_key: "eat_intentionally", variant: "default", wording: "x", wording_source: "library", wording_locale: "he", ended_at: null };
    const { client } = createFakeReadSupabase(tables({ meal_entries: { rows: DAYTIME_TEN }, experiments: { rows: [active] } }));
    const result = await loadFirstWeekSummary(context(client), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.next).toEqual({ kind: "ACTIVE" });
    expect(result.summary.did).toEqual([{ kind: "MEALS" }, { kind: "EXPERIMENT" }]);
  });

  it("the person's 'not related' means no mention and no offer", async () => {
    const rejected = { id: "p1", status: "REJECTED", user_feedback: "reject", user_feedback_at: "2026-10-05T10:00:00Z" };
    const { client } = createFakeReadSupabase(tables({ patterns: { rows: [rejected] } }));
    const result = await loadFirstWeekSummary(context(client), NOW);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.summary.noticed).toEqual({ kind: "NOT_ENOUGH_YET" });
    expect(result.experiment.selection).toMatchObject({ kind: "NONE", reason: "pattern_rejected" });
  });

  it("an unknown signal is a page without an observation or an offer, not an unavailable page", async () => {
    const { client } = createFakeReadSupabase(tables({ patterns: FAILS }));
    const result = await loadFirstWeekSummary(context(client), NOW);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.signal).toBeNull();
    expect(result.summary.noticed).toEqual({ kind: "NOT_ENOUGH_YET" });
    expect(result.experiment.selection).toMatchObject({ kind: "NONE", reason: "no_pattern" });
  });

  it("unknown experiments: the selection is NONE no_pattern (an open or skipped one may exist) and the page still renders", async () => {
    for (const experiments of [FAILS, THROWS]) {
      const { client } = createFakeReadSupabase(tables({ experiments }));
      const result = await loadFirstWeekSummary(context(client), NOW);
      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") continue;
      expect(result.signal?.view).toBe("CANDIDATE");
      expect(result.experiment).toEqual({ selection: { kind: "NONE", reason: "no_pattern" }, open: null });
      expect(result.summary.next).toEqual({ kind: "NO_EXPERIMENT" });
    }
  });

  it("never reads the snoozes", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    await loadFirstWeekSummary(context(client), NOW);
    expect(queries.map((q) => q.table)).not.toContain("events");
  });

  it("never throws, even for a malformed context", async () => {
    const { client } = createFakeReadSupabase(tables());
    const malformed = { kind: "ready", userId: USER, supabase: client } as unknown as OnboardingContext; // no row
    await expect(loadFirstWeekSummary(malformed, NOW)).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("the module's rules", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), "src", "lib", "firstWeek", file), "utf8");

  it("does not import the AI layer or the admin client, and writes nothing", () => {
    const text = read("load.ts");
    expect(text).not.toMatch(/lib\/ai|supabase\/admin|createAdminClient/);
    expect(text).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});
