import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FALLBACK_TIME_ZONE, homePeriodsWindow } from "@/domain/home";
import { NOT_SNOOZED } from "@/domain/firstWeekFlow";
import { normalizeRow } from "@/domain/onboarding";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { createFakeReadSupabase, type FakeTable } from "./fakeReadSupabase";
import { REPORT_TABLES, loadHasAnyReport, loadHomeFacts, loadOfflinePeriods } from "./load";

// The switch is read at call time, so one mutable stand-in serves every case.
const flow = vi.hoisted(() => ({ detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true }));
vi.mock("@/domain/patterns/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/patterns/types")>()),
  PATTERN_FLOW: flow,
}));
const weightFlow = vi.hoisted(() => ({ reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true }));
vi.mock("@/domain/weight/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/weight/types")>()),
  WEIGHT_FLOW: weightFlow,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2027-01-09T16:00:00Z");

const EMPTY: FakeTable = { rows: [] };
const ONE_ROW: FakeTable = { rows: [{ id: "row-1" }] };
const FAILS: FakeTable = { error: { code: "42501" } };
const THROWS: FakeTable = "throw";

const SHABBAT_ROW = { type: "SHABBAT", start_at: "2027-01-08T14:10:00+00:00", end_at: "2027-01-09T15:25:00+00:00" };

const allReportTables = (answer: FakeTable) => Object.fromEntries(REPORT_TABLES.map((table) => [table, answer]));

// Most cases below are about the two facts Home has always needed, so they use a lifecycle that reads nothing else;
// the First Week describe passes "FIRST_WEEK" explicitly.
function readyContext(supabase: SupabaseClient, timezone = "Asia/Jerusalem", lifecycle = "WEEKLY_CYCLE"): OnboardingContext {
  const row = normalizeRow({ lifecycle_state: lifecycle, timezone }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase };
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  flow.detectionEnabled = true;
  flow.earlySignalEnabled = true;
  weightFlow.milestoneMomentEnabled = true;
  // The loader logs failures (code only); keep the test output quiet.
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the fallback zone", () => {
  it("is the same zone the rest of the app formats in", () => {
    expect(HOME_FALLBACK_TIME_ZONE).toBe(DEFAULT_TIME_ZONE);
  });
});

describe("loadHomeFacts: no profile to read", () => {
  it.each(["not_configured", "signed_out", "unavailable", "profile_missing"] as const)(
    "%s: no queries, default zone, both facts unknown",
    async (kind) => {
      const { client, queries } = createFakeReadSupabase({ offline_periods: EMPTY, ...allReportTables(ONE_ROW) });
      // A client riding along on a not-ready context must still be left alone.
      const context = { kind, supabase: client, userId: USER } as unknown as OnboardingContext;

      expect(await loadHomeFacts(context, NOW)).toEqual({
        now: NOW,
        timeZone: DEFAULT_TIME_ZONE,
        offlinePeriods: null,
        hasAnyReport: null,
        lifecycle: null,
        firstWeek: null,
        firstWeekSnoozed: NOT_SNOOZED,
        earlySignal: null,
        quietHours: null,
        milestone: null,
      });
      expect(queries).toEqual([]);
    },
  );
});

