import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeReadSupabase, type FakeTable, type RecordedQuery } from "@/lib/home/fakeReadSupabase";
import { loadWeeklyHomeFact } from "./home";

// The switch is read at call time, so one mutable stand-in serves every case.
const flow = vi.hoisted(() => ({ enabled: true, patternQuestionEnabled: true, starterExperimentsEnabled: false, aiLineEnabled: true, weightLineEnabled: true }));
vi.mock("@/domain/weekly/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/weekly/types")>()),
  WEEKLY_FLOW: flow,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const TZ = "Asia/Jerusalem";

// January 2027, Jerusalem is UTC+2. The week 2027-01-03 (Sunday) .. 2027-01-09 (Saturday) is the one the card is about.
const SUNDAY_9 = new Date("2027-01-10T09:00:00Z"); // Sunday 11:00 local
const WEEK_START = "2027-01-03";
const WEEK_END_UTC = "2027-01-09T22:00:00.000Z";
const PERIODS_FROM = "2026-12-05T22:00:00.000Z"; // week.start minus 28 days
const SINCE = "2027-01-09T09:00:00.000Z"; // now minus 24 hours

const EMPTY: FakeTable = { rows: [] };
const ONE_ROW: FakeTable = { rows: [{ id: "row-1" }] };
const FAILS: FakeTable = { error: { code: "42501" } };
const THROWS: FakeTable = "throw";

// The transition (the "Let's continue" press) was well before the week, so its window is the whole week.
const LONG_AGO = { rows: [{ first_week_ended_at: "2026-12-20T10:00:00Z" }] };

const tables = (over: Record<string, FakeTable> = {}): Record<string, FakeTable> => ({
  profiles: LONG_AGO,
  offline_periods: EMPTY,
  weekly_summaries: EMPTY,
  events: EMPTY,
  meal_entries: ONE_ROW,
  weight_entries: EMPTY,
  ...over,
});

async function run(over: Record<string, FakeTable> = {}, now: Date = SUNDAY_9, timeZone = TZ) {
  const { client, queries } = createFakeReadSupabase(tables(over));
  const fact = await loadWeeklyHomeFact(client, USER, { timeZone, now });
  return { fact, queries };
}

const tablesOf = (queries: RecordedQuery[]) => queries.map((q) => q.table).sort();
const STAGE_ONE = ["events", "offline_periods", "profiles", "weekly_summaries"];

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  flow.enabled = true;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadWeeklyHomeFact: the pre-check gate", () => {
  it.each([
    ["Saturday evening, before the next Sunday 05:00", "2027-01-09T16:00:00Z"],
    ["Wednesday 05:00 sharp (the card window closed)", "2027-01-13T03:00:00Z"],
    ["Thursday", "2027-01-14T10:00:00Z"],
    ["Friday", "2027-01-15T10:00:00Z"],
    ["Sunday 04:59 local, before the week is ready (the week before is long past its window)", "2027-01-10T02:59:00Z"],
  ])("%s: null with ZERO queries", async (_name, iso) => {
    const { fact, queries } = await run({}, new Date(iso));
    expect(fact).toBeNull();
    expect(queries).toEqual([]);
  });

  it("the switch off: null with zero queries", async () => {
    flow.enabled = false;
    const { fact, queries } = await run();
    expect(fact).toBeNull();
    expect(queries).toEqual([]);
  });

  it("an invalid instant is null with zero queries, and never throws", async () => {
    const { fact, queries } = await run({}, new Date(Number.NaN));
    expect(fact).toBeNull();
    expect(queries).toEqual([]);
  });

  it.each([
    ["Sunday 05:00 local", "2027-01-10T03:00:00Z"],
    ["Monday", "2027-01-11T10:00:00Z"],
    ["Wednesday 04:59:59 local (the last second of the window)", "2027-01-13T02:59:59Z"],
  ])("%s: the window is open, so the reads happen", async (_name, iso) => {
    const { fact, queries } = await run({}, new Date(iso));
    expect(fact).toEqual({ weekStart: WEEK_START, card: true });
    expect(tablesOf(queries)).toEqual([...STAGE_ONE, "meal_entries", "weight_entries"].sort());
  });
});

