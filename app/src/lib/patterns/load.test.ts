import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeReadSupabase, type FakeTable } from "@/lib/home/fakeReadSupabase";
import { loadLateEveningSignal, loadQuietHours } from "./load";

// The switch is read at call time, so one mutable stand-in serves every case (mutation checks flip it too).
const flow = vi.hoisted(() => ({ detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true }));
vi.mock("@/domain/patterns/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/patterns/types")>()),
  PATTERN_FLOW: flow,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const ZONE = "Asia/Jerusalem"; // UTC+3 in early October 2026
const AS_OF = new Date("2026-10-09T10:00:00Z");
const DAY_MS = 86_400_000;

const EMPTY: FakeTable = { rows: [] };

/** A meal at `hh:mm` local on October `day` 2026 (Israel is UTC+3 then). */
const meal = (id: string, day: number, hh: number, mm = 0) => ({
  id,
  occurred_at: new Date(Date.UTC(2026, 9, day, hh - 3, mm)).toISOString(),
});

const EVENINGS = [meal("m1", 5, 21, 30), meal("m2", 6, 22, 10), meal("m3", 7, 21, 5)];

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  status: "OBSERVATION",
  user_feedback: null,
  user_feedback_at: null,
  ...over,
});

beforeEach(() => {
  flow.detectionEnabled = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadLateEveningSignal: the recorded queries", () => {
  it("asks for the unaggregated stamps of the last 30 days up to now (newest first, at most 400) and for the person's row", async () => {
    const { client, queries } = createFakeReadSupabase({ meal_entries: EMPTY, patterns: EMPTY });
    await loadLateEveningSignal(client, USER, ZONE, AS_OF);

    expect(queries).toHaveLength(2);
    expect(queries.find((q) => q.table === "meal_entries")).toEqual({
      table: "meal_entries",
      columns: "id, occurred_at",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "aggregated", false],
        ["gte", "occurred_at", new Date(AS_OF.getTime() - 30 * DAY_MS).toISOString()],
        ["lte", "occurred_at", AS_OF.toISOString()],
      ],
      order: { column: "occurred_at", ascending: false },
      limit: 400,
    });
    expect(queries.find((q) => q.table === "patterns")).toEqual({
      table: "patterns",
      columns: "id, status, user_feedback, user_feedback_at",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "kind", "late_evening_meals"],
      ],
      limit: 1,
    });
  });

  it("makes no query at all when detection is switched off", async () => {
    flow.detectionEnabled = false;
    const { client, queries } = createFakeReadSupabase({ meal_entries: EMPTY, patterns: EMPTY });
    expect(await loadLateEveningSignal(client, USER, ZONE, AS_OF)).toBeNull();
    expect(queries).toEqual([]);
  });
});