describe("loadHomeFacts: ready", () => {
  it("reads the periods and the reports and returns the profile's zone", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: { rows: [SHABBAT_ROW] }, ...allReportTables(EMPTY) });
    const facts = await loadHomeFacts(readyContext(client, "UTC"), NOW);

    expect(facts.now).toBe(NOW);
    expect(facts.timeZone).toBe("UTC");
    expect(facts.hasAnyReport).toBe(false);
    expect(facts.offlinePeriods).toEqual([
      { type: "SHABBAT", start: new Date("2027-01-08T14:10:00Z"), end: new Date("2027-01-09T15:25:00Z") },
    ]);
  });

  it.each(["Not/AZone", "", "Asia/Jerusalem "])("turns the garbage zone %j into the fallback, so the zone is always valid", async (timezone) => {
    const { client } = createFakeReadSupabase({ offline_periods: EMPTY, ...allReportTables(EMPTY) });
    expect((await loadHomeFacts(readyContext(client, timezone), NOW)).timeZone).toBe(HOME_FALLBACK_TIME_ZONE);
  });

  it("a WEEKLY_CYCLE context makes exactly six queries: the periods and one probe per report table", async () => {
    const { client, queries } = createFakeReadSupabase({ offline_periods: EMPTY, ...allReportTables(EMPTY) });
    await loadHomeFacts(readyContext(client), NOW);
    expect(queries.map((q) => q.table).sort()).toEqual(["offline_periods", ...REPORT_TABLES].sort());
  });

  it("takes the instant it is given, and the current time when none is given", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: EMPTY, ...allReportTables(EMPTY) });
    expect((await loadHomeFacts(readyContext(client), NOW)).now).toBe(NOW);

    const before = Date.now();
    const facts = await loadHomeFacts(readyContext(client));
    expect(facts.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(facts.now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("keeps the other fact when one read fails", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: FAILS, ...allReportTables(ONE_ROW) });
    const facts = await loadHomeFacts(readyContext(client), NOW);
    expect(facts.offlinePeriods).toBeNull();
    expect(facts.hasAnyReport).toBe(true);
  });

  it("falls back to 'nothing known' instead of throwing on a malformed context", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: EMPTY, ...allReportTables(EMPTY) });
    const malformed = { kind: "ready", userId: USER, supabase: client } as unknown as OnboardingContext; // no row
    await expect(loadHomeFacts(malformed, NOW)).resolves.toEqual({
      now: NOW,
      timeZone: DEFAULT_TIME_ZONE,
      offlinePeriods: null,
      hasAnyReport: null,
      lifecycle: null,
      firstWeek: null,
      firstWeekSnoozed: NOT_SNOOZED,
      earlySignal: null,
      quietHours: null,
      milestone: null,
    });
  });

  it("never throws and answers every combination of failures consistently", async () => {
    const kinds = { empty: EMPTY, row: ONE_ROW, error: FAILS, throw: THROWS } as const;
    const names = Object.keys(kinds) as Array<keyof typeof kinds>;
    const offlineKinds: Record<keyof typeof kinds, FakeTable> = {
      empty: EMPTY,
      row: { rows: [SHABBAT_ROW] },
      error: FAILS,
      throw: THROWS,
    };

    for (const offline of names) {
      for (let i = 0; i < names.length ** REPORT_TABLES.length; i++) {
        const picks = REPORT_TABLES.map((_, j) => names[Math.floor(i / names.length ** j) % names.length]);
        const tables: Record<string, FakeTable> = { offline_periods: offlineKinds[offline] };
        REPORT_TABLES.forEach((table, j) => (tables[table] = kinds[picks[j]]));
        const { client } = createFakeReadSupabase(tables);

        const facts = await loadHomeFacts(readyContext(client), NOW);

        expect(facts.offlinePeriods === null).toBe(offline === "error" || offline === "throw");
        const expected = picks.includes("row") ? true : picks.every((p) => p === "empty") ? false : null;
        expect(facts.hasAnyReport, `${offline} / ${picks.join(",")}`).toBe(expected);
      }
    }
  });
});

