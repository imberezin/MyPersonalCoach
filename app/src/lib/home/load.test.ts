import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FALLBACK_TIME_ZONE, homePeriodsWindow } from "@/domain/home";
import { normalizeRow } from "@/domain/onboarding";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { createFakeReadSupabase, type FakeTable } from "./fakeReadSupabase";
import { REPORT_TABLES, loadHasAnyReport, loadHomeFacts, loadOfflinePeriods } from "./load";

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2027-01-09T16:00:00Z");

const EMPTY: FakeTable = { rows: [] };
const ONE_ROW: FakeTable = { rows: [{ id: "row-1" }] };
const FAILS: FakeTable = { error: { code: "42501" } };
const THROWS: FakeTable = "throw";

const SHABBAT_ROW = { type: "SHABBAT", start_at: "2027-01-08T14:10:00+00:00", end_at: "2027-01-09T15:25:00+00:00" };

const allReportTables = (answer: FakeTable) => Object.fromEntries(REPORT_TABLES.map((table) => [table, answer]));

function readyContext(supabase: SupabaseClient, timezone = "Asia/Jerusalem"): OnboardingContext {
  const row = normalizeRow({ lifecycle_state: "FIRST_WEEK", timezone }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase };
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
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

  it("makes exactly six queries: the periods and one probe per report table", async () => {
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
