import { EDIT_FORM, type EditRowValues } from "@/domain/food/edit";

/** One food row of the edit form. `key` is stable for the life of the row, so React keeps focus and typing when rows are added or removed. */
export interface EditRowModel {
  key: number;
  values: EditRowValues;
}

export interface EditRowsState {
  rows: EditRowModel[];
  nextKey: number;
}

export type EditRowField = Exclude<keyof EditRowValues, "orig">;

export type EditRowsAction =
  | { type: "add" }
  | { type: "remove"; key: number }
  | { type: "change"; key: number; field: EditRowField; value: string }
  | { type: "reset"; rows: readonly EditRowValues[] };

export const BLANK_ROW: EditRowValues = { name: "", portion: "", amount: "", unit: "", orig: "" };

export function createEditRows(rows: readonly EditRowValues[]): EditRowsState {
  return { rows: rows.map((values, key) => ({ key, values })), nextKey: rows.length };
}

export function editRowsReducer(state: EditRowsState, action: EditRowsAction): EditRowsState {
  switch (action.type) {
    case "add":
      if (state.rows.length >= EDIT_FORM.maxRows) return state;
      return { rows: [...state.rows, { key: state.nextKey, values: BLANK_ROW }], nextKey: state.nextKey + 1 };
    case "remove": {
      const rows = state.rows.filter((row) => row.key !== action.key);
      return rows.length === state.rows.length ? state : { ...state, rows };
    }
    case "change": {
      let changed = false;
      const rows = state.rows.map((row) => {
        if (row.key !== action.key || row.values[action.field] === action.value) return row;
        changed = true;
        return { key: row.key, values: { ...row.values, [action.field]: action.value } as EditRowValues };
      });
      return changed ? { ...state, rows } : state;
    }
    case "reset":
      return createEditRows(action.rows);
  }
}
