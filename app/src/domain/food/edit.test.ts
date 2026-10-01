import { describe, expect, it } from "vitest";
import { EDIT_FORM, editFormDefaults, readEditForm, rowField, validateEdit, type EditFormValues, type EditRowValues } from "./edit";
import type { MealDraft } from "./types";

const TZ = "Asia/Jerusalem";
const NOW = new Date("2027-01-12T10:30:00Z"); // 12:30 in Jerusalem
const ctx = { now: NOW, timeZone: TZ };

const previous = (): MealDraft => ({
  items: [
    { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: true }, uncertain: true },
    { name: "coffee", portion: null, uncertain: false },
    { name: "cake", portion: { kind: "size", size: "small", estimated: true }, uncertain: false },
  ],
  mealType: "breakfast",
  occurredAt: new Date("2027-01-12T05:42:17Z"), // 07:42:17 local
});

const row = (over: Partial<EditRowValues> = {}): EditRowValues => ({ name: "", portion: "", amount: "", unit: "", orig: "", ...over });

/** The form as the defaults of `previous()` fill it. */
const defaults = (): EditFormValues => editFormDefaults(previous(), ctx);

const withRows = (rows: EditRowValues[], over: Partial<EditFormValues> = {}): EditFormValues => ({ ...defaults(), rows, ...over });

const reader = (entries: Record<string, unknown>) => ({ get: (name: string) => entries[name] });

describe("rowField", () => {
  it("names the fields of a row", () => {
    expect(rowField(0, "name")).toBe("food_0_name");
    expect(rowField(12, "portion")).toBe("food_12_portion");
    expect(rowField(3, "amount")).toBe("food_3_amount");
    expect(rowField(3, "unit")).toBe("food_3_unit");
    expect(rowField(3, "orig")).toBe("food_3_orig");
  });
});

describe("readEditForm", () => {
  it("reads every row and the meal fields", () => {
    const form = readEditForm(
      reader({
        [EDIT_FORM.rowCount]: "2",
        [rowField(0, "name")]: "bread",
        [rowField(0, "portion")]: "amount",
        [rowField(0, "amount")]: "2",
        [rowField(0, "unit")]: "slice",
        [rowField(0, "orig")]: "0",
        [rowField(1, "name")]: "tea",
        [rowField(1, "portion")]: "large",
        [EDIT_FORM.mealType]: "snack",
        [EDIT_FORM.day]: "yesterday",
        [EDIT_FORM.time]: "08:00",
      }),
    );
    expect(form).toEqual({
      rows: [row({ name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "0" }), row({ name: "tea", portion: "large" })],
      mealType: "snack",
      day: "yesterday",
      time: "08:00",
    });
  });

  it("is tolerant: missing fields read as empty strings", () => {
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "1" }))).toEqual({ rows: [row()], mealType: "", day: "", time: "" });
    expect(readEditForm(reader({}))).toEqual({ rows: [], mealType: "", day: "", time: "" });
  });

  it("clamps the row count to 0..40 and ignores nonsense", () => {
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "999" })).rows).toHaveLength(40);
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "40" })).rows).toHaveLength(40);
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "41" })).rows).toHaveLength(40);
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "-3" })).rows).toHaveLength(0);
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "abc" })).rows).toHaveLength(0);
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: "" })).rows).toHaveLength(0);
    expect(readEditForm(reader({ [EDIT_FORM.rowCount]: 3 })).rows).toHaveLength(0);
  });

  it("reads a value that is not a string (a file, a number) as empty and an unknown portion as none", () => {
    const form = readEditForm(
      reader({
        [EDIT_FORM.rowCount]: "1",
        [rowField(0, "name")]: { size: 10 },
        [rowField(0, "portion")]: "gigantic",
        [rowField(0, "amount")]: 5,
        [EDIT_FORM.time]: null,
      }),
    );
    expect(form.rows[0]).toEqual(row());
    expect(form.time).toBe("");
  });
});