describe("loadWeeklyHomeFact: the exact queries", () => {
  it("stage 1 is four parallel reads with the filters of 3.5", async () => {
    const { queries } = await run();
    const byTable = (table: string) => queries.find((q) => q.table === table);

    expect(byTable("profiles")).toMatchObject({ columns: "first_week_ended_at", filters: [["eq", "user_id", USER]], limit: 1 });
    expect(byTable("offline_periods")).toMatchObject({
      columns: "type, start_at, end_at",
      filters: [
        ["eq", "user_id", USER],
        ["gt", "end_at", PERIODS_FROM],
        ["lte", "start_at", WEEK_END_UTC],
      ],
      order: { column: "start_at", ascending: true },
      limit: 120,
    });
    expect(byTable("weekly_summaries")).toMatchObject({
      columns: "id",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "week_start", WEEK_START],
      ],
      limit: 1,
    });
    expect(byTable("events")).toMatchObject({
      columns: "payload, occurred_at",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "name", "weekly_card_snoozed"],
        ["gt", "occurred_at", SINCE],
      ],
      order: { column: "occurred_at", ascending: false },
      limit: 10,
    });
  });

  it("the probes (untouched card only) read from the WINDOW start, up to the week's end", async () => {
    // The transition was on Tuesday 2027-01-05 10:00 local: its day belongs to the First Week summary, so the window starts on Wednesday 00:00.
    const { fact, queries } = await run({ profiles: { rows: [{ first_week_ended_at: "2027-01-05T08:00:00Z" }] } });
    expect(fact).toEqual({ weekStart: WEEK_START, card: true });

    const windowStart = "2027-01-05T22:00:00.000Z";
    expect(queries.find((q) => q.table === "meal_entries")).toMatchObject({
      columns: "id",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "aggregated", false],
        ["gte", "occurred_at", windowStart],
        ["lt", "occurred_at", WEEK_END_UTC],
      ],
      limit: 1,
    });
    expect(queries.find((q) => q.table === "weight_entries")).toMatchObject({
      columns: "id",
      filters: [
        ["eq", "user_id", USER],
        ["gte", "measured_at", windowStart],
        ["lt", "measured_at", WEEK_END_UTC],
      ],
      limit: 1,
    });
  });
});

describe("loadWeeklyHomeFact: what the fact says", () => {
  it("an untouched week with a meal is the card", async () => {
    expect((await run()).fact).toEqual({ weekStart: WEEK_START, card: true });
  });

  it("a weigh-in alone is activity too", async () => {
    expect((await run({ meal_entries: EMPTY, weight_entries: ONE_ROW })).fact).toEqual({ weekStart: WEEK_START, card: true });
  });

  it("a week with neither a meal nor a weigh-in is silence: no card, no link", async () => {
    expect((await run({ meal_entries: EMPTY, weight_entries: EMPTY })).fact).toBeNull();
  });

  it("an opened week is the quiet link only, with NO probe queries", async () => {
    const { fact, queries } = await run({ weekly_summaries: ONE_ROW, meal_entries: EMPTY });
    expect(fact).toEqual({ weekStart: WEEK_START, card: false });
    expect(tablesOf(queries)).toEqual(STAGE_ONE);
  });

  it("a snooze pressed 2 hours ago is the quiet link only, with NO probe queries", async () => {
    const snoozed = { rows: [{ payload: { week: WEEK_START }, occurred_at: "2027-01-10T07:00:00Z" }] };
    const { fact, queries } = await run({ events: snoozed, meal_entries: EMPTY });
    expect(fact).toEqual({ weekStart: WEEK_START, card: false });
    expect(tablesOf(queries)).toEqual(STAGE_ONE);
  });

  it("a snooze that is 25 hours old, one of another week, or one without a readable payload does not hide the card", async () => {
    for (const rows of [
      [{ payload: { week: WEEK_START }, occurred_at: "2027-01-09T08:00:00Z" }],
      [{ payload: { week: "2026-12-27" }, occurred_at: "2027-01-10T07:00:00Z" }],
      [{ payload: null, occurred_at: "2027-01-10T07:00:00Z" }, { payload: { week: WEEK_START }, occurred_at: "not a date" }, "garbage"],
    ]) {
      expect((await run({ events: { rows } })).fact).toEqual({ weekStart: WEEK_START, card: true });
    }
  });

  it("an opened week stays the quiet link even if the card window's activity is gone (no probe decides it)", async () => {
    expect((await run({ weekly_summaries: ONE_ROW, meal_entries: EMPTY, weight_entries: EMPTY })).fact).toEqual({ weekStart: WEEK_START, card: false });
  });
});

