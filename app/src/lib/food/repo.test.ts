import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { RESUME_WINDOW_MS, draftToJson, itemsToJson } from "@/domain/food";
import type { MealDraft, UnderstoodItem } from "@/domain/food";
import { createFakeFoodSupabase, type FakeFoodCall } from "./fakeSupabase";
import {
  UNDERSTANDING_COLUMNS,
  confirmMeal,
  createUnderstanding,
  discardUnderstanding,
  findByRequestId,
  findResumable,
  loadSavedMeal,
  loadUnderstanding,
  saveDraft,
  type NewUnderstanding,
} from "./repo";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ENTRY_ID = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2027-01-12T10:30:00.000Z");
const MARKER = "HOSTILE-MARKER-DO-NOT-LOG";

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  // Whatever the repo logs, it never contains what the user wrote.
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(MARKER);
  consoleError.mockRestore();
});

const queries = (calls: FakeFoodCall[]) => calls.filter((c): c is Extract<FakeFoodCall, { kind: "query" }> => c.kind === "query");

const item: UnderstoodItem = { name: MARKER, portion: { kind: "amount", amount: 2, unit: "slice", estimated: true }, uncertain: true, confidence: 0.7 };

const meal = (): MealDraft => ({
  items: [
    { name: MARKER, portion: { kind: "size", size: "small", estimated: false }, uncertain: true },
    { name: "tea", portion: null, uncertain: false },
  ],
  mealType: "lunch",
  occurredAt: new Date("2027-01-12T09:15:00.000Z"),
});

const newReport = (over: Partial<NewUnderstanding> = {}): NewUnderstanding => ({
  requestId: REQUEST_ID,
  kind: "text",
  text: MARKER,
  provider: "gemini",
  model: "gemini-test",
  promptVersion: "meal-v1",
  items: [item],
  unclear: ["something blurry"],
  overallConfidence: 0.8,
  proposed: { mealType: "breakfast", occurredAt: new Date("2027-01-12T05:42:00.000Z") },
  ...over,
});

const goodRow = (over: Record<string, unknown> = {}) => ({
  id: ID,
  provider: "gemini",
  model: "gemini-test",
  prompt_version: "meal-v1",
  status: "pending",
  items: [{ name: "bread", portion: null, uncertain: false, confidence: 0.9 }],
  unclear: [],
  overall_confidence: 0.85,
  proposed_meal_type: "breakfast",
  proposed_occurred_at: "2027-01-12T05:42:00+00:00",
  draft: null,
  created_at: "2027-01-12T05:43:00+00:00",
  meal_raw_inputs: { kind: "text" },
  ...over,
});