describe("editFormDefaults", () => {
  it("fills a row per food with the portion in form terms and the index of the original", () => {
    expect(defaults()).toEqual({
      rows: [
        { name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "0" },
        { name: "coffee", portion: "", amount: "", unit: "", orig: "1" },
        { name: "cake", portion: "small", amount: "", unit: "", orig: "2" },
      ],
      mealType: "breakfast",
      day: "today",
      time: "07:42",
    });
  });

  it("shows yesterday for a meal from yesterday, and for one from even earlier (the form only offers two days)", () => {
    const yesterday = { ...previous(), occurredAt: new Date("2027-01-11T17:30:00Z") };
    expect(editFormDefaults(yesterday, ctx)).toMatchObject({ day: "yesterday", time: "19:30" });
    const older = { ...previous(), occurredAt: new Date("2027-01-10T12:00:00Z") };
    expect(editFormDefaults(older, ctx)).toMatchObject({ day: "yesterday", time: "14:00" });
  });

  it("writes an amount with a decimal as plain digits", () => {
    const meal: MealDraft = { ...previous(), items: [{ name: "x", portion: { kind: "amount", amount: 0.5, unit: "cup", estimated: false }, uncertain: false }] };
    expect(editFormDefaults(meal, ctx).rows[0]).toMatchObject({ amount: "0.5", unit: "cup" });
  });
});

describe("validateEdit: the round trip", () => {
  it("returns the same meal for an untouched form, with the exact instant and every 'maybe' cleared", () => {
    const result = validateEdit(defaults(), previous(), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meal.occurredAt.toISOString()).toBe("2027-01-12T05:42:17.000Z");
    expect(result.meal.mealType).toBe("breakfast");
    expect(result.meal.items).toEqual(previous().items.map((i) => ({ ...i, uncertain: false })));
  });

  it("keeps the exact instant when the time is retyped without a leading zero", () => {
    const result = validateEdit({ ...defaults(), time: "7:42" }, previous(), ctx);
    expect(result.ok && result.meal.occurredAt.toISOString()).toBe("2027-01-12T05:42:17.000Z");
  });

  it("keeps the second 01:30 on the day daylight saving time ends (2026-10-25)", () => {
    const second = { ...previous(), occurredAt: new Date("2026-10-24T23:30:00Z") }; // 01:30 IST, the repeated hour
    const fallCtx = { now: new Date("2026-10-25T08:00:00Z"), timeZone: TZ };
    const form = editFormDefaults(second, fallCtx);
    expect(form).toMatchObject({ day: "today", time: "01:30" });
    const result = validateEdit(form, second, fallCtx);
    expect(result.ok && result.meal.occurredAt.toISOString()).toBe("2026-10-24T23:30:00.000Z");
  });

  it("keeps the instant of a meal from two days back when the form is saved unchanged", () => {
    const older = { ...previous(), occurredAt: new Date("2027-01-10T12:00:00Z") };
    const result = validateEdit(editFormDefaults(older, ctx), older, ctx);
    expect(result.ok && result.meal.occurredAt.toISOString()).toBe("2027-01-10T12:00:00.000Z");
  });
});