describe("loadHomeFacts: First Week facts", () => {
  const STARTED = "2027-01-04T10:00:00Z"; // Monday, 12:00 in Jerusalem (UTC+2 in January)
  const evening = (id: string, day: number) => ({ id, confirmed_at: `2027-01-0${day}T19:30:00Z`, occurred_at: `2027-01-0${day}T19:30:00Z` }); // 21:30 local
  const TWO_LATE_EVENINGS = [evening("m1", 5), evening("m2", 6)];
  const THREE_LATE_EVENINGS = [...TWO_LATE_EVENINGS, evening("m3", 7)];

  const firstWeekTables = (over: Record<string, FakeTable> = {}): Record<string, FakeTable> => ({
    offline_periods: EMPTY,
    ...allReportTables({ rows: TWO_LATE_EVENINGS }),
    profiles: { rows: [{ first_week_started_at: STARTED }] },
    events: EMPTY,
    patterns: EMPTY,
    user_preferences: { rows: [{ quiet_hours_start: "00:00:00", quiet_hours_end: "08:00:00" }] },
    ...over,
  });
  const reportTablesWith = (rows: unknown[]): Record<string, FakeTable> => allReportTables({ rows });

  const shape = (queries: Array<{ table: string; columns: string }>) => queries.map((q) => `${q.table}:${q.columns}`).sort();

  const HOME_SIX = ["offline_periods:type, start_at, end_at", ...REPORT_TABLES.map((t) => `${t}:id`)];
  // meal_entries is also one of the five report probes, so its Home probe reads `id` and the First Week reads differ.
  const PHASE_ONE_FOUR = [
    "profiles:first_week_started_at",
    "meal_entries:confirmed_at",
    "offline_periods:type, start_at, end_at",
    "events:payload, occurred_at",
  ];
  const PHASE_TWO_TWO = ["meal_entries:id, occurred_at", "patterns:id, status, user_feedback, user_feedback_at"];
  const QUIET = "user_preferences:quiet_hours_start, quiet_hours_end";

  const firstWeek = (client: SupabaseClient) => readyContext(client, "Asia/Jerusalem", "FIRST_WEEK");

  it("populates the lifecycle, the counts and the snooze flags", async () => {
    const { client } = createFakeReadSupabase(firstWeekTables());
    const facts = await loadHomeFacts(firstWeek(client), NOW);

    expect(facts.lifecycle).toBe("FIRST_WEEK");
    // Monday 4th to Friday 8th have ended; Saturday (the 9th) has not: five whole days, no offline rows.
    expect(facts.firstWeek).toEqual({ availableDays: 5, confirmedMeals: 2, availableDaysSinceLastMeal: 2 });
    expect(facts.firstWeekSnoozed).toEqual({ summary: false, welcomeBack: false });
    expect(facts.timeZone).toBe("Asia/Jerusalem");
  });

  it("a FIRST_WEEK context makes the six queries, the Phase 1 four and the Phase 2 two (the recorded list, not a count)", async () => {
    const answered = { id: "p1", status: "OBSERVATION", user_feedback: "confirm", user_feedback_at: "2027-01-08T10:00:00Z" };
    const { client, queries } = createFakeReadSupabase(firstWeekTables({ patterns: { rows: [answered] } }));
    await loadHomeFacts(firstWeek(client), NOW);
    // The answered signal is not due, so the quiet hours are NOT read.
    expect(shape(queries)).toEqual([...HOME_SIX, ...PHASE_ONE_FOUR, ...PHASE_TWO_TWO].sort());
  });

  it("the card is due: the quiet hours are read as a second stage, and only then", async () => {
    const { client, queries } = createFakeReadSupabase(firstWeekTables());
    const facts = await loadHomeFacts(firstWeek(client), NOW);

    expect(facts.earlySignal).toEqual({ due: true, level: "EARLY_SIGNAL" });
    expect(facts.quietHours).toEqual({ kind: "WINDOW", startMinute: 0, endMinute: 480 });
    expect(shape(queries)).toEqual([...HOME_SIX, ...PHASE_ONE_FOUR, ...PHASE_TWO_TWO, QUIET].sort());
    expect(queries.at(-1)?.table).toBe("user_preferences"); // after every other read
  });

  it("three evenings and no answer: due at the Candidate level", async () => {
    const { client } = createFakeReadSupabase(firstWeekTables(reportTablesWith(THREE_LATE_EVENINGS)));
    expect((await loadHomeFacts(firstWeek(client), NOW)).earlySignal).toEqual({ due: true, level: "CANDIDATE" });
  });

  it("the person answered 'Sounds right': not due, and the quiet hours are not read", async () => {
    const answered = { id: "p1", status: "OBSERVATION", user_feedback: "confirm", user_feedback_at: "2027-01-08T10:00:00Z" };
    const { client, queries } = createFakeReadSupabase(firstWeekTables({ patterns: { rows: [answered] } }));
    const facts = await loadHomeFacts(firstWeek(client), NOW);
    expect(facts.earlySignal).toEqual({ due: false, level: null });
    expect(facts.quietHours).toBeNull();
    expect(queries.map((q) => q.table)).not.toContain("user_preferences");
  });

  it("one late evening: nothing to say, no quiet-hours read", async () => {
    const { client, queries } = createFakeReadSupabase(firstWeekTables(reportTablesWith(TWO_LATE_EVENINGS.slice(0, 1))));
    const facts = await loadHomeFacts(firstWeek(client), NOW);
    expect(facts.earlySignal).toEqual({ due: false, level: null });
    expect(queries.map((q) => q.table)).not.toContain("user_preferences");
  });

  it("unknown quiet hours stay null (and Home says nothing rather than guess)", async () => {
    const { client } = createFakeReadSupabase(firstWeekTables({ user_preferences: FAILS }));
    const facts = await loadHomeFacts(firstWeek(client), NOW);
    expect(facts.earlySignal?.due).toBe(true);
    expect(facts.quietHours).toBeNull();
  });

  it("PATTERN_FLOW.earlySignalEnabled off: no signal query, earlySignal null", async () => {
    flow.earlySignalEnabled = false;
    const { client, queries } = createFakeReadSupabase(firstWeekTables());
    const facts = await loadHomeFacts(firstWeek(client), NOW);
    expect(facts.earlySignal).toBeNull();
    expect(facts.quietHours).toBeNull();
    expect(shape(queries)).toEqual([...HOME_SIX, ...PHASE_ONE_FOUR].sort());
  });

  it("PATTERN_FLOW.detectionEnabled off: the signal is unknown, so no card and no extra read", async () => {
    flow.detectionEnabled = false;
    const { client, queries } = createFakeReadSupabase(firstWeekTables());
    const facts = await loadHomeFacts(firstWeek(client), NOW);
    expect(facts.earlySignal).toBeNull();
    expect(shape(queries)).toEqual([...HOME_SIX, ...PHASE_ONE_FOUR].sort());
  });

  it("WEEKLY_CYCLE: no First Week, snooze, signal or quiet-hours query at all", async () => {
    const { client, queries } = createFakeReadSupabase(firstWeekTables());
    const facts = await loadHomeFacts(readyContext(client, "Asia/Jerusalem", "WEEKLY_CYCLE"), NOW);

    expect(shape(queries)).toEqual([...HOME_SIX].sort());
    for (const table of ["events", "patterns", "user_preferences", "profiles"]) {
      expect(queries.map((q) => q.table), table).not.toContain(table);
    }
    expect(facts).toMatchObject({ lifecycle: "WEEKLY_CYCLE", firstWeek: null, firstWeekSnoozed: NOT_SNOOZED, earlySignal: null, quietHours: null });
  });

  it.each(["NEW", "ONBOARDING"])("%s: the same, nothing First Week is read", async (lifecycle) => {
    const { client, queries } = createFakeReadSupabase(firstWeekTables());
    const facts = await loadHomeFacts(readyContext(client, "Asia/Jerusalem", lifecycle), NOW);
    expect(shape(queries)).toEqual([...HOME_SIX].sort());
    expect(facts.firstWeek).toBeNull();
    expect(facts.lifecycle).toBe(lifecycle);
  });

  it("a failing First Week read leaves the offline periods and the report fact intact", async () => {
    for (const profiles of [FAILS, THROWS]) {
      const { client } = createFakeReadSupabase(firstWeekTables({ profiles, offline_periods: { rows: [SHABBAT_ROW] } }));
      const facts = await loadHomeFacts(firstWeek(client), NOW);
      expect(facts.firstWeek).toBeNull();
      expect(facts.lifecycle).toBe("FIRST_WEEK");
      expect(facts.offlinePeriods).toHaveLength(1);
      expect(facts.hasAnyReport).toBe(true);
    }
  });

  it("a failing snooze read is NOT_SNOOZED and leaves every other fact intact", async () => {
    for (const events of [FAILS, THROWS]) {
      const { client } = createFakeReadSupabase(firstWeekTables({ events }));
      const facts = await loadHomeFacts(firstWeek(client), NOW);
      expect(facts.firstWeekSnoozed).toEqual(NOT_SNOOZED);
      expect(facts.firstWeek).not.toBeNull();
      expect(facts.hasAnyReport).toBe(true);
      expect(facts.earlySignal?.due).toBe(true);
    }
  });

  it("a snooze pressed an hour ago hides that card", async () => {
    const pressed = { payload: { card: "summary" }, occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString() };
    const { client } = createFakeReadSupabase(firstWeekTables({ events: { rows: [pressed] } }));
    expect((await loadHomeFacts(firstWeek(client), NOW)).firstWeekSnoozed).toEqual({ summary: true, welcomeBack: false });
  });

  it("a failing signal read leaves every other fact intact and adds nothing to be degraded about", async () => {
    for (const patterns of [FAILS, THROWS]) {
      const { client } = createFakeReadSupabase(firstWeekTables({ patterns }));
      const facts = await loadHomeFacts(firstWeek(client), NOW);
      expect(facts.earlySignal).toBeNull();
      expect(facts.quietHours).toBeNull();
      expect(facts.firstWeek).not.toBeNull();
      expect(facts.offlinePeriods).toEqual([]);
      expect(facts.hasAnyReport).toBe(true);
    }
  });

  it("holds the invariants of the facts for every lifecycle", async () => {
    for (const lifecycle of ["NEW", "ONBOARDING", "FIRST_WEEK", "WEEKLY_CYCLE"]) {
      const { client } = createFakeReadSupabase(firstWeekTables());
      const facts = await loadHomeFacts(readyContext(client, "Asia/Jerusalem", lifecycle), NOW);
      if (facts.firstWeek !== null || facts.earlySignal !== null) expect(facts.lifecycle).toBe("FIRST_WEEK");
      if (facts.quietHours !== null) expect(facts.earlySignal?.due).toBe(true);
      if (facts.lifecycle !== "FIRST_WEEK") expect(facts.firstWeekSnoozed).toEqual({ summary: false, welcomeBack: false });
    }
  });

  it("a failing report probe keeps the First Week facts", async () => {
    const { client } = createFakeReadSupabase(firstWeekTables({ weight_entries: FAILS, activity_entries: THROWS }));
    const facts = await loadHomeFacts(firstWeek(client), NOW);
    expect(facts.hasAnyReport).toBe(true); // meal_entries answered with rows
    expect(facts.firstWeek).not.toBeNull();
  });
});

