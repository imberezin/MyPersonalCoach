import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeWriteSupabase, type FakeWriteAnswer } from "@/lib/patterns/fakeWriteSupabase";
import {
  EXPERIMENT_COLUMNS,
  insertOfferedExperiment,
  loadExperiments,
  skipExperiment,
  startExperiment,
  upgradeOfferedWording,
} from "./repo";

const USER = "00000000-0000-4000-8000-000000000001";
const PATTERN_ID = "7b0c9f4e-1a2b-4c3d-8e5f-0a1b2c3d4e5f";
const EXP_ID = "9c9c9c9c-1111-4222-8333-444444444444";
const NOW = new Date("2026-10-12T09:30:00.000Z");
const TEXT = "בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך.";

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: EXP_ID,
  status: "OFFERED",
  source_pattern_id: PATTERN_ID,
  intervention_key: "eat_intentionally",
  variant: "default",
  wording: TEXT,
  wording_source: "library",
  wording_locale: "he",
  ended_at: null,
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const withTable = (answers: Partial<Record<"select" | "insert" | "update", FakeWriteAnswer>>) => createFakeWriteSupabase({ tables: { experiments: answers } });
const broken = {
  from() {
    throw new Error("boom");
  },
} as unknown as SupabaseClient;

describe("loadExperiments", () => {
  it("asks for the person's rows, newest first, at most 20", async () => {
    const { client, queries } = withTable({ select: { rows: [] } });
    await loadExperiments(client, USER);
    expect(queries).toEqual([
      {
        kind: "query",
        table: "experiments",
        op: "select",
        columns: EXPERIMENT_COLUMNS,
        filters: [["eq", "user_id", USER]],
        order: { column: "created_at", ascending: false },
        limit: 20,
      },
    ]);
    expect(EXPERIMENT_COLUMNS).toBe("id, status, source_pattern_id, intervention_key, variant, wording, wording_source, wording_locale, ended_at");
  });

  it("maps rows to facts and finds the open one with its stored wording", async () => {
    const { client } = withTable({
      select: {
        rows: [
          dbRow(),
          dbRow({ id: "s1", status: "SKIPPED", ended_at: "2026-10-01T10:00:00Z", wording: null, wording_source: null, wording_locale: null, variant: null }),
        ],
      },
    });
    const loaded = await loadExperiments(client, USER);
    expect(loaded?.facts).toEqual([
      { id: EXP_ID, status: "OFFERED", sourcePatternId: PATTERN_ID, endedAt: null },
      { id: "s1", status: "SKIPPED", sourcePatternId: PATTERN_ID, endedAt: new Date("2026-10-01T10:00:00Z") },
    ]);
    expect(loaded?.open).toEqual({
      id: EXP_ID,
      status: "OFFERED",
      key: "eat_intentionally",
      variantId: "default",
      wording: TEXT,
      source: "library",
      locale: "he",
    });
  });

  it("an ACTIVE row is the open one too, with the AI's text", async () => {
    const { client } = withTable({ select: { rows: [dbRow({ status: "ACTIVE", wording_source: "ai", wording_locale: "en", wording: "At your next meal, sit down." })] } });
    const loaded = await loadExperiments(client, USER);
    expect(loaded?.open).toMatchObject({ status: "ACTIVE", source: "ai", locale: "en", wording: "At your next meal, sit down." });
  });

  it("no open experiment: open is null", async () => {
    const { client } = withTable({ select: { rows: [dbRow({ status: "DONE" }), dbRow({ id: "x", status: "SKIPPED", ended_at: "2026-10-01T10:00:00Z" })] } });
    expect((await loadExperiments(client, USER))?.open).toBeNull();
  });

  it("an open row without a readable wording stays a fact (the selection still sees it) but gives no text", async () => {
    const { client } = withTable({ select: { rows: [dbRow({ wording: null, wording_source: null, wording_locale: null })] } });
    const loaded = await loadExperiments(client, USER);
    expect(loaded?.facts).toHaveLength(1);
    expect(loaded?.open).toBeNull();
  });

  it("drops rows it cannot read instead of guessing", async () => {
    const { client } = withTable({
      select: {
        rows: [dbRow({ status: "RUNNING" }), dbRow({ id: null }), dbRow({ id: "" }), dbRow({ id: "e", ended_at: "later" }), null, "row", dbRow({ id: "ok" })],
      },
    });
    expect((await loadExperiments(client, USER))?.facts.map((f) => f.id)).toEqual(["ok"]);
  });

  it("an unknown intervention key gives no open text (the library would not know it)", async () => {
    const { client } = withTable({ select: { rows: [dbRow({ intervention_key: "toString" })] } });
    expect((await loadExperiments(client, USER))?.open).toBeNull();
  });

  it("an error, a throw and a client that throws are unknown", async () => {
    expect(await loadExperiments(withTable({ select: { error: { code: "42501" } } }).client, USER)).toBeNull();
    expect(await loadExperiments(withTable({ select: "throw" }).client, USER)).toBeNull();
    expect(await loadExperiments(broken, USER)).toBeNull();
  });
});