describe("validateEdit: foods", () => {
  it("drops rows with an empty name and keeps the rest in order", () => {
    const result = validateEdit(withRows([row({ name: "  " }), row({ name: "tea" }), row({ name: "" }), row({ name: "jam" })]), previous(), ctx);
    expect(result.ok && result.meal.items.map((i) => i.name)).toEqual(["tea", "jam"]);
  });

  it("sanitizes names", () => {
    const result = validateEdit(withRows([row({ name: "  fried    egg " })]), previous(), ctx);
    expect(result.ok && result.meal.items[0].name).toBe("fried egg");
  });

  it("drops a row whose 'name' is a link or markup, like an empty one", () => {
    const result = validateEdit(withRows([row({ name: "http://x.example" }), row({ name: "<b>" }), row({ name: "tea" })]), previous(), ctx);
    expect(result.ok && result.meal.items.map((i) => i.name)).toEqual(["tea"]);
  });

  it("marks every food as reviewed (no 'maybe')", () => {
    const result = validateEdit(withRows([row({ name: "tea", orig: "0" })]), previous(), ctx);
    expect(result.ok && result.meal.items.every((i) => !i.uncertain)).toBe(true);
  });

  it("gives no_items when nothing is left", () => {
    expect(validateEdit(withRows([]), previous(), ctx)).toEqual({ ok: false, errors: [{ code: "no_items" }] });
    expect(validateEdit(withRows([row(), row({ name: " " })]), previous(), ctx)).toEqual({ ok: false, errors: [{ code: "no_items" }] });
  });

  it("accepts 20 foods and gives too_many_items for 21", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => row({ name: `food${i}` }));
    expect(validateEdit(withRows(many(20)), previous(), ctx).ok).toBe(true);
    expect(validateEdit(withRows(many(21)), previous(), ctx)).toEqual({ ok: false, errors: [{ code: "too_many_items" }] });
  });

  it("counts the name cap in code points, so 80 emoji fit and 81 do not", () => {
    expect(validateEdit(withRows([row({ name: "🍎".repeat(80) })]), previous(), ctx).ok).toBe(true);
    expect(validateEdit(withRows([row({ name: "🍎".repeat(81) })]), previous(), ctx)).toEqual({
      ok: false,
      errors: [{ code: "name_too_long", row: 0, field: "name" }],
    });
  });

  it("gives name_too_long with the row, at 81 code points and not at 80", () => {
    expect(validateEdit(withRows([row({ name: "א".repeat(80) })]), previous(), ctx).ok).toBe(true);
    expect(validateEdit(withRows([row({ name: "tea" }), row({ name: "א".repeat(81) })]), previous(), ctx)).toEqual({
      ok: false,
      errors: [{ code: "name_too_long", row: 1, field: "name" }],
    });
  });
});