describe("loadOfflinePeriods", () => {
  it("asks for the periods that overlap the window, oldest first, at most 20", async () => {
    const { client, queries } = createFakeReadSupabase({ offline_periods: EMPTY });
    await loadOfflinePeriods(client, USER, NOW);

    const { from, to } = homePeriodsWindow(NOW);
    expect(queries).toEqual([
      {
        table: "offline_periods",
        columns: "type, start_at, end_at",
        filters: [
          ["eq", "user_id", USER],
          ["gt", "end_at", from.toISOString()],
          ["lte", "start_at", to.toISOString()],
        ],
        order: { column: "start_at", ascending: true },
        limit: 20,
      },
    ]);
  });

  it("maps rows to periods with the right type and instants", async () => {
    const { client } = createFakeReadSupabase({
      offline_periods: {
        rows: [
          SHABBAT_ROW,
          { type: "HOLIDAY", start_at: "2027-01-10T10:00:00Z", end_at: "2027-01-11T10:00:00Z" },
          { type: "USER_DEFINED", start_at: "2027-01-12T10:00:00Z", end_at: "2027-01-12T12:00:00Z" },
          { type: "VACATION", start_at: "2027-01-13T10:00:00Z", end_at: "2027-01-20T10:00:00Z" },
        ],
      },
    });
    const periods = await loadOfflinePeriods(client, USER, NOW);
    expect(periods?.map((p) => p.type)).toEqual(["SHABBAT", "HOLIDAY", "USER_DEFINED", "VACATION"]);
    expect(periods?.[1]).toEqual({
      type: "HOLIDAY",
      start: new Date("2027-01-10T10:00:00Z"),
      end: new Date("2027-01-11T10:00:00Z"),
    });
    expect(periods?.every((p) => p.start instanceof Date && p.end instanceof Date)).toBe(true);
  });

  it("answers an empty list, not null, when there are no periods", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: EMPTY });
    expect(await loadOfflinePeriods(client, USER, NOW)).toEqual([]);
  });

  it("drops rows with an unknown type or an unreadable date instead of guessing", async () => {
    const { client } = createFakeReadSupabase({
      offline_periods: {
        rows: [
          { ...SHABBAT_ROW, type: "RAMADAN" },
          { ...SHABBAT_ROW, type: "toString" },
          { ...SHABBAT_ROW, type: null },
          { ...SHABBAT_ROW, start_at: "not a date" },
          { ...SHABBAT_ROW, end_at: null },
          { type: "SHABBAT", start_at: "2027-01-08T14:10:00Z" },
          { ...SHABBAT_ROW, start_at: 1_800_000_000_000 },
          null,
          "SHABBAT",
          SHABBAT_ROW,
        ],
      },
    });
    const periods = await loadOfflinePeriods(client, USER, NOW);
    expect(periods).toEqual([
      { type: "SHABBAT", start: new Date("2027-01-08T14:10:00Z"), end: new Date("2027-01-09T15:25:00Z") },
    ]);
  });

  it("answers null when the query returns an error", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: FAILS });
    expect(await loadOfflinePeriods(client, USER, NOW)).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(expect.any(String), "42501");
  });

  it("answers null when the query throws", async () => {
    const { client } = createFakeReadSupabase({ offline_periods: THROWS });
    expect(await loadOfflinePeriods(client, USER, NOW)).toBeNull();
  });

  it("answers null when the client itself throws, and for an instant that cannot be turned into a window", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    expect(await loadOfflinePeriods(broken, USER, NOW)).toBeNull();

    const { client, queries } = createFakeReadSupabase({ offline_periods: EMPTY });
    expect(await loadOfflinePeriods(client, USER, new Date("not a date"))).toBeNull();
    expect(queries).toEqual([]);
  });

  it("does not put the user id or any row content in the log", async () => {
    const { client } = createFakeReadSupabase({
      offline_periods: { error: { code: "42501", message: `permission denied for ${USER}` } },
    });
    await loadOfflinePeriods(client, USER, NOW);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(USER);
  });
});

