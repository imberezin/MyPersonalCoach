import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEIGHT_LIST, WEIGHT_TREND } from "@/domain/weight";
import { createFakeWeightSupabase, type FakeAnswer } from "./fakeSupabase";
import {
  WEIGHT_ROW_COLUMNS,
  WEIGHT_SERIES_COLUMNS,
  deleteWeightEntry,
  insertWeightEntry,
  listWeightEntries,
  loadReferenceWeight,
  loadSavedWeight,
  loadWeightEntry,
  loadWeightSeries,
  updateWeightEntry,
} from "./repo";

const USER = "00000000-0000-4000-8000-000000000001";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const WHEN = new Date("2026-10-07T09:30:00.000Z");
const MARKER_NOTE = "ZZ_NOTE_MARKER_77";
const KG = 118.7;

const FAILS: FakeAnswer = { error: { code: "42501", message: "permission denied for table weight_entries 118.7" } };
const THROWS: FakeAnswer = "throw";
const row = (id: string, at: string, kg: number | string = 80, note?: string | null) => ({
  id,
  weight_kg: kg,
  measured_at: at,
  ...(note === undefined ? {} : { note }),
});

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("insertWeightEntry", () => {
  it("asks for an upsert that does nothing on a conflict, and returns the new id", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ id: ID }] } });
    const result = await insertWeightEntry(client, { id: ID, weightKg: KG, measuredAt: WHEN, note: MARKER_NOTE });
    expect(result).toEqual({ ok: true, value: { created: true } });
    expect(calls).toEqual([
      {
        kind: "upsert",
        target: "weight_entries",
        values: { id: ID, weight_kg: KG, measured_at: "2026-10-07T09:30:00.000Z", source: "manual", note: MARKER_NOTE },
        options: { onConflict: "id", ignoreDuplicates: true },
        columns: "id",
        filters: [],
        order: [],
      },
    ]);
  });

  it("leaves the note key out when there is no note (the insert then works before the migration)", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ id: ID }] } });
    await insertWeightEntry(client, { id: ID, weightKg: KG, measuredAt: WHEN, note: null });
    expect(calls[0].values).toEqual({ id: ID, weight_kg: KG, measured_at: "2026-10-07T09:30:00.000Z", source: "manual" });
    expect(Object.keys(calls[0].values as object)).not.toContain("note");
  });

  it("no row back means the id already existed: still a success, created false", async () => {
    const { client } = createFakeWeightSupabase({ weight_entries: { rows: [] } });
    expect(await insertWeightEntry(client, { id: ID, weightKg: KG, measuredAt: WHEN, note: null })).toEqual({ ok: true, value: { created: false } });
  });

  it.each([
    ["an error", FAILS],
    ["a throw", THROWS],
    ["a non-array answer", { data: null } as FakeAnswer],
  ])("%s is unavailable", async (_name, answer) => {
    const { client } = createFakeWeightSupabase({ weight_entries: answer });
    expect(await insertWeightEntry(client, { id: ID, weightKg: KG, measuredAt: WHEN, note: null })).toEqual({ ok: false, code: "unavailable" });
  });

  it("an instant that cannot be written is unavailable and sends nothing", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ id: ID }] } });
    expect(await insertWeightEntry(client, { id: ID, weightKg: KG, measuredAt: new Date(Number.NaN), note: null })).toEqual({ ok: false, code: "unavailable" });
    expect(calls).toEqual([]);
  });
});