describe("validateEdit: portions", () => {
  const portionOf = (r: EditRowValues, orig = previous()) => {
    const result = validateEdit(withRows([r]), orig, ctx);
    return result.ok ? result.meal.items[0].portion : result;
  };

  it("reads a size and no portion", () => {
    expect(portionOf(row({ name: "x", portion: "large" }))).toEqual({ kind: "size", size: "large", estimated: false });
    expect(portionOf(row({ name: "x", portion: "" }))).toBeNull();
  });

  it("reads an exact amount and unit", () => {
    expect(portionOf(row({ name: "x", portion: "amount", amount: "2", unit: "cup" }))).toEqual({ kind: "amount", amount: 2, unit: "cup", estimated: false });
  });

  it("accepts a comma or a dot as the decimal separator", () => {
    expect(portionOf(row({ name: "x", portion: "amount", amount: "1,5", unit: "cup" }))).toMatchObject({ amount: 1.5 });
    expect(portionOf(row({ name: "x", portion: "amount", amount: "1.5", unit: "cup" }))).toMatchObject({ amount: 1.5 });
    expect(portionOf(row({ name: "x", portion: "amount", amount: " 0.25 ", unit: "cup" }))).toMatchObject({ amount: 0.25 });
  });

  it("lets a typed amount win over a chosen size", () => {
    expect(portionOf(row({ name: "x", portion: "small", amount: "3", unit: "piece" }))).toEqual({ kind: "amount", amount: 3, unit: "piece", estimated: false });
    expect(portionOf(row({ name: "x", portion: "", amount: "3", unit: "piece" }))).toMatchObject({ kind: "amount" });
  });

  it("ignores a unit with no amount when no exact amount was chosen", () => {
    expect(portionOf(row({ name: "x", portion: "", amount: "", unit: "cup" }))).toBeNull();
    expect(portionOf(row({ name: "x", portion: "medium", amount: "", unit: "cup" }))).toMatchObject({ kind: "size" });
  });

  it("matches the unit case-insensitively", () => {
    expect(portionOf(row({ name: "x", portion: "amount", amount: "1", unit: "CUP" }))).toMatchObject({ unit: "cup" });
  });

  it.each(["abc", "0", "0.0", "-1", "1e3", "1..5", "1,5,5", "٣", "", "21"])("gives amount_invalid for %j (cups)", (amount) => {
    expect(portionOf(row({ name: "x", portion: "amount", amount, unit: "cup" }))).toEqual({
      ok: false,
      errors: [{ code: "amount_invalid", row: 0, field: "amount" }],
    });
  });

  // Within the range of grams, so only the shape of the number can reject these.
  it.each(["1e3", "0x10", "1_0", "+5", "5 5"])("gives amount_invalid for %j (grams)", (amount) => {
    expect(portionOf(row({ name: "x", portion: "amount", amount, unit: "gram" }))).toEqual({
      ok: false,
      errors: [{ code: "amount_invalid", row: 0, field: "amount" }],
    });
  });

  it("accepts the largest amount of a unit and rejects one above it", () => {
    expect(portionOf(row({ name: "x", amount: "20", unit: "cup" }))).toMatchObject({ amount: 20 });
    expect(portionOf(row({ name: "x", amount: "3000", unit: "gram" }))).toMatchObject({ amount: 3000 });
    expect(portionOf(row({ name: "x", amount: "3001", unit: "gram" }))).toMatchObject({ ok: false });
  });

  it("gives unit_missing when the amount has no (or an unknown) unit", () => {
    for (const unit of ["", "  ", "barrel"]) {
      expect(portionOf(row({ name: "x", amount: "2", unit }))).toEqual({ ok: false, errors: [{ code: "unit_missing", row: 0, field: "unit" }] });
    }
  });

  it("reports both problems of an 'exact amount' row with nothing filled in", () => {
    expect(portionOf(row({ name: "x", portion: "amount" }))).toEqual({
      ok: false,
      errors: [
        { code: "unit_missing", row: 0, field: "unit" },
        { code: "amount_invalid", row: 0, field: "amount" },
      ],
    });
  });

  it("points at the row in the submitted order, even after empty rows", () => {
    const result = validateEdit(withRows([row(), row({ name: "tea" }), row({ name: "jam", amount: "x", unit: "cup" })]), previous(), ctx);
    expect(result).toEqual({ ok: false, errors: [{ code: "amount_invalid", row: 2, field: "amount" }] });
  });
});

describe("validateEdit: 'estimated' is kept only for a portion that did not change", () => {
  const estimatedOf = (r: EditRowValues) => {
    const result = validateEdit(withRows([r]), previous(), ctx);
    return result.ok ? result.meal.items[0].portion : null;
  };

  it("keeps it for the same amount and unit of the original row", () => {
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "0" }))).toEqual({
      kind: "amount",
      amount: 2,
      unit: "slice",
      estimated: true,
    });
  });

  it("keeps it for the same size of the original row", () => {
    expect(estimatedOf(row({ name: "cake", portion: "small", orig: "2" }))).toEqual({ kind: "size", size: "small", estimated: true });
  });

  it("drops it when the amount, the unit or the kind changed", () => {
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "3", unit: "slice", orig: "0" }))).toMatchObject({ estimated: false });
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "2", unit: "piece", orig: "0" }))).toMatchObject({ estimated: false });
    expect(estimatedOf(row({ name: "bread", portion: "large", orig: "0" }))).toMatchObject({ estimated: false });
    expect(estimatedOf(row({ name: "cake", portion: "large", orig: "2" }))).toMatchObject({ estimated: false });
  });

  it("is false for a row the user added, or one that points at a row that does not exist", () => {
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "" }))).toMatchObject({ estimated: false });
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "9" }))).toMatchObject({ estimated: false });
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "-1" }))).toMatchObject({ estimated: false });
    expect(estimatedOf(row({ name: "bread", portion: "amount", amount: "2", unit: "slice", orig: "abc" }))).toMatchObject({ estimated: false });
  });

  it("stays null when the portion was removed", () => {
    expect(estimatedOf(row({ name: "bread", portion: "", orig: "0" }))).toBeNull();
  });
});

