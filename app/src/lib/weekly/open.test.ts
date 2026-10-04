import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeWeeklySupabase, type WeeklyConfig } from "./fakeWeeklySupabase";
import { openWeeklyStory, upgradeWeeklyLine } from "./open";

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-20T07:30:00.000Z");
const WEEK = "2026-09-13";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const withTable = (config: WeeklyConfig) => createFakeWeeklySupabase({ weekly_summaries: config });
const open = (client: ReturnType<typeof withTable>["client"], mode: "LEARN" | "CELEBRATE" | "RECOVER" | "RESET" = "LEARN") =>
  openWeeklyStory(client, { userId: USER, weekStart: WEEK, mode, now: NOW });

describe("openWeeklyStory", () => {
  it("sends the exact upsert: the conflict key, ignoreDuplicates, an explicit generated_at and viewed_at, content { v: 1 }", async () => {
    const { client, calls } = withTable({ rows: [{ id: "w1" }] });
    await open(client, "CELEBRATE");

    expect(calls).toEqual([
      {
        kind: "upsert",
        table: "weekly_summaries",
        columns: "id",
        filters: [],
        order: [],
        values: {
          user_id: USER,
          week_start: WEEK,
          opening_mode: "CELEBRATE",
          content: { v: 1 },
          generated_at: "2026-09-20T07:30:00.000Z",
          viewed_at: "2026-09-20T07:30:00.000Z",
        },
        options: { onConflict: "user_id,week_start", ignoreDuplicates: true },
      },
    ]);
  });

  it("a returned row is created: true", async () => {
    expect(await open(withTable({ rows: [{ id: "w1" }] }).client)).toEqual({ ok: true, value: { created: true } });
  });

  it("an empty answer (on conflict do nothing) is created: false", async () => {
    expect(await open(withTable({ rows: [] }).client)).toEqual({ ok: true, value: { created: false } });
  });

  it("a unique violation is created: false too", async () => {
    expect(await open(withTable({ error: { code: "23505" } }).client)).toEqual({ ok: true, value: { created: false } });
  });

  it.each([
    ["another database error", { error: { code: "42501" } }],
    ["a network failure", "throw" as const],
    ["an answer that is not a list", { data: "nope" }],
  ])("%s is { ok: false }", async (_name, answer) => {
    expect(await open(withTable(answer as WeeklyConfig).client)).toEqual({ ok: false });
  });

  it("a client that throws is { ok: false }", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof openWeeklyStory>[0];
    expect(await openWeeklyStory(broken, { userId: USER, weekStart: WEEK, mode: "LEARN", now: NOW })).toEqual({ ok: false });
  });

  it("an invalid instant is { ok: false } and sends nothing", async () => {
    const { client, calls } = withTable({ rows: [{ id: "w1" }] });
    expect(await openWeeklyStory(client, { userId: USER, weekStart: WEEK, mode: "LEARN", now: new Date(Number.NaN) })).toEqual({ ok: false });
    expect(calls).toEqual([]);
  });

  it("logs only a code, never the user id or the week", async () => {
    const spy = vi.mocked(console.error);
    await open(withTable({ error: { code: "42501", message: `row for ${USER}` } }).client);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(USER);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(WEEK);
  });
});

describe("upgradeWeeklyLine", () => {
  const line = { text: "עוד חלק קטן נכנס לתמונה.", locale: "he", mode: "LEARN", key: "learn" } as const;

  it("sends one UPDATE of content, filtered to the person's own row of that week, and nothing else", async () => {
    const { client, calls } = withTable({ rows: [{ id: "w1" }] });
    const result = await upgradeWeeklyLine(client, { userId: USER, weekStart: WEEK, line });

    expect(result).toEqual({ ok: true, value: { changed: true } });
    expect(calls).toEqual([
      {
        kind: "update",
        table: "weekly_summaries",
        columns: "id",
        filters: [
          ["eq", "user_id", USER],
          ["eq", "week_start", WEEK],
        ],
        order: [],
        values: { content: { v: 1, line: { text: line.text, locale: "he", source: "ai", mode: "LEARN", key: "learn" } } },
        options: undefined,
      },
    ]);
    // The opening mode and the timestamps are not part of the patch.
    expect(Object.keys(calls[0].values as object)).toEqual(["content"]);
  });

  it("0 rows (the row was erased with its source meanwhile) is changed: false", async () => {
    expect(await upgradeWeeklyLine(withTable({ rows: [] }).client, { userId: USER, weekStart: WEEK, line })).toEqual({ ok: true, value: { changed: false } });
  });

  it.each([
    ["a database error", { error: { code: "23514" } }],
    ["a network failure", "throw" as const],
    ["an answer that is not a list", { data: null }],
  ])("%s is { ok: false }", async (_name, answer) => {
    expect(await upgradeWeeklyLine(withTable(answer as WeeklyConfig).client, { userId: USER, weekStart: WEEK, line })).toEqual({ ok: false });
  });

  it("never logs the line", async () => {
    await upgradeWeeklyLine(withTable({ error: { code: "23514", message: line.text } }).client, { userId: USER, weekStart: WEEK, line });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(line.text);
  });
});