describe("loadWeightEntry and loadSavedWeight", () => {
  it("loadWeightEntry reads the row with its note, by id, one row", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [row(ID, "2026-10-07T09:30:00+00:00", "118.70", "after a trip")] } });
    const result = await loadWeightEntry(client, ID);
    expect(result).toEqual({ ok: true, value: { id: ID, weightKg: 118.7, measuredAt: new Date("2026-10-07T09:30:00Z"), note: "after a trip" } });
    expect(calls).toEqual([
      { kind: "select", target: "weight_entries", columns: WEIGHT_ROW_COLUMNS, filters: [["eq", "id", ID]], order: [], limit: 1 },
    ]);
    expect(WEIGHT_ROW_COLUMNS).toBe("id, weight_kg, measured_at, note");
  });

  it("loadSavedWeight never selects the note, so it works before the migration", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [row(ID, "2026-10-07T09:30:00+00:00", 118.7)] } });
    const result = await loadSavedWeight(client, ID);
    expect(result).toEqual({ ok: true, value: { id: ID, weightKg: 118.7, measuredAt: new Date("2026-10-07T09:30:00Z") } });
    expect(calls[0].columns).toBe(WEIGHT_SERIES_COLUMNS);
    expect(calls[0].columns).not.toContain("note");
    // The value is an entry, not a row with a note.
    expect(Object.keys((result as { value: object }).value)).not.toContain("note");
  });

  it.each([
    ["loadWeightEntry", loadWeightEntry],
    ["loadSavedWeight", loadSavedWeight],
  ])("%s: no row (not mine, or gone) is not_found; a failure is unavailable", async (_name, load) => {
    expect(await load(createFakeWeightSupabase({ weight_entries: { rows: [] } }).client, ID)).toEqual({ ok: false, code: "not_found" });
    expect(await load(createFakeWeightSupabase({ weight_entries: { error: { code: "22P02" } } }).client, ID)).toEqual({ ok: false, code: "not_found" });
    expect(await load(createFakeWeightSupabase({ weight_entries: FAILS }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await load(createFakeWeightSupabase({ weight_entries: THROWS }).client, ID)).toEqual({ ok: false, code: "unavailable" });
  });

  it("a stored row that cannot be read is unavailable, not guessed", async () => {
    const { client } = createFakeWeightSupabase({ weight_entries: { rows: [{ id: "not-a-uuid", weight_kg: 80, measured_at: "2026-10-07T09:30:00Z" }] } });
    expect(await loadWeightEntry(client, ID)).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("updateWeightEntry", () => {
  it("updates weight and note (null clears it) and leaves the time alone when measuredAt is null", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ id: ID }] } });
    expect(await updateWeightEntry(client, { id: ID, weightKg: 117.2, measuredAt: null, note: null })).toEqual({ ok: true, value: { changed: true } });
    expect(calls).toEqual([
      { kind: "update", target: "weight_entries", values: { weight_kg: 117.2, note: null }, columns: "id", filters: [["eq", "id", ID]], order: [] },
    ]);
  });

  it("includes measured_at only when a new time is given", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ id: ID }] } });
    await updateWeightEntry(client, { id: ID, weightKg: 117.2, measuredAt: WHEN, note: "x" });
    expect(calls[0].values).toEqual({ weight_kg: 117.2, note: "x", measured_at: "2026-10-07T09:30:00.000Z" });
  });

  it("zero rows is not_found; errors and throws are unavailable", async () => {
    const edit = (answer: FakeAnswer) =>
      updateWeightEntry(createFakeWeightSupabase({ weight_entries: answer }).client, { id: ID, weightKg: 80, measuredAt: null, note: null });
    expect(await edit({ rows: [] })).toEqual({ ok: false, code: "not_found" });
    expect(await edit(FAILS)).toEqual({ ok: false, code: "unavailable" });
    expect(await edit(THROWS)).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("deleteWeightEntry", () => {
  it("calls the RPC with the entry id and accepts only a boolean", async () => {
    const del = async (answer: FakeAnswer) => {
      const { client, calls } = createFakeWeightSupabase({}, { delete_weight_entry: answer });
      return { result: await deleteWeightEntry(client, ID), calls };
    };
    const yes = await del({ data: true });
    expect(yes.result).toEqual({ ok: true, value: { deleted: true } });
    expect(yes.calls).toEqual([{ kind: "rpc", target: "delete_weight_entry", values: { p_entry_id: ID }, filters: [], order: [] }]);
    expect((await del({ data: false })).result).toEqual({ ok: true, value: { deleted: false } });
    for (const odd of [{ data: null }, { data: "true" }, { data: 1 }, { data: { deleted: true } }] as FakeAnswer[]) {
      expect((await del(odd)).result, JSON.stringify(odd)).toEqual({ ok: false, code: "unavailable" });
    }
    expect((await del(FAILS)).result).toEqual({ ok: false, code: "unavailable" });
    expect((await del(THROWS)).result).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("listWeightEntries", () => {
  const page = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      row(`00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`, `2026-10-07T09:${String(59 - (i % 60)).padStart(2, "0")}:00+00:00`, 80 + i / 10, i === 0 ? "note" : null),
    );

  it("without a cursor: asks pageSize + 1 rows, newest first, ties by id, with no filter", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: page(3) } });
    const result = await listWeightEntries(client, { after: null });
    expect(calls).toEqual([
      {
        kind: "select",
        target: "weight_entries",
        columns: WEIGHT_ROW_COLUMNS,
        filters: [],
        order: [
          { column: "measured_at", ascending: false },
          { column: "id", ascending: false },
        ],
        limit: WEIGHT_LIST.pageSize + 1,
      },
    ]);
    expect(result.ok && result.value.entries).toHaveLength(3);
    expect(result.ok && result.value.hasMore).toBe(false);
  });

  it("reports hasMore from the extra row and returns exactly one page", async () => {
    const { client } = createFakeWeightSupabase({ weight_entries: { rows: page(WEIGHT_LIST.pageSize + 1) } });
    const result = await listWeightEntries(client, { after: null });
    expect(result.ok && result.value.entries).toHaveLength(WEIGHT_LIST.pageSize);
    expect(result.ok && result.value.hasMore).toBe(true);
    const exact = await listWeightEntries(createFakeWeightSupabase({ weight_entries: { rows: page(WEIGHT_LIST.pageSize) } }).client, { after: null });
    expect(exact.ok && exact.value.hasMore).toBe(false);
  });

  it("with a cursor: reads the cursor row first, then filters with its measured_at string unchanged", async () => {
    const AT = "2026-10-05T08:15:30.123456+00:00";
    const { client, calls } = createFakeWeightSupabase({ weight_entries: [{ rows: [{ measured_at: AT }] }, { rows: page(2) }] });
    const result = await listWeightEntries(client, { after: ID });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ kind: "select", target: "weight_entries", columns: "measured_at", filters: [["eq", "id", ID]], order: [], limit: 1 });
    expect(calls[1].or).toBe(`measured_at.lt.${AT},and(measured_at.eq.${AT},id.lt.${ID})`);
    expect(calls[1].limit).toBe(WEIGHT_LIST.pageSize + 1);
  });

  it("a cursor that is not an entry of the caller (no row) falls back to the newest page", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: [{ rows: [] }, { rows: page(2) }] });
    const result = await listWeightEntries(client, { after: ID });
    expect(result.ok && result.value.entries).toHaveLength(2);
    expect(calls[1].or).toBeUndefined();
  });

  it("a garbage cursor never reaches the database, and a cursor time that is not a timestamp is not put in a filter", async () => {
    const garbage = createFakeWeightSupabase({ weight_entries: { rows: page(1) } });
    await listWeightEntries(garbage.client, { after: "x),id.gt.0" });
    expect(garbage.calls).toHaveLength(1);
    expect(garbage.calls[0].or).toBeUndefined();

    const odd = createFakeWeightSupabase({ weight_entries: [{ rows: [{ measured_at: "2026-10-05T08:15:30Z),id.gt.0" }] }, { rows: page(1) }] });
    await listWeightEntries(odd.client, { after: ID });
    expect(odd.calls[1].or).toBeUndefined();
  });

  it("a failed cursor read is unavailable, never a silently wrong page", async () => {
    const { client } = createFakeWeightSupabase({ weight_entries: FAILS });
    expect(await listWeightEntries(client, { after: ID })).toEqual({ ok: false, code: "unavailable" });
  });

  it("skips a row it cannot read; an empty table is an empty list; a failure is never an empty list", async () => {
    const mixed = await listWeightEntries(createFakeWeightSupabase({ weight_entries: { rows: [...page(1), { id: "bad" }] } }).client, { after: null });
    expect(mixed.ok && mixed.value.entries).toHaveLength(1);
    const empty = await listWeightEntries(createFakeWeightSupabase({ weight_entries: { rows: [] } }).client, { after: null });
    expect(empty).toEqual({ ok: true, value: { entries: [], hasMore: false } });
    expect(await listWeightEntries(createFakeWeightSupabase({ weight_entries: FAILS }).client, { after: null })).toEqual({ ok: false, code: "unavailable" });
    expect(await listWeightEntries(createFakeWeightSupabase({ weight_entries: THROWS }).client, { after: null })).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("loadReferenceWeight", () => {
  it("asks for the newest weight strictly before the time, and returns it as a number", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ weight_kg: "99.50" }] } });
    expect(await loadReferenceWeight(client, { before: WHEN })).toBe(99.5);
    expect(calls).toEqual([
      {
        kind: "select",
        target: "weight_entries",
        columns: "weight_kg",
        filters: [["lt", "measured_at", "2026-10-07T09:30:00.000Z"]],
        order: [{ column: "measured_at", ascending: false }],
        limit: 1,
      },
    ]);
  });

  it("excludes the entry being edited", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: [{ weight_kg: 80 }] } });
    await loadReferenceWeight(client, { before: WHEN, excludeId: ID });
    expect(calls[0].filters).toEqual([
      ["lt", "measured_at", "2026-10-07T09:30:00.000Z"],
      ["neq", "id", ID],
    ]);
  });

  it("distinguishes none (null) from a failed read (unknown)", async () => {
    expect(await loadReferenceWeight(createFakeWeightSupabase({ weight_entries: { rows: [] } }).client, { before: WHEN })).toBeNull();
    expect(await loadReferenceWeight(createFakeWeightSupabase({ weight_entries: FAILS }).client, { before: WHEN })).toBe("unknown");
    expect(await loadReferenceWeight(createFakeWeightSupabase({ weight_entries: THROWS }).client, { before: WHEN })).toBe("unknown");
    expect(await loadReferenceWeight(createFakeWeightSupabase({ weight_entries: { rows: [{ weight_kg: "abc" }] } }).client, { before: WHEN })).toBe("unknown");
    expect(await loadReferenceWeight(createFakeWeightSupabase({ weight_entries: { rows: [] } }).client, { before: new Date(Number.NaN) })).toBe("unknown");
  });
});

