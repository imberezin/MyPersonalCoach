import { describe, expect, it } from "vitest";
import { EDIT_FORM, type EditRowValues } from "@/domain/food/edit";
import { BLANK_ROW, createEditRows, editRowsReducer } from "./editRows";

const row = (name: string, over: Partial<EditRowValues> = {}): EditRowValues => ({ ...BLANK_ROW, name, ...over });

describe("editRowsReducer", () => {
  it("numbers the rows from the values it is given", () => {
    const state = createEditRows([row("bread"), row("cheese")]);
    expect(state.rows.map((r) => r.key)).toEqual([0, 1]);
    expect(state.nextKey).toBe(2);
  });

  it("adds a blank row with a new key", () => {
    const state = editRowsReducer(createEditRows([row("bread")]), { type: "add" });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1]).toEqual({ key: 1, values: BLANK_ROW });
    expect(state.nextKey).toBe(2);
  });

  it("never reuses a key after a row is removed", () => {
    let state = createEditRows([row("a"), row("b")]);
    state = editRowsReducer(state, { type: "remove", key: 0 });
    state = editRowsReducer(state, { type: "add" });
    expect(state.rows.map((r) => r.key)).toEqual([1, 2]);
  });

  it("stops adding at the maximum", () => {
    const full = createEditRows(Array.from({ length: EDIT_FORM.maxRows }, (_, i) => row(`food ${i}`)));
    expect(editRowsReducer(full, { type: "add" })).toBe(full);
  });

  it("removes a row by key, and ignores an unknown key", () => {
    const state = createEditRows([row("a"), row("b")]);
    expect(editRowsReducer(state, { type: "remove", key: 0 }).rows.map((r) => r.values.name)).toEqual(["b"]);
    expect(editRowsReducer(state, { type: "remove", key: 9 })).toBe(state);
  });

  it("can remove the last row (saving then explains that one food is needed)", () => {
    expect(editRowsReducer(createEditRows([row("a")]), { type: "remove", key: 0 }).rows).toEqual([]);
  });

  it("changes one field of one row", () => {
    const state = createEditRows([row("a"), row("b")]);
    const next = editRowsReducer(state, { type: "change", key: 1, field: "portion", value: "amount" });
    expect(next.rows[1].values.portion).toBe("amount");
    expect(next.rows[0]).toBe(state.rows[0]);
  });

  it("returns the same state when a change changes nothing", () => {
    const state = createEditRows([row("a")]);
    expect(editRowsReducer(state, { type: "change", key: 0, field: "name", value: "a" })).toBe(state);
    expect(editRowsReducer(state, { type: "change", key: 5, field: "name", value: "x" })).toBe(state);
  });

  it("resets from the values the server sent back", () => {
    const state = editRowsReducer(createEditRows([row("a")]), { type: "add" });
    const next = editRowsReducer(state, { type: "reset", rows: [row("typed")] });
    expect(next).toEqual(createEditRows([row("typed")]));
  });
});