describe("insertOfferedExperiment", () => {
  const input = { patternId: PATTERN_ID, key: "eat_intentionally", variantId: "default", libraryText: TEXT, locale: "he" } as const;

  it("inserts exactly the OFFERED row with the LIBRARY text and no started_at", async () => {
    const { client, queries } = withTable({ insert: { rows: [{ id: EXP_ID }] } });
    const result = await insertOfferedExperiment(client, input);

    expect(result).toEqual({ ok: true, value: { id: EXP_ID, created: true } });
    expect(queries).toEqual([
      {
        kind: "query",
        table: "experiments",
        op: "insert",
        columns: "id",
        payload: {
          source_pattern_id: PATTERN_ID,
          intervention_key: "eat_intentionally",
          variant: "default",
          status: "OFFERED",
          wording: TEXT,
          wording_source: "library",
          wording_locale: "he",
        },
        filters: [],
      },
    ]);
    expect(queries[0].payload).not.toHaveProperty("started_at");
  });

  it("a weekly starter offer has no pattern: patternId null is written as source_pattern_id null", async () => {
    const { client, queries } = withTable({ insert: { rows: [{ id: EXP_ID }] } });
    const result = await insertOfferedExperiment(client, { ...input, patternId: null });

    expect(result).toEqual({ ok: true, value: { id: EXP_ID, created: true } });
    expect(queries[0].payload).toMatchObject({ source_pattern_id: null, status: "OFFERED", wording_source: "library" });
    expect(queries[0].payload).toHaveProperty("source_pattern_id", null);
  });

  it("a unique violation is a double tap or another tab: the existing open row's id, created: false", async () => {
    const { client, queries } = withTable({
      insert: { error: { code: "23505" } },
      select: { rows: [{ id: "existing-id" }] },
    });
    const result = await insertOfferedExperiment(client, input);

    expect(result).toEqual({ ok: true, value: { id: "existing-id", created: false } });
    expect(queries[1]).toMatchObject({ op: "select", columns: "id", filters: [["in", "status", ["OFFERED", "ACTIVE"]]], limit: 1 });
  });

  it("a unique violation with no open row to find is unavailable", async () => {
    const { client } = withTable({ insert: { error: { code: "23505" } }, select: { rows: [] } });
    expect(await insertOfferedExperiment(client, input)).toEqual({ ok: false, code: "unavailable" });
  });

  it.each([
    ["another database error", { insert: { error: { code: "42501" } } }],
    ["a network failure", { insert: "throw" as const }],
    ["an answer without an id", { insert: { rows: [] } }],
  ])("%s is unavailable", async (_name, answers) => {
    expect(await insertOfferedExperiment(withTable(answers).client, input)).toEqual({ ok: false, code: "unavailable" });
  });

  it("a client that throws is unavailable", async () => {
    expect(await insertOfferedExperiment(broken, input)).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("upgradeOfferedWording", () => {
  it("replaces the text of the person's OFFERED row that still carries the library text, nothing else", async () => {
    const { client, queries } = withTable({ update: { rows: [{ id: EXP_ID }] } });
    const result = await upgradeOfferedWording(client, USER, { text: "A calmer sentence.", locale: "en" });

    expect(result).toEqual({ ok: true, value: { changed: true } });
    expect(queries).toEqual([
      {
        kind: "query",
        table: "experiments",
        op: "update",
        columns: "id",
        payload: { wording: "A calmer sentence.", wording_source: "ai", wording_locale: "en" },
        filters: [
          ["eq", "user_id", USER],
          ["eq", "status", "OFFERED"],
          ["eq", "wording_source", "library"],
        ],
      },
    ]);
  });

  it("0 rows (skipped, started or already upgraded) is changed: false, not an error", async () => {
    expect(await upgradeOfferedWording(withTable({ update: { rows: [] } }).client, USER, { text: "x", locale: "he" })).toEqual({
      ok: true,
      value: { changed: false },
    });
  });

  it("an error or a throw is not ok", async () => {
    expect(await upgradeOfferedWording(withTable({ update: { error: { code: "23514" } } }).client, USER, { text: "x", locale: "he" })).toEqual({ ok: false, code: "unavailable" });
    expect(await upgradeOfferedWording(withTable({ update: "throw" }).client, USER, { text: "x", locale: "he" })).toEqual({ ok: false, code: "unavailable" });
    expect(await upgradeOfferedWording(broken, USER, { text: "x", locale: "he" })).toEqual({ ok: false, code: "unavailable" });
  });
});

describe.each([
  ["startExperiment", startExperiment, { status: "ACTIVE", started_at: NOW.toISOString() }],
  ["skipExperiment", skipExperiment, { status: "SKIPPED", ended_at: NOW.toISOString() }],
] as const)("%s", (_name, fn, patch) => {
  it("moves the person's OFFERED row with the passed instant, and only an OFFERED one", async () => {
    const { client, queries } = withTable({ update: { rows: [{ id: EXP_ID }] } });
    expect(await fn(client, USER, NOW)).toEqual({ ok: true, value: { changed: true } });
    expect(queries).toEqual([
      {
        kind: "query",
        table: "experiments",
        op: "update",
        columns: "id",
        payload: patch,
        filters: [
          ["eq", "user_id", USER],
          ["eq", "status", "OFFERED"],
        ],
      },
    ]);
  });

  it("0 rows (already done, or nothing offered, as on the real account today) is changed: false", async () => {
    expect(await fn(withTable({ update: { rows: [] } }).client, USER, NOW)).toEqual({ ok: true, value: { changed: false } });
  });

  it("an error, a throw and a client that throws are not ok", async () => {
    expect(await fn(withTable({ update: { error: { code: "42501" } } }).client, USER, NOW)).toEqual({ ok: false, code: "unavailable" });
    expect(await fn(withTable({ update: "throw" }).client, USER, NOW)).toEqual({ ok: false, code: "unavailable" });
    expect(await fn(broken, USER, NOW)).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("the repository's rules", () => {
  it("never uses the admin client", () => {
    const text = readFileSync(join(process.cwd(), "src", "lib", "experiments", "repo.ts"), "utf8");
    expect(text).not.toMatch(/supabase\/admin|createAdminClient/);
  });
});
