import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_WEEK_LIMITS, FIRST_WEEK_SNOOZE } from "@/domain/firstWeekFlow";
import { createFakeReadSupabase, type FakeTable } from "@/lib/home/fakeReadSupabase";
import { EXPERIMENT_COLUMNS } from "./repo";
import { loadActiveExperimentCard } from "./home";

// The switch is read at call time, so one mutable stand-in serves every case. It ships OFF; this file runs it both ways.
const features = vi.hoisted(() => ({ firstReportInvitation: true, activeExperimentCard: true }));
vi.mock("@/domain/home/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/home/types")>()),
  HOME_FEATURES: features,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const TZ = "Asia/Jerusalem";
const NOW = new Date("2027-01-12T10:00:00Z"); // Tuesday 12:00 local (UTC+2)
const LOCAL_MIDNIGHT = "2027-01-11T22:00:00.000Z";
const SENTENCE = "בארוחה הבאה — שב וקח כמה דקות בלי מסך.";

const row = (over: Record<string, unknown> = {}) => ({
  id: "9c9c9c9c-1111-4222-8333-444444444444",
  status: "ACTIVE",
  source_pattern_id: "7b0c9f4e-1a2b-4c3d-8e5f-0a1b2c3d4e5f",
  intervention_key: "eat_intentionally",
  variant: "default",
  wording: SENTENCE,
  wording_source: "library",
  wording_locale: "he",
  ended_at: null,
  ...over,
});
const thanks = (occurred_at: string, card: unknown = "experiment") => ({ payload: { card }, occurred_at });

