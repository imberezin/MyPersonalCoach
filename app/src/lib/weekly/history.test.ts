import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeWeeklySupabase, type WeeklyConfig } from "./fakeWeeklySupabase";
import { HISTORY_COLUMNS, loadExperimentHistory } from "./history";

const USER = "00000000-0000-4000-8000-000000000001";
const PATTERN_ID = "7b0c9f4e-1a2b-4c3d-8e5f-0a1b2c3d4e5f";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "DONE",
  intervention_key: "eat_intentionally",
  variant: "default",
  source_pattern_id: PATTERN_ID,
  started_at: "2026-09-14T08:00:00Z",
  ended_at: "2026-09-21T06:00:00Z",
  helpfulness: "HELPFUL",
  tried: "YES",
  wording: "בארוחה הבאה",
  wording_source: "library",
  wording_locale: "he",
  ...over,
});

const load = (config: WeeklyConfig) => {
  const { client, calls } = createFakeWeeklySupabase({ experiments: config });
  return { run: () => loadExperimentHistory(client, USER), calls, client };
};

describe("loadExperimentHistory", () => {
  it("asks for the person's newest 20 experiments, newest first, with the columns the weekly loop needs", async () => {
    const { run, calls } = load({ rows: [] });
    await run();
    expect(calls).toEqual([
      {
        kind: "select",
        table: "experiments",
        columns: HISTORY_COLUMNS,
        filters: [["eq", "user_id", USER]],
        order: [{ column: "created_at", ascending: false }],
        limit: 20,
        values: undefined,
        options: undefined,
      },
    ]);
    expect(HISTORY_COLUMNS).toBe(
      "id, status, intervention_key, variant, source_pattern_id, started_at, ended_at, helpfulness, tried, wording, wording_source, wording_locale",
    );
  });

  it("maps a finished row to a record, with its key, answer and dates", async () => {
    const history = await load({ rows: [row()] }).run();
    expect(history?.records).toEqual([
      {
        id: "e1",
        status: "DONE",
        key: "eat_intentionally",
        variantId: "default",
        sourcePatternId: PATTERN_ID,
        startedAt: new Date("2026-09-14T08:00:00Z"),
        endedAt: new Date("2026-09-21T06:00:00Z"),
        helpfulness: "HELPFUL",
        tried: "YES",
      },
    ]);
    // A finished row is history, not the open experiment.
    expect(history?.open).toBeNull();
  });

  it("keeps the order it was given (newest first)", async () => {
    const history = await load({ rows: [row({ id: "new" }), row({ id: "old" })] }).run();
    expect(history?.records.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("tried NO keeps a null helpfulness (not applicable)", async () => {
    const history = await load({ rows: [row({ tried: "NO", helpfulness: null })] }).run();
    expect(history?.records[0]).toMatchObject({ tried: "NO", helpfulness: null });
  });

  it("an unknown status, a missing id and a non-object are dropped", async () => {
    const history = await load({ rows: [row({ status: "PAUSED" }), row({ id: "" }), row({ id: 7 }), "garbage", null, row({ id: "ok" })] }).run();
    expect(history?.records.map((r) => r.id)).toEqual(["ok"]);
  });

  it("a malformed date or answer drops the row (history is never guessed)", async () => {
    const history = await load({
      rows: [row({ id: "d1", ended_at: "last week" }), row({ id: "d2", started_at: 5 }), row({ id: "d3", helpfulness: "GREAT" }), row({ id: "d4", tried: "MAYBE" }), row({ id: "ok" })],
    }).run();
    expect(history?.records.map((r) => r.id)).toEqual(["ok"]);
  });

  it("a key outside the library keeps the row as history without a key", async () => {
    const history = await load({ rows: [row({ intervention_key: "not_a_habit" })] }).run();
    expect(history?.records[0]).toMatchObject({ id: "e1", key: null, variantId: "default" });
  });

  it("a missing variant is history without a variant", async () => {
    const history = await load({ rows: [row({ variant: null })] }).run();
    expect(history?.records[0]).toMatchObject({ key: "eat_intentionally", variantId: null });
  });

  it("a SKIPPED row keeps its ended_at and has no answer", async () => {
    const history = await load({ rows: [row({ status: "SKIPPED", started_at: null, helpfulness: null, tried: null })] }).run();
    expect(history?.records[0]).toMatchObject({ status: "SKIPPED", startedAt: null, endedAt: new Date("2026-09-21T06:00:00Z"), helpfulness: null, tried: null });
  });
});

describe("loadExperimentHistory: the open experiment", () => {
  const offered = (over: Record<string, unknown> = {}) => row({ id: "o1", status: "OFFERED", started_at: null, ended_at: null, helpfulness: null, tried: null, ...over });

  it("maps an OFFERED pattern-led row", async () => {
    const history = await load({ rows: [offered()] }).run();
    expect(history?.open).toEqual({
      id: "o1",
      status: "OFFERED",
      key: "eat_intentionally",
      variantId: "default",
      origin: "pattern",
      wording: "בארוחה הבאה",
      source: "library",
      locale: "he",
      startedAt: null,
    });
    expect(history?.records[0]).toMatchObject({ id: "o1", status: "OFFERED" });
  });

  it("origin is starter exactly when there is no source pattern", async () => {
    const history = await load({ rows: [offered({ source_pattern_id: null })] }).run();
    expect(history?.open?.origin).toBe("starter");
    expect(history?.records[0].sourcePatternId).toBeNull();
  });

  it("an ACTIVE row carries its start", async () => {
    const history = await load({ rows: [offered({ status: "ACTIVE", started_at: "2026-09-22T07:00:00Z", wording_source: "ai", wording_locale: "en" })] }).run();
    expect(history?.open).toMatchObject({ status: "ACTIVE", startedAt: new Date("2026-09-22T07:00:00Z"), source: "ai", locale: "en" });
  });

  it("the newest open row wins", async () => {
    const history = await load({ rows: [offered({ id: "newest" }), offered({ id: "older" })] }).run();
    expect(history?.open?.id).toBe("newest");
  });

  it.each([
    ["no wording", { wording: null }],
    ["an empty wording", { wording: "" }],
    ["an unknown wording source", { wording_source: "robot" }],
    ["an unknown locale", { wording_locale: "fr" }],
    ["a key outside the library", { intervention_key: "nope" }],
    ["no variant", { variant: null }],
  ])("%s: the row stays a record but is not an openable experiment", async (_name, over) => {
    const history = await load({ rows: [offered(over)] }).run();
    expect(history?.records).toHaveLength(1);
    expect(history?.open).toBeNull();
  });

  it("finished and skipped rows are never the open experiment", async () => {
    const history = await load({ rows: [row({ status: "DONE" }), row({ id: "s", status: "SKIPPED" })] }).run();
    expect(history?.open).toBeNull();
  });
});

describe("loadExperimentHistory: unknown", () => {
  it.each([
    ["a database error", { error: { code: "42703" } }],
    ["a network failure", "throw" as const],
    ["an answer that is not a list", { data: null }],
  ])("%s is null", async (_name, answer) => {
    expect(await load(answer as WeeklyConfig).run()).toBeNull();
  });

  it("a client that throws is null", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof loadExperimentHistory>[0];
    expect(await loadExperimentHistory(broken, USER)).toBeNull();
  });

  it("an empty table is an empty history, not unknown", async () => {
    expect(await load({ rows: [] }).run()).toEqual({ records: [], open: null });
  });

  it("logs only a code", async () => {
    await load({ error: { code: "42703", message: `for ${USER}` } }).run();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(USER);
  });
});