describe("loadHasAnyReport", () => {
  it("probes exactly the five confirmed-report tables, one row each, and never the unconfirmed ones", async () => {
    const { client, queries } = createFakeReadSupabase(allReportTables(EMPTY));
    await loadHasAnyReport(client, USER);

    expect([...REPORT_TABLES]).toEqual(["meal_entries", "weight_entries", "activity_entries", "sleep_entries", "stress_entries"]);
    expect(queries.map((q) => q.table).sort()).toEqual([...REPORT_TABLES].sort());
    for (const query of queries) {
      expect(query).toEqual({
        table: query.table,
        columns: "id",
        filters: [["eq", "user_id", USER]],
        limit: 1,
      });
    }
    const touched = queries.map((q) => q.table);
    expect(touched).not.toContain("meal_raw_inputs");
    expect(touched).not.toContain("meal_understandings");
  });

  it("answers false only when every table answered with no rows", async () => {
    const { client } = createFakeReadSupabase(allReportTables(EMPTY));
    expect(await loadHasAnyReport(client, USER)).toBe(false);
  });

  it("answers true for a single row in any one table", async () => {
    for (const table of REPORT_TABLES) {
      const { client } = createFakeReadSupabase({ ...allReportTables(EMPTY), [table]: ONE_ROW });
      expect(await loadHasAnyReport(client, USER), table).toBe(true);
    }
  });

  it("answers true when one table has a row even though others fail or throw", async () => {
    const { client } = createFakeReadSupabase({
      meal_entries: FAILS,
      weight_entries: THROWS,
      activity_entries: ONE_ROW,
      sleep_entries: FAILS,
      stress_entries: EMPTY,
    });
    expect(await loadHasAnyReport(client, USER)).toBe(true);
  });

  it("answers null when the others are empty but one failed", async () => {
    for (const failure of [FAILS, THROWS]) {
      const { client } = createFakeReadSupabase({ ...allReportTables(EMPTY), sleep_entries: failure });
      expect(await loadHasAnyReport(client, USER)).toBeNull();
    }
  });

  it("answers null when every table fails or throws", async () => {
    for (const failure of [FAILS, THROWS]) {
      const { client } = createFakeReadSupabase(allReportTables(failure));
      expect(await loadHasAnyReport(client, USER)).toBeNull();
    }
    const mixed = createFakeReadSupabase({
      meal_entries: FAILS,
      weight_entries: THROWS,
      activity_entries: FAILS,
      sleep_entries: THROWS,
      stress_entries: FAILS,
    });
    expect(await loadHasAnyReport(mixed.client, USER)).toBeNull();
  });

  it("answers null when the client itself throws", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    expect(await loadHasAnyReport(broken, USER)).toBeNull();
  });
});