describe("loadWeightSeries", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "2026-10-07T09:30:00Z", 80));

  it("reads the series of the user, newest first, at most 1500 rows, with the columns that exist before the migration", async () => {
    const { client, calls } = createFakeWeightSupabase({ weight_entries: { rows: many(3) } });
    const result = await loadWeightSeries(client, USER);
    expect(result?.entries).toHaveLength(3);
    expect(result?.truncated).toBe(false);
    expect(calls).toEqual([
      {
        kind: "select",
        target: "weight_entries",
        columns: "id, weight_kg, measured_at",
        filters: [["eq", "user_id", USER]],
        order: [{ column: "measured_at", ascending: false }],
        limit: 1500,
      },
    ]);
    expect(WEIGHT_TREND.maxEntriesRead).toBe(1500);
  });

  it("is truncated at exactly the limit, and not one row before", async () => {
    const full = await loadWeightSeries(createFakeWeightSupabase({ weight_entries: { rows: many(WEIGHT_TREND.maxEntriesRead) } }).client, USER);
    expect(full?.truncated).toBe(true);
    const almost = await loadWeightSeries(createFakeWeightSupabase({ weight_entries: { rows: many(WEIGHT_TREND.maxEntriesRead - 1) } }).client, USER);
    expect(almost?.truncated).toBe(false);
  });

  it("returns entries without notes, drops rows it cannot read, and is null when the read fails", async () => {
    const result = await loadWeightSeries(createFakeWeightSupabase({ weight_entries: { rows: [...many(1), { id: 1 }] } }).client, USER);
    expect(result?.entries).toHaveLength(1);
    expect(Object.keys(result?.entries[0] ?? {}).sort()).toEqual(["id", "measuredAt", "weightKg"]);
    expect(await loadWeightSeries(createFakeWeightSupabase({ weight_entries: FAILS }).client, USER)).toBeNull();
    expect(await loadWeightSeries(createFakeWeightSupabase({ weight_entries: THROWS }).client, USER)).toBeNull();
  });
});