describe("loadLateEveningSignal: the live level", () => {
  it("no meals and no row: nothing", async () => {
    const { client } = createFakeReadSupabase({ meal_entries: EMPTY, patterns: EMPTY });
    expect(await loadLateEveningSignal(client, USER, ZONE, AS_OF)).toEqual({ occurrences: [], row: null, view: "NONE" });
  });

  it.each([
    [1, "NONE"],
    [2, "EARLY_SIGNAL"],
    [3, "CANDIDATE"],
  ] as const)("%d late evenings read %s", async (count, view) => {
    const { client } = createFakeReadSupabase({ meal_entries: { rows: EVENINGS.slice(0, count) }, patterns: EMPTY });
    const signal = await loadLateEveningSignal(client, USER, ZONE, AS_OF);
    expect(signal?.view).toBe(view);
    expect(signal?.occurrences).toHaveLength(count);
  });

  it("a meal before 21:00 or after midnight is not an occurrence", async () => {
    const { client } = createFakeReadSupabase({
      meal_entries: { rows: [meal("a", 5, 20, 59), meal("b", 6, 0, 30), meal("c", 7, 14)] },
      patterns: EMPTY,
    });
    expect((await loadLateEveningSignal(client, USER, ZONE, AS_OF))?.occurrences).toEqual([]);
  });

  it("the level follows the real thresholds, not the stored status: CANDIDATE on the row with one evening reads NONE", async () => {
    const { client } = createFakeReadSupabase({
      meal_entries: { rows: EVENINGS.slice(0, 1) },
      patterns: { rows: [row({ status: "CANDIDATE" })] },
    });
    const signal = await loadLateEveningSignal(client, USER, ZONE, AS_OF);
    expect(signal?.view).toBe("NONE");
    expect(signal?.row?.status).toBe("CANDIDATE");
  });

  it("carries the person's own answer from the row", async () => {
    const answeredAt = "2026-10-08T09:00:00+00:00";
    const { client } = createFakeReadSupabase({
      meal_entries: { rows: EVENINGS.slice(0, 2) },
      patterns: { rows: [row({ user_feedback: "unsure", user_feedback_at: answeredAt })] },
    });
    const signal = await loadLateEveningSignal(client, USER, ZONE, AS_OF);
    expect(signal?.row).toEqual({ id: "p1", status: "OBSERVATION", feedback: "unsure", feedbackAt: new Date(answeredAt) });
    expect(signal?.view).toBe("EARLY_SIGNAL");
  });

  it("the person's 'not related' wins over any number of evenings", async () => {
    const { client } = createFakeReadSupabase({
      meal_entries: { rows: EVENINGS },
      patterns: { rows: [row({ status: "REJECTED", user_feedback: "reject", user_feedback_at: "2026-10-08T09:00:00Z" })] },
    });
    expect((await loadLateEveningSignal(client, USER, ZONE, AS_OF))?.view).toBe("REJECTED");
  });

  it("a meal after the as-of instant is not evidence yet (the read cuts at now, the detector cuts again)", async () => {
    const { client } = createFakeReadSupabase({ meal_entries: { rows: [...EVENINGS.slice(0, 2), meal("future", 12, 21, 30)] }, patterns: EMPTY });
    expect((await loadLateEveningSignal(client, USER, ZONE, AS_OF))?.view).toBe("EARLY_SIGNAL");
  });

  it("uses the profile's zone for the wall clock (a garbage zone falls back to Jerusalem)", async () => {
    const { client } = createFakeReadSupabase({ meal_entries: { rows: EVENINGS.slice(0, 2) }, patterns: EMPTY });
    expect((await loadLateEveningSignal(client, USER, "Not/AZone", AS_OF))?.view).toBe("EARLY_SIGNAL");
    expect((await loadLateEveningSignal(client, USER, "UTC", AS_OF))?.view).toBe("NONE"); // 18:30 UTC is not late
  });

  it("drops a malformed meal row instead of guessing", async () => {
    const { client } = createFakeReadSupabase({
      meal_entries: {
        rows: [
          EVENINGS[0],
          { id: "x", occurred_at: "not a date" },
          { id: 5, occurred_at: EVENINGS[1].occurred_at },
          { id: "", occurred_at: EVENINGS[1].occurred_at },
          { occurred_at: EVENINGS[1].occurred_at },
          null,
          "m",
          EVENINGS[1],
        ],
      },
      patterns: EMPTY,
    });
    expect((await loadLateEveningSignal(client, USER, ZONE, AS_OF))?.occurrences.map((o) => o.mealId)).toEqual(["m1", "m2"]);
  });
});