describe("loadHomeFacts: the milestone fact", () => {
  // Start 80, goal 70 (landmarks 80, 75, 70). The weeks of 20 and 27 December are both at or below 75, so the landmark
  // was confirmed in the week of 27 December and its card runs from Sunday 3 January for 14 days: NOW (9 January) is inside.
  const NUMERIC = { goal_type: "numeric", start_weight_kg: 80, goal_weight_kg: 70 };
  const SERIES = "weight_entries:id, weight_kg, measured_at";
  const BASE_SIX = ["offline_periods:type, start_at, end_at", ...REPORT_TABLES.map((t) => `${t}:id`)];
  const entry = (n: number, day: string, kg: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, weight_kg: kg, measured_at: `${day}T08:00:00+00:00` });
  const REACHED_75 = [entry(1, "2026-12-22", 74.9), entry(2, "2026-12-29", 74.5)];

  function numericContext(supabase: SupabaseClient, over: Record<string, unknown> = {}): OnboardingContext {
    const row = normalizeRow({ lifecycle_state: "WEEKLY_CYCLE", timezone: "Asia/Jerusalem", ...NUMERIC, ...over }, null);
    if (!row) throw new Error("the fixture row did not normalize");
    return { kind: "ready", userId: USER, row, supabase };
  }

  const weightTables = (over: Record<string, FakeTable> = {}): Record<string, FakeTable> => ({
    offline_periods: EMPTY,
    ...allReportTables(EMPTY),
    weight_entries: { rows: REACHED_75 },
    events: EMPTY,
    ...over,
  });
  const shape = (queries: Array<{ table: string; columns: string }>) => queries.map((q) => `${q.table}:${q.columns}`).sort();

  it("a numeric goal below the start weight adds the weight series read to the recorded queries, and the fact is the moment", async () => {
    const { client, queries } = createFakeReadSupabase(weightTables({ events: EMPTY }));
    const facts = await loadHomeFacts(numericContext(client), NOW);
    expect(facts.milestone).toEqual({ week: "2026-12-27", isGoal: false });
    // The six reads Home has always made, the series, and the acknowledgements (a candidate exists).
    expect(shape(queries)).toEqual([...BASE_SIX, SERIES, "events:payload"].sort());
  });

  it("no candidate: only the series is added (not the acknowledgements)", async () => {
    const { client, queries } = createFakeReadSupabase(weightTables({ weight_entries: { rows: [entry(1, "2026-12-29", 74.5)] } }));
    const facts = await loadHomeFacts(numericContext(client), NOW);
    expect(facts.milestone).toBeNull();
    expect(shape(queries)).toEqual([...BASE_SIX, SERIES].sort());
  });

  it("an acknowledged week is no moment", async () => {
    const { client } = createFakeReadSupabase(weightTables({ events: { rows: [{ payload: { week: "2026-12-27" } }] } }));
    expect((await loadHomeFacts(numericContext(client), NOW)).milestone).toBeNull();
  });

  it.each([
    ["goal_type none", { goal_type: "none" }],
    ["goal_type behavioral", { goal_type: "behavioral" }],
    ["a goal not below the start weight", { goal_weight_kg: 90 }],
    ["no goal weight", { goal_weight_kg: null }],
  ])("%s: the recorded query list is exactly the six it always was, and the fact is null", async (_name, over) => {
    const { client, queries } = createFakeReadSupabase(weightTables());
    const facts = await loadHomeFacts(numericContext(client, over), NOW);
    expect(facts.milestone).toBeNull();
    expect(shape(queries)).toEqual([...BASE_SIX].sort());
  });

  it("the switch off: no weight read at all", async () => {
    weightFlow.milestoneMomentEnabled = false;
    const { client, queries } = createFakeReadSupabase(weightTables());
    const facts = await loadHomeFacts(numericContext(client), NOW);
    expect(facts.milestone).toBeNull();
    expect(shape(queries)).toEqual([...BASE_SIX].sort());
  });

  it("a failing series read is null and changes nothing else: no degraded fact, the others intact", async () => {
    const { client } = createFakeReadSupabase(weightTables({ weight_entries: FAILS, meal_entries: ONE_ROW, offline_periods: { rows: [SHABBAT_ROW] } }));
    const facts = await loadHomeFacts(numericContext(client), NOW);
    expect(facts.milestone).toBeNull();
    expect(facts.hasAnyReport).toBe(true);
    expect(facts.offlinePeriods).toHaveLength(1);
    expect(facts.lifecycle).toBe("WEEKLY_CYCLE");
  });

  it("a thrown series or acknowledgements read is null and the other facts are intact", async () => {
    const failures: Array<Record<string, FakeTable>> = [{ weight_entries: THROWS }, { events: THROWS }, { events: FAILS }];
    for (const over of failures) {
      const { client } = createFakeReadSupabase(weightTables({ meal_entries: ONE_ROW, ...over }));
      const facts = await loadHomeFacts(numericContext(client), NOW);
      expect(facts.milestone).toBeNull();
      expect(facts.hasAnyReport).toBe(true);
      expect(facts.offlinePeriods).toEqual([]);
    }
  });

  it("holds the invariant: a moment implies a ready context with a numeric goal", async () => {
    const fixtures: Array<[string, Record<string, unknown>]> = [
      ["numeric", {}],
      ["none", { goal_type: "none" }],
      ["behavioral", { goal_type: "behavioral" }],
      ["no goal weight", { goal_weight_kg: null }],
    ];
    for (const [name, over] of fixtures) {
      const { client } = createFakeReadSupabase(weightTables());
      const ctx = numericContext(client, over);
      const facts = await loadHomeFacts(ctx, NOW);
      if (facts.milestone !== null) {
        expect(ctx.kind, name).toBe("ready");
        expect(ctx.kind === "ready" && ctx.row.goal_type, name).toBe("numeric");
      }
    }
    for (const kind of ["not_configured", "signed_out", "unavailable", "profile_missing"] as const) {
      const { client } = createFakeReadSupabase(weightTables());
      const ctx = { kind, supabase: client, userId: USER } as unknown as OnboardingContext;
      expect((await loadHomeFacts(ctx, NOW)).milestone, kind).toBeNull();
    }
  });

  it("a FIRST_WEEK context with a numeric goal also reads the series, and its First Week facts are unchanged", async () => {
    const { client, queries } = createFakeReadSupabase({
      ...weightTables(),
      profiles: { rows: [{ first_week_started_at: "2027-01-04T10:00:00Z" }] },
      patterns: EMPTY,
      user_preferences: EMPTY,
    });
    const facts = await loadHomeFacts(numericContext(client, { lifecycle_state: "FIRST_WEEK" }), NOW);
    expect(facts.lifecycle).toBe("FIRST_WEEK");
    expect(facts.firstWeek).not.toBeNull();
    expect(shape(queries)).toContain(SERIES);
  });
});
