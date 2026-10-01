/**
 * The model of the edit form (D7): the field names, reading a submitted form, the values it starts
 * with, and turning what was typed back into a meal or a list of typed errors. Pure, and it never
 * throws for user input; the form works without JavaScript, so everything here reads plain strings.
 */
import { checkOccurredAt, instantFromDayAndTime, localDayAndTime } from "./occurredAt";
import { isMealType } from "./mealType";
import { buildPortion, parseLocalTime, portionsEqual } from "./portion";
import { cleanFoodNameText, sanitizeFoodName } from "./sanitize";
import {
  FOOD_LIMITS,
  PORTION_AMOUNT_MAX,
  PORTION_UNITS,
  type FoodItem,
  type MealDraft,
  type Portion,
  type PortionUnit,
} from "./types";

export const EDIT_FORM = { rowCount: "rowCount", mealType: "mealType", day: "day", time: "time", maxRows: 40 } as const;

/** "food_0_name": the name of a form field of the row at `index`. */
export function rowField(index: number, field: "name" | "portion" | "amount" | "unit" | "orig"): string {
  return `food_${index}_${field}`;
}

export interface EditRowValues {
  name: string;
  portion: "" | "small" | "medium" | "large" | "amount";
  amount: string;
  unit: string;
  /** Index of the original item this row came from, "" for a row the user added. */
  orig: string;
}

export interface EditFormValues {
  rows: EditRowValues[];
  mealType: string;
  day: string;
  time: string;
}

export type EditErrorCode =
  | "no_items"
  | "too_many_items"
  | "name_too_long"
  | "amount_invalid"
  | "unit_missing"
  | "meal_type_invalid"
  | "time_invalid"
  | "time_future"
  | "time_too_old"
  /** The draft could not be written (a database or session problem); no field is at fault. */
  | "not_saved";

export interface EditError {
  code: EditErrorCode;
  /** Index in the submitted rows (the same index `rowField` uses). */
  row?: number;
  field?: "name" | "amount" | "unit" | "mealType" | "day" | "time";
}

export type EditFormState = { status: "error"; errors: EditError[]; values: EditFormValues } | null;

const PORTION_CHOICES = ["", "small", "medium", "large", "amount"] as const;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Tolerant: a missing or odd field reads as "". The row count is clamped to 0..maxRows. */
export function readEditForm(data: { get(name: string): unknown }): EditFormValues {
  const requested = Number.parseInt(text(data.get(EDIT_FORM.rowCount)), 10);
  const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), EDIT_FORM.maxRows) : 0;

  const rows: EditRowValues[] = [];
  for (let i = 0; i < count; i++) {
    const portion = text(data.get(rowField(i, "portion")));
    rows.push({
      name: text(data.get(rowField(i, "name"))),
      portion: (PORTION_CHOICES as readonly string[]).includes(portion) ? (portion as EditRowValues["portion"]) : "",
      amount: text(data.get(rowField(i, "amount"))),
      unit: text(data.get(rowField(i, "unit"))),
      orig: text(data.get(rowField(i, "orig"))),
    });
  }

  return {
    rows,
    mealType: text(data.get(EDIT_FORM.mealType)),
    day: text(data.get(EDIT_FORM.day)),
    time: text(data.get(EDIT_FORM.time)),
  };
}

/**
 * The day the form offers: only "today" or "yesterday". A meal from further back (a report left
 * open past midnight) shows as "yesterday"; saving the form unchanged still keeps its exact instant.
 */
function formDayAndTime(meal: MealDraft, ctx: { now: Date; timeZone: string }): { day: "today" | "yesterday"; time: string } {
  const { day, time } = localDayAndTime(meal.occurredAt, ctx.now, ctx.timeZone);
  return { day: day === "today" ? "today" : "yesterday", time };
}

function rowDefaults(item: FoodItem, index: number): EditRowValues {
  const p = item.portion;
  return {
    name: item.name,
    portion: p === null ? "" : p.kind === "size" ? p.size : "amount",
    amount: p?.kind === "amount" ? String(p.amount) : "",
    unit: p?.kind === "amount" ? p.unit : "",
    orig: String(index),
  };
}

/** What the form starts with for a meal. */
export function editFormDefaults(meal: MealDraft, ctx: { now: Date; timeZone: string }): EditFormValues {
  const { day, time } = formDayAndTime(meal, ctx);
  return { rows: meal.items.map(rowDefaults), mealType: meal.mealType, day, time };
}

const codePointLength = (value: string): number => Array.from(value).length;

