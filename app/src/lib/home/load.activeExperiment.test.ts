import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHome } from "@/domain/home";
import { normalizeRow } from "@/domain/onboarding";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { createFakeReadSupabase, type FakeTable } from "./fakeReadSupabase";
import { REPORT_TABLES, loadHomeFacts } from "./load";

// The switch ships OFF; this file runs the loader with it ON and, where it says so, OFF. One mutable stand-in serves every case.
const features = vi.hoisted(() => ({ firstReportInvitation: true, activeExperimentCard: true }));
vi.mock("@/domain/home/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/home/types")>()),
  HOME_FEATURES: features,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2027-01-14T10:00:00Z"); // Thursday 12:00 in Jerusalem: outside the weekly card window (Sunday to Wednesday), before Shabbat
const SENTENCE = "בארוחה הבאה — שב וקח כמה דקות בלי מסך.";

const EMPTY: FakeTable = { rows: [] };
const ONE_ROW: FakeTable = { rows: [{ id: "row-1" }] };
const FAILS: FakeTable = { error: { code: "42501" } };
const reportTables = (answer: FakeTable) => Object.fromEntries(REPORT_TABLES.map((table) => [table, answer]));

const ACTIVE_ROW = {
  id: "9c9c9c9c-1111-4222-8333-444444444444",
  status: "ACTIVE",
  source_pattern_id: null,
  intervention_key: "eat_intentionally",
  variant: "default",
  wording: SENTENCE,
  wording_source: "library",
  wording_locale: "he",
  ended_at: null,
};
const DEFAULT_QUIET: FakeTable = { rows: [{ quiet_hours_start: "00:00:00", quiet_hours_end: "08:00:00" }] };

function context(supabase: SupabaseClient, lifecycle = "WEEKLY_CYCLE"): OnboardingContext {
  const row = normalizeRow({ lifecycle_state: lifecycle, timezone: "Asia/Jerusalem" }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase };
}

const tables = (over: Record<string, FakeTable> = {}): Record<string, FakeTable> => ({
  offline_periods: EMPTY,
  ...reportTables(ONE_ROW),
  experiments: { rows: [ACTIVE_ROW] },
  events: EMPTY,
  user_preferences: DEFAULT_QUIET,
  ...over,
});

beforeEach(() => {
  features.activeExperimentCard = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadHomeFacts: the active-experiment fact", () => {
  it("an active experiment with no Thanks today is the fact, and the quiet hours are read as a second stage", async () => {
    const { client, queries } = createFakeReadSupabase(tables());
    const facts = await loadHomeFacts(context(client), NOW);

    expect(facts.activeExperiment).toEqual({ key: "eat_intentionally", variantId: "default", wording: SENTENCE, locale: "he" });
    expect(facts.quietHours).toEqual({ kind: "WINDOW", startMinute: 0, endMinute: 480 });
    expect(queries.map((q) => q.table).sort()).toEqual(["events", "experiments", "offline_periods", "user_preferences", ...REPORT_TABLES].sort());
  });

  it("the real resolver turns it into the card at noon, and into the calm clock before the quiet hours end", async () => {
    const noon = await loadHomeFacts(context(createFakeReadSupabase(tables()).client), NOW);
    expect(resolveHome(noon).state).toEqual({ key: "ACTIVE_EXPERIMENT", experiment: noon.activeExperiment });
    expect(resolveHome(noon).action).toEqual({ kind: "THANK_ACTIVE_EXPERIMENT" });

    const dawn = new Date("2027-01-14T04:00:00Z"); // 06:00 local: inside the default quiet hours
    const early = await loadHomeFacts(context(createFakeReadSupabase(tables()).client), dawn);
    expect(early.activeExperiment).not.toBeNull();
    expect(resolveHome(early).state.key).toBe("MORNING");
  });

  it("no active experiment: no snooze read and no quiet-hours read, the fact is null", async () => {
    const { client, queries } = createFakeReadSupabase(tables({ experiments: EMPTY }));
    const facts = await loadHomeFacts(context(client), NOW);
    expect(facts.activeExperiment).toBeNull();
    expect(facts.quietHours).toBeNull();
    expect(queries.map((q) => q.table)).not.toContain("events");
    expect(queries.map((q) => q.table)).not.toContain("user_preferences");
  });

  it("a Thanks pressed today: the fact is null and the quiet hours are not read", async () => {
    const thanks = { payload: { card: "experiment" }, occurred_at: "2027-01-14T08:00:00Z" };
    const { client, queries } = createFakeReadSupabase(tables({ events: { rows: [thanks] } }));
    const facts = await loadHomeFacts(context(client), NOW);
    expect(facts.activeExperiment).toBeNull();
    expect(facts.quietHours).toBeNull();
    expect(queries.map((q) => q.table)).not.toContain("user_preferences");
  });

  it("unknown quiet hours stay null, and Home says nothing rather than guess", async () => {
    const facts = await loadHomeFacts(context(createFakeReadSupabase(tables({ user_preferences: FAILS })).client), NOW);
    expect(facts.activeExperiment).not.toBeNull();
    expect(facts.quietHours).toBeNull();
    expect(resolveHome(facts).state).toEqual({ key: "SILENCE", reason: "NOTHING_TO_SAY" });
    expect(resolveHome(facts).degraded).toBe(false);
  });

  it("a failing experiments read is null, leaves every other fact intact and does not make Home degraded", async () => {
    const facts = await loadHomeFacts(context(createFakeReadSupabase(tables({ experiments: FAILS })).client), NOW);
    expect(facts.activeExperiment).toBeNull();
    expect(facts.offlinePeriods).toEqual([]);
    expect(facts.hasAnyReport).toBe(true);
    expect(resolveHome(facts).degraded).toBe(false);
  });

  it("a failing snooze read is null too (this card is optional)", async () => {
    const facts = await loadHomeFacts(context(createFakeReadSupabase(tables({ events: FAILS })).client), NOW);
    expect(facts.activeExperiment).toBeNull();
    expect(facts.hasAnyReport).toBe(true);
  });

  it("the switch off: not one query to experiments, events or user_preferences, and the fact is null", async () => {
    features.activeExperimentCard = false;
    const { client, queries } = createFakeReadSupabase(tables());
    const facts = await loadHomeFacts(context(client), NOW);
    expect(facts.activeExperiment).toBeNull();
    expect(queries.map((q) => q.table).sort()).toEqual(["offline_periods", ...REPORT_TABLES].sort());
    expect(resolveHome(facts).state.key).not.toBe("ACTIVE_EXPERIMENT");
  });

  it.each(["FIRST_WEEK", "ONBOARDING"])("a %s context never reads the experiment, even with the switch on", async (lifecycle) => {
    const { client, queries } = createFakeReadSupabase(tables({ first_week_progress: EMPTY, meal_entries: EMPTY }));
    const facts = await loadHomeFacts(context(client, lifecycle), NOW);
    expect(facts.activeExperiment).toBeNull();
    expect(queries.every((q) => q.table !== "experiments")).toBe(true);
  });

  it("holds the invariant: an experiment fact implies the WEEKLY_CYCLE lifecycle", async () => {
    for (const lifecycle of ["FIRST_WEEK", "WEEKLY_CYCLE"]) {
      const facts = await loadHomeFacts(context(createFakeReadSupabase(tables()).client, lifecycle), NOW);
      if (facts.activeExperiment !== null) expect(facts.lifecycle).toBe("WEEKLY_CYCLE");
    }
  });
});