describe("what the repo logs", () => {
  it("never prints a weight, a note or a database message: only constant text and a code", async () => {
    const weights = createFakeWeightSupabase({ weight_entries: FAILS }, { delete_weight_entry: FAILS });
    await insertWeightEntry(weights.client, { id: ID, weightKg: KG, measuredAt: WHEN, note: MARKER_NOTE });
    await loadWeightEntry(weights.client, ID);
    await loadSavedWeight(weights.client, ID);
    await updateWeightEntry(weights.client, { id: ID, weightKg: KG, measuredAt: null, note: MARKER_NOTE });
    await deleteWeightEntry(weights.client, ID);
    await listWeightEntries(weights.client, { after: ID_2 });
    await loadReferenceWeight(weights.client, { before: WHEN });
    await loadWeightSeries(weights.client, USER);

    const thrown = createFakeWeightSupabase({ weight_entries: THROWS }, { delete_weight_entry: THROWS });
    await insertWeightEntry(thrown.client, { id: ID, weightKg: KG, measuredAt: WHEN, note: MARKER_NOTE });
    await deleteWeightEntry(thrown.client, ID);
    await loadWeightSeries(thrown.client, USER);

    expect(errorLog.mock.calls.length).toBeGreaterThan(8);
    const text = JSON.stringify(errorLog.mock.calls);
    expect(text).not.toContain("118");
    expect(text).not.toContain("117");
    expect(text).not.toContain(MARKER_NOTE);
    expect(text).not.toContain("permission denied");
    expect(text).not.toContain(ID);
    expect(text).not.toContain(USER);
    expect(text).toContain("42501");
  });
});