const EMPTY: FakeTable = { rows: [] };
const FAILS: FakeTable = { error: { code: "42501", message: SENTENCE } };
const THROWS: FakeTable = "throw";

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  features.activeExperimentCard = true;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadActiveExperimentCard", () => {
  it("the switch off: null with ZERO queries, whatever is stored", async () => {
    features.activeExperimentCard = false;
    const { client, queries } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: EMPTY });
    expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).toBeNull();
    expect(queries).toEqual([]);
  });

  it("an active experiment with no Thanks today is the fact: the stored sentence, the key, the variant and the language, nothing else", async () => {
    const { client } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: EMPTY });
    const fact = await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW });
    expect(fact).toEqual({ key: "eat_intentionally", variantId: "default", wording: SENTENCE, locale: "he" });
  });

  it("hands over the AI's validated wording as stored, in its own language", async () => {
    const { client } = createFakeReadSupabase({
      experiments: { rows: [row({ wording: "At your next meal, sit down.", wording_source: "ai", wording_locale: "en" })] },
      events: EMPTY,
    });
    expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).toMatchObject({ wording: "At your next meal, sit down.", locale: "en" });
  });

  it("makes exactly two bounded reads: the one ACTIVE row, then today's Thanks events", async () => {
    const { client, queries } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: EMPTY });
    await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW });
    expect(queries).toEqual([
      {
        table: "experiments",
        columns: EXPERIMENT_COLUMNS,
        filters: [
          ["eq", "user_id", USER],
          ["eq", "status", "ACTIVE"],
        ],
        order: { column: "created_at", ascending: false },
        limit: 1,
      },
      {
        table: "events",
        columns: "payload, occurred_at",
        filters: [
          ["eq", "user_id", USER],
          ["eq", "name", FIRST_WEEK_SNOOZE.event],
          ["gte", "occurred_at", LOCAL_MIDNIGHT],
        ],
        order: { column: "occurred_at", ascending: false },
        limit: FIRST_WEEK_LIMITS.snoozeQuery,
      },
    ]);
  });

  it("a person with no active experiment pays ONE query and the snooze is never read", async () => {
    const { client, queries } = createFakeReadSupabase({ experiments: EMPTY, events: { rows: [thanks("2027-01-12T08:00:00Z")] } });
    expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).toBeNull();
    expect(queries.map((q) => q.table)).toEqual(["experiments"]);
  });

  it("starts the day at the person's local midnight, in their zone", async () => {
    const utc = createFakeReadSupabase({ experiments: { rows: [row()] }, events: EMPTY });
    await loadActiveExperimentCard(utc.client, USER, { timeZone: "UTC", now: NOW });
    expect(utc.queries[1].filters[2]).toEqual(["gte", "occurred_at", "2027-01-12T00:00:00.000Z"]);

    const garbage = createFakeReadSupabase({ experiments: { rows: [row()] }, events: EMPTY });
    await loadActiveExperimentCard(garbage.client, USER, { timeZone: "Not/AZone", now: NOW });
    expect(garbage.queries[1].filters[2]).toEqual(["gte", "occurred_at", LOCAL_MIDNIGHT]);
  });

  describe("Thanks hides the card for the rest of the local day", () => {
    it.each([
      ["a minute ago", "2027-01-12T09:59:00Z"],
      ["this morning", "2027-01-12T05:00:00Z"],
      ["just after local midnight", "2027-01-11T22:01:00Z"],
      ["at local midnight", LOCAL_MIDNIGHT],
    ])("a press %s: no card", async (_name, at) => {
      const { client } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: { rows: [thanks(at)] } });
      expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).toBeNull();
    });

    it("a press of yesterday evening (even less than 24 hours ago) does not hide it", async () => {
      const { client } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: { rows: [thanks("2027-01-11T21:59:00Z")] } });
      expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).not.toBeNull();
    });

    it("another card's press, an odd payload or an unreadable date does not hide it", async () => {
      const rows = [
        thanks("2027-01-12T08:00:00Z", "summary"),
        thanks("2027-01-12T08:00:00Z", "welcome_back"),
        { payload: null, occurred_at: "2027-01-12T08:00:00Z" },
        { payload: "experiment", occurred_at: "2027-01-12T08:00:00Z" },
        { payload: { card: "experiment" }, occurred_at: "nope" },
        { payload: { card: "experiment" }, occurred_at: 7 },
        null,
        "row",
      ];
      const { client } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: { rows } });
      expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).not.toBeNull();
    });

    it("the First Week's own snooze events share the table and the name, and stay out of the way", async () => {
      const { client } = createFakeReadSupabase({
        experiments: { rows: [row()] },
        events: { rows: [thanks("2027-01-12T09:00:00Z", "summary"), thanks("2027-01-12T08:00:00Z")] },
      });
      expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).toBeNull();
    });
  });

  describe("unknown is no card, and nothing throws", () => {
    it.each([
      ["a failing experiments read", { experiments: FAILS, events: EMPTY }],
      ["a throwing experiments read", { experiments: THROWS, events: EMPTY }],
      ["a failing snooze read", { experiments: { rows: [row()] }, events: FAILS }],
      ["a throwing snooze read", { experiments: { rows: [row()] }, events: THROWS }],
      ["an active row without a readable sentence", { experiments: { rows: [row({ wording: "" })] }, events: EMPTY }],
      ["an active row with a key outside the library", { experiments: { rows: [row({ intervention_key: "toString" })] }, events: EMPTY }],
      ["a row that is not active", { experiments: { rows: [row({ status: "OFFERED" })] }, events: EMPTY }],
    ])("%s", async (_name, tables) => {
      const { client } = createFakeReadSupabase(tables);
      expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW })).toBeNull();
    });

    it("a client that throws and an instant that cannot be formatted", async () => {
      const broken = {
        from() {
          throw new Error("boom");
        },
      } as never;
      expect(await loadActiveExperimentCard(broken, USER, { timeZone: TZ, now: NOW })).toBeNull();
      const { client, queries } = createFakeReadSupabase({ experiments: { rows: [row()] }, events: EMPTY });
      expect(await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: new Date("nope") })).toBeNull();
      expect(queries).toEqual([]);
    });

    it("logs only codes: never the sentence, the user or a row", async () => {
      for (const tables of [{ experiments: FAILS, events: EMPTY }, { experiments: { rows: [row()] }, events: FAILS }]) {
        const { client } = createFakeReadSupabase(tables);
        await loadActiveExperimentCard(client, USER, { timeZone: TZ, now: NOW });
      }
      const logged = JSON.stringify(errorLog.mock.calls);
      expect(errorLog).toHaveBeenCalled();
      expect(logged).not.toContain(SENTENCE);
      expect(logged).not.toContain(USER);
    });
  });
});