describe("validateEdit: meal type and time", () => {
  it("gives meal_type_invalid for a type that is not in the list", () => {
    expect(validateEdit({ ...defaults(), mealType: "brunch" }, previous(), ctx)).toEqual({
      ok: false,
      errors: [{ code: "meal_type_invalid", field: "mealType" }],
    });
    expect(validateEdit({ ...defaults(), mealType: "" }, previous(), ctx).ok).toBe(false);
  });

  it("accepts every valid type", () => {
    for (const mealType of ["breakfast", "lunch", "dinner", "snack", "other"]) {
      const result = validateEdit({ ...defaults(), mealType }, previous(), ctx);
      expect(result.ok && result.meal.mealType).toBe(mealType);
    }
  });

  it("builds a new instant to the minute when the time changed", () => {
    const result = validateEdit({ ...defaults(), time: "08:00" }, previous(), ctx);
    expect(result.ok && result.meal.occurredAt.toISOString()).toBe("2027-01-12T06:00:00.000Z");
  });

  it("builds yesterday when the day changed", () => {
    const result = validateEdit({ ...defaults(), day: "yesterday" }, previous(), ctx);
    expect(result.ok && result.meal.occurredAt.toISOString()).toBe("2027-01-11T05:42:00.000Z");
  });

  it.each(["", "25:00", "7:5", "noon", "12:60"])("gives time_invalid for the time %j", (time) => {
    expect(validateEdit({ ...defaults(), time }, previous(), ctx)).toEqual({ ok: false, errors: [{ code: "time_invalid", field: "time" }] });
  });

  it("gives time_invalid on the day field for a day that is not today or yesterday", () => {
    expect(validateEdit({ ...defaults(), day: "tomorrow" }, previous(), ctx)).toEqual({ ok: false, errors: [{ code: "time_invalid", field: "day" }] });
    expect(validateEdit({ ...defaults(), day: "" }, previous(), ctx)).toEqual({ ok: false, errors: [{ code: "time_invalid", field: "day" }] });
  });

  it("gives time_future for a time more than 5 minutes ahead, and accepts exactly 5", () => {
    expect(validateEdit({ ...defaults(), time: "20:00" }, previous(), ctx)).toEqual({ ok: false, errors: [{ code: "time_future", field: "time" }] });
    expect(validateEdit({ ...defaults(), time: "12:35" }, previous(), ctx).ok).toBe(true);
    expect(validateEdit({ ...defaults(), time: "12:36" }, previous(), ctx)).toMatchObject({ ok: false });
  });

  it("gives time_too_old when a saved-unchanged meal has fallen out of the 48 hour window", () => {
    const old = { ...previous(), occurredAt: new Date("2027-01-09T10:00:00Z") };
    expect(validateEdit(editFormDefaults(old, ctx), old, ctx)).toEqual({ ok: false, errors: [{ code: "time_too_old", field: "time" }] });
  });

  it("reports errors of the foods and of the time together", () => {
    const result = validateEdit(
      withRows([row({ name: "x", amount: "abc", unit: "cup" })], { mealType: "nope", time: "99:99" }),
      previous(),
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { code: "amount_invalid", row: 0, field: "amount" },
        { code: "meal_type_invalid", field: "mealType" },
        { code: "time_invalid", field: "time" },
      ],
    });
  });

  it("works in another zone", () => {
    const utc = { now: NOW, timeZone: "UTC" };
    const form = editFormDefaults(previous(), utc);
    expect(form).toMatchObject({ day: "today", time: "05:42" });
    const result = validateEdit({ ...form, time: "06:00" }, previous(), utc);
    expect(result.ok && result.meal.occurredAt.toISOString()).toBe("2027-01-12T06:00:00.000Z");
  });
});