describe("loadLateEveningSignal: unknown is null, never a guess", () => {
  it("exactly 400 rows back means the read was truncated", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, occurred_at: EVENINGS[0].occurred_at }));
    const { client } = createFakeReadSupabase({ meal_entries: { rows }, patterns: EMPTY });
    expect(await loadLateEveningSignal(client, USER, ZONE, AS_OF)).toBeNull();
  });

  it("399 rows back is complete", async () => {
    const rows = Array.from({ length: 399 }, (_, i) => ({ id: `m${i}`, occurred_at: EVENINGS[0].occurred_at }));
    const { client } = createFakeReadSupabase({ meal_entries: { rows }, patterns: EMPTY });
    expect(await loadLateEveningSignal(client, USER, ZONE, AS_OF)).not.toBeNull();
  });

  it.each([
    ["the meals read failing", { meal_entries: { error: { code: "42501" } }, patterns: EMPTY }],
    ["the meals read throwing", { meal_entries: "throw", patterns: EMPTY }],
    ["the pattern read failing", { meal_entries: EMPTY, patterns: { error: { code: "42501" } } }],
    ["the pattern read throwing", { meal_entries: EMPTY, patterns: "throw" }],
  ] as const)("%s", async (_name, tables) => {
    const { client } = createFakeReadSupabase({ ...tables });
    expect(await loadLateEveningSignal(client, USER, ZONE, AS_OF)).toBeNull();
  });

  it.each([
    ["an unknown status", row({ status: "RUNNING" })],
    ["an unknown answer", row({ user_feedback: "maybe" })],
    ["an answer time that cannot be read", row({ user_feedback: "unsure", user_feedback_at: "later" })],
    ["no id", row({ id: null })],
    ["a non-object row", "row"],
  ])("a pattern row with %s: the person's own answer cannot be guessed", async (_name, bad) => {
    const { client } = createFakeReadSupabase({ meal_entries: { rows: EVENINGS }, patterns: { rows: [bad] } });
    expect(await loadLateEveningSignal(client, USER, ZONE, AS_OF)).toBeNull();
  });

  it("an instant that cannot be turned into a window, and a client that throws", async () => {
    const { client, queries } = createFakeReadSupabase({ meal_entries: EMPTY, patterns: EMPTY });
    expect(await loadLateEveningSignal(client, USER, ZONE, new Date("nope"))).toBeNull();
    expect(queries).toEqual([]);
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    expect(await loadLateEveningSignal(broken, USER, ZONE, AS_OF)).toBeNull();
  });
});

describe("loadQuietHours", () => {
  const prefs = (rows: unknown[]) => createFakeReadSupabase({ user_preferences: { rows } });

  it("reads the two time columns of the person's preferences", async () => {
    const { client, queries } = prefs([{ quiet_hours_start: "00:00:00", quiet_hours_end: "08:00:00" }]);
    await loadQuietHours(client, USER);
    expect(queries).toEqual([
      {
        table: "user_preferences",
        columns: "quiet_hours_start, quiet_hours_end",
        filters: [["eq", "user_id", USER]],
        limit: 1,
      },
    ]);
  });

  it("a window", async () => {
    expect(await loadQuietHours(prefs([{ quiet_hours_start: "00:00:00", quiet_hours_end: "08:00:00" }]).client, USER)).toEqual({
      kind: "WINDOW",
      startMinute: 0,
      endMinute: 480,
    });
  });

  it("both null means the person turned quiet hours off", async () => {
    expect(await loadQuietHours(prefs([{ quiet_hours_start: null, quiet_hours_end: null }]).client, USER)).toEqual({ kind: "NONE" });
  });

  it.each([
    ["only the start", { quiet_hours_start: "22:00:00", quiet_hours_end: null }],
    ["only the end", { quiet_hours_start: null, quiet_hours_end: "07:00:00" }],
    ["garbage", { quiet_hours_start: "late", quiet_hours_end: "early" }],
    ["no columns", {}],
    ["a non-object row", "row"],
  ])("%s is unknown", async (_name, bad) => {
    expect(await loadQuietHours(prefs([bad]).client, USER)).toBeNull();
  });

  it("no preferences row, an error and a throw are unknown", async () => {
    expect(await loadQuietHours(prefs([]).client, USER)).toBeNull();
    expect(await loadQuietHours(createFakeReadSupabase({ user_preferences: { error: { code: "42501" } } }).client, USER)).toBeNull();
    expect(await loadQuietHours(createFakeReadSupabase({ user_preferences: "throw" }).client, USER)).toBeNull();
  });
});