/** "1,5" and "1.5" are the same; anything but digits and one separator is not a number. */
function parseAmount(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** The portion a row asks for, or the errors that stop it. An amount that was typed wins over a size. */
function readPortion(row: EditRowValues, index: number): { portion: Portion | null; errors: EditError[] } {
  const wantsAmount = row.amount.trim() !== "" || row.portion === "amount";
  if (wantsAmount) {
    const errors: EditError[] = [];
    const unit = row.unit.trim().toLowerCase();
    const knownUnit = (PORTION_UNITS as readonly string[]).includes(unit) ? (unit as PortionUnit) : null;
    if (knownUnit === null) errors.push({ code: "unit_missing", row: index, field: "unit" });

    const amount = parseAmount(row.amount);
    const inRange = amount !== null && amount > 0 && (knownUnit === null || amount <= PORTION_AMOUNT_MAX[knownUnit]);
    if (!inRange) errors.push({ code: "amount_invalid", row: index, field: "amount" });

    if (errors.length > 0) return { portion: null, errors };
    // Both checks passed, but a tiny amount can still round to 0: buildPortion has the last word.
    const portion = buildPortion({ amount, unit: knownUnit, estimated: false });
    return portion ? { portion, errors: [] } : { portion: null, errors: [{ code: "amount_invalid", row: index, field: "amount" }] };
  }
  if (row.portion === "small" || row.portion === "medium" || row.portion === "large") {
    return { portion: { kind: "size", size: row.portion, estimated: false }, errors: [] };
  }
  return { portion: null, errors: [] };
}

/**
 * Rules: rows with an empty name are dropped (so is a "name" that is a link or markup); amount accepts
 * "1,5" and "1.5"; the amount wins over a size; estimated is kept only for a row whose portion is
 * unchanged vs previous.items[orig], otherwise false; every row is marked uncertain=false (the user
 * reviewed it); day+time unchanged from the defaults keeps previous.occurredAt exactly. Error `row`
 * is the index among the submitted rows, so a message can point at the field that caused it.
 */
export function validateEdit(
  values: EditFormValues,
  previous: MealDraft,
  ctx: { now: Date; timeZone: string },
): { ok: true; meal: MealDraft } | { ok: false; errors: EditError[] } {
  const errors: EditError[] = [];
  const items: FoodItem[] = [];

  values.rows.forEach((row, index) => {
    const cleaned = cleanFoodNameText(row.name);
    if (cleaned === null) return; // empty (or not a food name at all): the row is dropped
    if (codePointLength(cleaned) > FOOD_LIMITS.nameMax) {
      errors.push({ code: "name_too_long", row: index, field: "name" });
      return;
    }
    const name = sanitizeFoodName(cleaned);
    if (name === null) return;

    const read = readPortion(row, index);
    errors.push(...read.errors);

    // `estimated` describes the AI's guess, so it survives only while the portion is the AI's portion.
    const origIndex = row.orig.trim() === "" ? -1 : Number.parseInt(row.orig, 10);
    const original = Number.isInteger(origIndex) ? (previous.items[origIndex] ?? null) : null;
    const portion = read.portion !== null && original !== null && portionsEqual(read.portion, original.portion) ? original.portion : read.portion;

    items.push({ name, portion, uncertain: false });
  });

  if (items.length === 0 && errors.length === 0) errors.push({ code: "no_items" });
  else if (items.length > FOOD_LIMITS.itemsMax) errors.push({ code: "too_many_items" });

  if (!isMealType(values.mealType)) errors.push({ code: "meal_type_invalid", field: "mealType" });

  const occurredAt = resolveInstant(values, previous, ctx, errors);

  if (errors.length > 0 || occurredAt === null || !isMealType(values.mealType)) return { ok: false, errors };
  return { ok: true, meal: { items, mealType: values.mealType, occurredAt } };
}

/** The meal time the form asks for, pushing an error and returning null when it is not acceptable. */
function resolveInstant(
  values: EditFormValues,
  previous: MealDraft,
  ctx: { now: Date; timeZone: string },
  errors: EditError[],
): Date | null {
  const defaults = formDayAndTime(previous, ctx);
  const unchanged = values.day === defaults.day && parseLocalTime(values.time) === parseLocalTime(defaults.time);

  let at: Date | null;
  if (unchanged) {
    at = previous.occurredAt;
  } else if (parseLocalTime(values.time) === null) {
    errors.push({ code: "time_invalid", field: "time" });
    return null;
  } else if (values.day !== "today" && values.day !== "yesterday") {
    errors.push({ code: "time_invalid", field: "day" });
    return null;
  } else {
    at = instantFromDayAndTime(values.day, values.time, ctx.now, ctx.timeZone);
  }

  if (at === null) {
    errors.push({ code: "time_invalid", field: "time" });
    return null;
  }
  const window = checkOccurredAt(at, ctx.now);
  if (window === "future") errors.push({ code: "time_future", field: "time" });
  if (window === "too_old") errors.push({ code: "time_too_old", field: "time" });
  return window === "ok" ? at : null;
}