describe("loadWeeklyHomeFact: when the week is not eligible", () => {
  it("no transition stamp (first_week_ended_at null) is null", async () => {
    expect((await run({ profiles: { rows: [{ first_week_ended_at: null }] } })).fact).toBeNull();
    expect((await run({ profiles: EMPTY })).fact).toBeNull();
  });

  it("a window under 4 available days is null (continued on Thursday: only Friday is left)", async () => {
    // Thursday 2027-01-07 10:00 local: the window starts Friday 00:00, one local day.
    expect((await run({ profiles: { rows: [{ first_week_ended_at: "2027-01-07T08:00:00Z" }] } })).fact).toBeNull();
  });

  it("a long Shabbat does not stop an eligible window: Sunday to Friday has six available days", async () => {
    const shabbat = { rows: [{ type: "SHABBAT", start_at: "2027-01-08T14:10:00Z", end_at: "2027-01-09T16:25:00Z" }] };
    expect((await run({ offline_periods: shabbat })).fact).toEqual({ weekStart: WEEK_START, card: true });
  });

  it("offline days count against the window: a week that is mostly offline is null", async () => {
    const mostlyOffline = { rows: [{ type: "VACATION", start_at: "2027-01-02T20:00:00Z", end_at: "2027-01-08T22:00:00Z" }] };
    expect((await run({ offline_periods: mostlyOffline })).fact).toBeNull();
  });
});

describe("loadWeeklyHomeFact: unknown is silence", () => {
  it.each([
    ["profiles", FAILS],
    ["profiles", THROWS],
    ["offline_periods", FAILS],
    ["offline_periods", THROWS],
    ["weekly_summaries", FAILS],
    ["weekly_summaries", THROWS],
    ["events", FAILS],
    ["events", THROWS],
    ["meal_entries", FAILS],
    ["meal_entries", THROWS],
    ["weight_entries", FAILS],
    ["weight_entries", THROWS],
  ])("%s failing (%j) is null, never a throw", async (table, answer) => {
    const { fact } = await run({ [table]: answer });
    expect(fact).toBeNull();
  });

  it("a periods read of exactly 120 rows is truncated, so unknown", async () => {
    const row = { type: "SHABBAT", start_at: "2026-12-05T14:10:00Z", end_at: "2026-12-06T16:25:00Z" };
    expect((await run({ offline_periods: { rows: Array.from({ length: 119 }, () => row) } })).fact).toEqual({ weekStart: WEEK_START, card: true });
    expect((await run({ offline_periods: { rows: Array.from({ length: 120 }, () => row) } })).fact).toBeNull();
  });

  it("an answer that is not a list is null", async () => {
    const odd = { rows: "nope" } as unknown as FakeTable;
    for (const table of ["profiles", "offline_periods", "weekly_summaries", "events", "meal_entries", "weight_entries"]) {
      expect((await run({ [table]: odd })).fact, table).toBeNull();
    }
  });

  it("an unreadable transition stamp is null", async () => {
    expect((await run({ profiles: { rows: [{ first_week_ended_at: "yesterday-ish" }] } })).fact).toBeNull();
    expect((await run({ profiles: { rows: [{ first_week_ended_at: 12345 }] } })).fact).toBeNull();
  });

  it("a client that throws on from() is null", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof loadWeeklyHomeFact>[0];
    expect(await loadWeeklyHomeFact(broken, USER, { timeZone: TZ, now: SUNDAY_9 })).toBeNull();
  });

  it("logs only codes, never the user id", async () => {
    await run({ weekly_summaries: FAILS });
    for (const call of errorLog.mock.calls) expect(JSON.stringify(call)).not.toContain(USER);
  });

  it("a garbage zone behaves as Asia/Jerusalem", async () => {
    expect((await run({}, SUNDAY_9, "Not/AZone")).fact).toEqual({ weekStart: WEEK_START, card: true });
  });
});