describe("createUnderstanding", () => {
  it("sends exactly the RPC arguments and returns the id", async () => {
    const { client, calls } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { data: ID } } });
    const result = await createUnderstanding(client, newReport());
    expect(result).toEqual({ ok: true, value: { id: ID } });
    expect(calls).toEqual([
      {
        kind: "rpc",
        name: "create_meal_understanding",
        args: {
          p_request_id: REQUEST_ID,
          p_kind: "text",
          p_text: MARKER,
          p_provider: "gemini",
          p_model: "gemini-test",
          p_prompt_version: "meal-v1",
          p_items: itemsToJson([item]),
          p_unclear: ["something blurry"],
          p_overall: 0.8,
          p_meal_type: "breakfast",
          p_occurred_at: "2027-01-12T05:42:00.000Z",
        },
      },
    ]);
  });

  it("sends a null model and prompt version for a manual report, and no request id when there is none", async () => {
    const { client, calls } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { data: ID } } });
    await createUnderstanding(client, newReport({ provider: "manual", model: null, promptVersion: null, requestId: null, overallConfidence: null, kind: "photo", text: null }));
    expect(calls[0]).toMatchObject({
      args: { p_request_id: null, p_kind: "photo", p_text: null, p_provider: "manual", p_model: null, p_prompt_version: null, p_overall: null },
    });
  });

  it("keeps confidence and the 'maybe' flag in the items it stores", async () => {
    const { client, calls } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { data: ID } } });
    await createUnderstanding(client, newReport());
    const args = (calls[0] as { args: { p_items: Array<Record<string, unknown>> } }).args;
    expect(args.p_items[0]).toMatchObject({ uncertain: true, confidence: 0.7 });
  });

  it("maps an error to unavailable", async () => {
    const { client } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { error: { message: "boom", code: "XX000" } } } });
    expect(await createUnderstanding(client, newReport())).toEqual({ ok: false, code: "unavailable" });
    expect(consoleError).toHaveBeenCalledWith("Food: a database call failed", "XX000");
  });

  it("maps a thrown client to unavailable", async () => {
    const { client } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { error: "throw" } } });
    expect(await createUnderstanding(client, newReport())).toEqual({ ok: false, code: "unavailable" });
  });

  it("maps an answer that is not an id to unavailable", async () => {
    for (const data of [null, undefined, 5, { id: ID }, ["x"]]) {
      const { client } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { data } } });
      expect(await createUnderstanding(client, newReport()), JSON.stringify(data)).toEqual({ ok: false, code: "unavailable" });
    }
  });

  it("does not leak an error message that could echo input", async () => {
    const { client } = createFakeFoodSupabase({ rpc: { create_meal_understanding: { error: { message: `invalid input ${MARKER}`, code: "22P02" } } } });
    await createUnderstanding(client, newReport());
    // the afterEach hook asserts nothing logged contains the marker
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("findByRequestId", () => {
  it("selects the raw input by client_request_id and returns the understanding id", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { meal_raw_inputs: [{ id: "raw", meal_understandings: [{ id: ID }] }] } });
    expect(await findByRequestId(client, REQUEST_ID)).toEqual({ id: ID });
    expect(queries(calls)).toEqual([
      { kind: "query", table: "meal_raw_inputs", op: "select", columns: "id, meal_understandings(id)", filters: [["eq", "client_request_id", REQUEST_ID]], single: true },
    ]);
  });

  it("accepts the understanding as one object instead of an array", async () => {
    const { client } = createFakeFoodSupabase({ tables: { meal_raw_inputs: [{ id: "raw", meal_understandings: { id: ID } }] } });
    expect(await findByRequestId(client, REQUEST_ID)).toEqual({ id: ID });
  });

  it("returns null for no row, a row without an understanding, and a malformed one", async () => {
    for (const rows of [[], [{ id: "raw", meal_understandings: [] }], [{ id: "raw" }], [{ id: "raw", meal_understandings: [{ id: 5 }] }], [null]]) {
      const { client } = createFakeFoodSupabase({ tables: { meal_raw_inputs: rows } });
      expect(await findByRequestId(client, REQUEST_ID), JSON.stringify(rows)).toBeNull();
    }
  });

  it("returns null for an error and for a thrown client", async () => {
    expect(await findByRequestId(createFakeFoodSupabase({ tables: { meal_raw_inputs: { error: { code: "XX000" } } } }).client, REQUEST_ID)).toBeNull();
    expect(await findByRequestId(createFakeFoodSupabase({ tables: { meal_raw_inputs: "throw" } }).client, REQUEST_ID)).toBeNull();
    expect(await findByRequestId(createFakeFoodSupabase({}).client, REQUEST_ID)).toBeNull();
  });
});

