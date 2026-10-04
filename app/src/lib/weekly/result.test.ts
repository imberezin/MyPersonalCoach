import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentResult } from "@/domain/weekly";
import { createFakeWeeklySupabase, type WeeklyConfig } from "./fakeWeeklySupabase";
import { recordExperimentResult } from "./result";

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-20T07:30:00.000Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const withExperiments = (config: WeeklyConfig) => createFakeWeeklySupabase({ experiments: config });
const ROW = { intervention_key: "eat_intentionally", wording_source: "ai" };

describe("recordExperimentResult", () => {
  it.each<[ExperimentResult, { tried: string; helpfulness: string | null }]>([
    ["helpful", { tried: "YES", helpfulness: "HELPFUL" }],
    ["somewhat", { tried: "YES", helpfulness: "SOMEWHAT" }],
    ["not_really", { tried: "YES", helpfulness: "NOT_REALLY" }],
    ["unknown", { tried: "YES", helpfulness: "UNKNOWN" }],
    // Not applicable, which is NOT "I do not know": the helpfulness stays null.
    ["not_tried", { tried: "NO", helpfulness: null }],
  ])("%s sends the exact patch, filtered to the person's ACTIVE row, and asks for the key and the source", async (result, answer) => {
    const { client, calls } = withExperiments({ rows: [ROW] });
    await recordExperimentResult(client, USER, { result, now: NOW });

    expect(calls).toEqual([
      {
        kind: "update",
        table: "experiments",
        columns: "intervention_key, wording_source",
        filters: [
          ["eq", "user_id", USER],
          ["eq", "status", "ACTIVE"],
        ],
        order: [],
        values: { status: "DONE", ended_at: "2026-09-20T07:30:00.000Z", ...answer },
        options: undefined,
      },
    ]);
    expect(calls[0].values).toHaveProperty("helpfulness", answer.helpfulness);
  });

  it("1 row is changed, with the experiment's key and the source of its wording", async () => {
    expect(await recordExperimentResult(withExperiments({ rows: [ROW] }).client, USER, { result: "helpful", now: NOW })).toEqual({
      ok: true,
      value: { changed: true, key: "eat_intentionally", source: "ai" },
    });
    const library = withExperiments({ rows: [{ intervention_key: "slow_down", wording_source: "library" }] });
    expect(await recordExperimentResult(library.client, USER, { result: "helpful", now: NOW })).toEqual({
      ok: true,
      value: { changed: true, key: "slow_down", source: "library" },
    });
  });

  it("a row with unreadable columns is still changed, with null key and source", async () => {
    const odd = withExperiments({ rows: [{ intervention_key: 7, wording_source: "?" }] });
    expect(await recordExperimentResult(odd.client, USER, { result: "helpful", now: NOW })).toEqual({
      ok: true,
      value: { changed: true, key: null, source: null },
    });
  });

  it("0 rows (already answered, skipped or gone) is unchanged, which is not an error", async () => {
    expect(await recordExperimentResult(withExperiments({ rows: [] }).client, USER, { result: "helpful", now: NOW })).toEqual({
      ok: true,
      value: { changed: false, key: null, source: null },
    });
  });

  it.each([
    ["a database error", { error: { code: "23514" } }],
    ["a network failure", "throw" as const],
    ["an answer that is not a list", { data: null }],
  ])("%s is { ok: false }", async (_name, answer) => {
    expect(await recordExperimentResult(withExperiments(answer as WeeklyConfig).client, USER, { result: "helpful", now: NOW })).toEqual({ ok: false });
  });

  it("an answer outside the five is { ok: false } and sends nothing", async () => {
    const { client, calls } = withExperiments({ rows: [ROW] });
    expect(await recordExperimentResult(client, USER, { result: "great" as ExperimentResult, now: NOW })).toEqual({ ok: false });
    expect(calls).toEqual([]);
  });

  it("an invalid instant is { ok: false } and sends nothing", async () => {
    const { client, calls } = withExperiments({ rows: [ROW] });
    expect(await recordExperimentResult(client, USER, { result: "helpful", now: new Date(Number.NaN) })).toEqual({ ok: false });
    expect(calls).toEqual([]);
  });

  it("a client that throws is { ok: false }", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof recordExperimentResult>[0];
    expect(await recordExperimentResult(broken, USER, { result: "helpful", now: NOW })).toEqual({ ok: false });
  });

  it("logs only a code", async () => {
    await recordExperimentResult(withExperiments({ error: { code: "23514", message: `for ${USER}` } }).client, USER, { result: "helpful", now: NOW });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(USER);
  });
});