describe("loadUnderstanding", () => {
  it("selects the documented columns by id and parses the row", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { meal_understandings: [goodRow()] } });
    const result = await loadUnderstanding(client, ID);
    expect(result).toMatchObject({ ok: true, value: { id: ID, kind: "text", status: "pending", provider: "gemini" } });
    expect(queries(calls)).toEqual([
      { kind: "query", table: "meal_understandings", op: "select", columns: UNDERSTANDING_COLUMNS, filters: [["eq", "id", ID]], single: true },
    ]);
  });

  it("asks for the raw input kind and the columns the parser needs", () => {
    for (const column of ["id", "provider", "model", "prompt_version", "status", "items", "unclear", "overall_confidence", "proposed_meal_type", "proposed_occurred_at", "draft", "created_at", "meal_raw_inputs(kind)"]) {
      expect(UNDERSTANDING_COLUMNS).toContain(column);
    }
  });

  it("answers not_found when no row comes back (another user's id looks the same: RLS hides it)", async () => {
    const { client } = createFakeFoodSupabase({ tables: { meal_understandings: [] } });
    expect(await loadUnderstanding(client, ID)).toEqual({ ok: false, code: "not_found" });
  });

  it("answers not_found for text that is not a UUID", async () => {
    const { client } = createFakeFoodSupabase({ tables: { meal_understandings: { error: { code: "22P02", message: "invalid input syntax for type uuid" } } } });
    expect(await loadUnderstanding(client, "nope")).toEqual({ ok: false, code: "not_found" });
  });

  it("answers unavailable for another error, a thrown client, and a row that does not parse", async () => {
    expect(await loadUnderstanding(createFakeFoodSupabase({ tables: { meal_understandings: { error: { code: "XX000" } } } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await loadUnderstanding(createFakeFoodSupabase({ tables: { meal_understandings: "throw" } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await loadUnderstanding(createFakeFoodSupabase({ tables: { meal_understandings: [goodRow({ items: "garbage" })] } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("saveDraft", () => {
  it("updates the draft of a pending report only", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { meal_understandings: [{ id: ID }] } });
    expect(await saveDraft(client, ID, meal())).toEqual({ ok: true, value: true });
    expect(queries(calls)).toEqual([
      {
        kind: "query",
        table: "meal_understandings",
        op: "update",
        patch: { draft: draftToJson(meal()) },
        columns: "id",
        filters: [
          ["eq", "id", ID],
          ["eq", "status", "pending"],
        ],
        single: false,
      },
    ]);
  });

  it("treats zero updated rows as not_pending", async () => {
    const { client } = createFakeFoodSupabase({ tables: { meal_understandings: [] } });
    expect(await saveDraft(client, ID, meal())).toEqual({ ok: false, code: "not_pending" });
  });

  it("maps an error and a thrown client to unavailable", async () => {
    expect(await saveDraft(createFakeFoodSupabase({ tables: { meal_understandings: { error: { code: "XX000" } } } }).client, ID, meal())).toEqual({ ok: false, code: "unavailable" });
    expect(await saveDraft(createFakeFoodSupabase({ tables: { meal_understandings: "throw" } }).client, ID, meal())).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("confirmMeal", () => {
  it("sends the id, the instant, the type, the rebuilt items and the source, and returns the entry id", async () => {
    const { client, calls } = createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { data: ENTRY_ID } } });
    expect(await confirmMeal(client, { id: ID, meal: meal(), source: "ai_edited" })).toEqual({ ok: true, value: { entryId: ENTRY_ID } });
    expect(calls).toEqual([
      {
        kind: "rpc",
        name: "confirm_meal_understanding",
        args: {
          p_id: ID,
          p_occurred_at: "2027-01-12T09:15:00.000Z",
          p_meal_type: "lunch",
          p_items: [
            { name: MARKER, portion: { kind: "size", size: "small", estimated: false } },
            { name: "tea", portion: null },
          ],
          p_source: "ai_edited",
        },
      },
    ]);
  });

  it("never sends the 'maybe' flag or a confidence", async () => {
    const { client, calls } = createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { data: ENTRY_ID } } });
    await confirmMeal(client, { id: ID, meal: meal(), source: "ai_unedited" });
    const items = (calls[0] as { args: { p_items: Array<Record<string, unknown>> } }).args.p_items;
    for (const i of items) expect(Object.keys(i).sort()).toEqual(["name", "portion"]);
  });

  it("maps the RPC's messages not_found and not_pending", async () => {
    const notFound = createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { error: { message: "not_found", code: "P0002" } } } });
    expect(await confirmMeal(notFound.client, { id: ID, meal: meal(), source: "ai_unedited" })).toEqual({ ok: false, code: "not_found" });
    const notPending = createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { error: { message: "not_pending", code: "P0001" } } } });
    expect(await confirmMeal(notPending.client, { id: ID, meal: meal(), source: "ai_unedited" })).toEqual({ ok: false, code: "not_pending" });
  });

  it("maps any other error, a thrown client and a non-id answer to unavailable", async () => {
    for (const error of [{ message: "bad_source", code: "22023" }, { message: "permission denied", code: "42501" }]) {
      const { client } = createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { error } } });
      expect(await confirmMeal(client, { id: ID, meal: meal(), source: "ai_unedited" })).toEqual({ ok: false, code: "unavailable" });
    }
    expect(await confirmMeal(createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { error: "throw" } } }).client, { id: ID, meal: meal(), source: "ai_unedited" })).toEqual({ ok: false, code: "unavailable" });
    expect(await confirmMeal(createFakeFoodSupabase({ rpc: { confirm_meal_understanding: { data: null } } }).client, { id: ID, meal: meal(), source: "ai_unedited" })).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("discardUnderstanding", () => {
  it("calls the RPC with the id and returns ok for true", async () => {
    const { client, calls } = createFakeFoodSupabase({ rpc: { discard_meal_understanding: { data: true } } });
    expect(await discardUnderstanding(client, ID)).toEqual({ ok: true, value: true });
    expect(calls).toEqual([{ kind: "rpc", name: "discard_meal_understanding", args: { p_id: ID } }]);
  });

  it("maps false to not_pending (already confirmed, already gone, or not yours)", async () => {
    const { client } = createFakeFoodSupabase({ rpc: { discard_meal_understanding: { data: false } } });
    expect(await discardUnderstanding(client, ID)).toEqual({ ok: false, code: "not_pending" });
  });

  it("maps an error and a thrown client to unavailable", async () => {
    expect(await discardUnderstanding(createFakeFoodSupabase({ rpc: { discard_meal_understanding: { error: { message: "x", code: "XX000" } } } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await discardUnderstanding(createFakeFoodSupabase({ rpc: { discard_meal_understanding: { error: "throw" } } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await discardUnderstanding(createFakeFoodSupabase({ rpc: { discard_meal_understanding: { data: null } } }).client, ID)).toEqual({ ok: false, code: "not_pending" });
  });
});

describe("findResumable", () => {
  it("asks for the newest pending report inside the resume window", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { meal_understandings: [{ id: ID, created_at: "2027-01-12T09:50:00+00:00" }] } });
    expect(await findResumable(client, NOW)).toEqual({ id: ID, createdAt: new Date("2027-01-12T09:50:00Z") });
    expect(queries(calls)).toEqual([
      {
        kind: "query",
        table: "meal_understandings",
        op: "select",
        columns: "id, created_at",
        filters: [
          ["eq", "status", "pending"],
          ["gt", "created_at", new Date(NOW.getTime() - RESUME_WINDOW_MS).toISOString()],
        ],
        order: { column: "created_at", ascending: false },
        limit: 1,
        single: false,
      },
    ]);
  });

  it("returns null when there is none", async () => {
    expect(await findResumable(createFakeFoodSupabase({ tables: { meal_understandings: [] } }).client, NOW)).toBeNull();
  });

  it("returns null for an error, a thrown client and a malformed row", async () => {
    expect(await findResumable(createFakeFoodSupabase({ tables: { meal_understandings: { error: { code: "XX000" } } } }).client, NOW)).toBeNull();
    expect(await findResumable(createFakeFoodSupabase({ tables: { meal_understandings: "throw" } }).client, NOW)).toBeNull();
    for (const row of [{ id: 5, created_at: "2027-01-12T09:50:00Z" }, { id: ID, created_at: "soon" }, { id: ID }, null]) {
      expect(await findResumable(createFakeFoodSupabase({ tables: { meal_understandings: [row] } }).client, NOW), JSON.stringify(row)).toBeNull();
    }
  });
});

describe("loadSavedMeal", () => {
  const entry = { id: ENTRY_ID, confirmed_at: "2027-01-12T10:00:00+00:00" };

  it("returns the entry of the report and says it is the first meal when it is the only row", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { meal_entries: [entry] } });
    expect(await loadSavedMeal(client, ID)).toEqual({ ok: true, value: { entryId: ENTRY_ID, confirmedAt: new Date("2027-01-12T10:00:00Z"), isFirstMeal: true } });
    const asked = queries(calls);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatchObject({ table: "meal_entries", columns: "id, confirmed_at", filters: [["eq", "understanding_id", ID]], single: true });
    expect(asked[1]).toMatchObject({ table: "meal_entries", columns: "id", limit: 2 });
  });

  it("is not the first meal when there is more than one entry", async () => {
    const { client } = createFakeFoodSupabase({ tables: { meal_entries: [entry, { id: "other", confirmed_at: "2027-01-11T10:00:00Z" }] } });
    expect(await loadSavedMeal(client, ID)).toMatchObject({ ok: true, value: { isFirstMeal: false } });
  });

  it("answers not_found when the report has no entry", async () => {
    expect(await loadSavedMeal(createFakeFoodSupabase({ tables: { meal_entries: [] } }).client, ID)).toEqual({ ok: false, code: "not_found" });
  });

  it("answers unavailable for an error, a thrown client and a malformed row", async () => {
    expect(await loadSavedMeal(createFakeFoodSupabase({ tables: { meal_entries: { error: { code: "XX000" } } } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await loadSavedMeal(createFakeFoodSupabase({ tables: { meal_entries: "throw" } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
    expect(await loadSavedMeal(createFakeFoodSupabase({ tables: { meal_entries: [{ id: ENTRY_ID, confirmed_at: "soon" }] } }).client, ID)).toEqual({ ok: false, code: "unavailable" });
  });
});
