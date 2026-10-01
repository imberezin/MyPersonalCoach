/**
 * Reading what comes back from the database: the JSON columns of an understanding and its draft.
 * Everything is re-validated with Zod, because a column is only as trustworthy as the last writer.
 * A shape that does not parse gives `null`, never a throw: the page shows the calm "not available"
 * state instead of crashing.
 */
import { z } from "zod";
import { sanitizeFoodName, sanitizeUnclear } from "./sanitize";
import {
  FOOD_LIMITS,
  MEAL_TYPES,
  PORTION_AMOUNT_MAX,
  PORTION_SIZES,
  PORTION_UNITS,
  type ConfirmedItem,
  type FoodItem,
  type MealDraft,
  type Portion,
  type Understanding,
  type UnderstoodItem,
} from "./types";

/** The database caps (jsonb_array_length) are looser than the product caps; reading honors the database's. */
const STORED_ITEMS_MAX = 30;
const STORED_UNCLEAR_MAX = 10;

const portionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("size"), size: z.enum(PORTION_SIZES), estimated: z.boolean() }),
  z
    .object({ kind: z.literal("amount"), amount: z.number().positive(), unit: z.enum(PORTION_UNITS), estimated: z.boolean() })
    .refine((p) => p.amount <= PORTION_AMOUNT_MAX[p.unit]),
]);

/** A stored name goes through the same sanitizer as a new one; one that sanitizes to nothing makes the row unreadable. */
const nameSchema = z
  .string()
  .max(FOOD_LIMITS.nameMax * 4)
  .transform((value, ctx) => {
    const clean = sanitizeFoodName(value);
    if (clean === null) {
      ctx.addIssue({ code: "custom", message: "not a food name" });
      return z.NEVER;
    }
    return clean;
  });

const draftItemSchema = z.object({ name: nameSchema, portion: portionSchema.nullable(), uncertain: z.boolean() });
const understoodItemSchema = draftItemSchema.extend({ confidence: z.number().min(0).max(1) });

const mealTypeSchema = z.enum(MEAL_TYPES);

const dateSchema = z
  .string()
  .max(64)
  .transform((value, ctx) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "not a date" });
      return z.NEVER;
    }
    return date;
  });

const draftSchema = z.object({
  items: z.array(draftItemSchema).max(STORED_ITEMS_MAX),
  mealType: mealTypeSchema,
  occurredAt: dateSchema,
});

/** Advisory text: an entry that cannot be shown safely is left out rather than failing the report. */
const unclearSchema = z
  .array(z.string().max(FOOD_LIMITS.unclearTextMax * 4))
  .max(STORED_UNCLEAR_MAX)
  .transform((list) => list.map(sanitizeUnclear).filter((s): s is string => s !== null).slice(0, FOOD_LIMITS.unclearMax));

/** PostgREST returns a numeric as a number, but a driver may hand it over as a string. */
const confidenceSchema = z
  .union([z.number(), z.string().max(16)])
  .transform((v) => (typeof v === "number" ? v : Number(v)))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1);

/** The embedded `meal_raw_inputs(kind)`: an object for a to-one relation, a one-item array otherwise. */
const rawInputSchema = z
  .union([z.object({ kind: z.string() }), z.array(z.object({ kind: z.string() })).length(1)])
  .transform((v) => (Array.isArray(v) ? v[0].kind : v.kind))
  .pipe(z.enum(["photo", "text"]));

const rowSchema = z.object({
  id: z.string().min(1).max(64),
  provider: z.string().min(1).max(64),
  model: z.string().max(128).nullable(),
  prompt_version: z.string().max(64).nullable(),
  status: z.enum(["pending", "accepted", "edited", "rejected"]),
  items: z.array(understoodItemSchema).max(STORED_ITEMS_MAX),
  unclear: unclearSchema,
  overall_confidence: confidenceSchema.nullable(),
  proposed_meal_type: mealTypeSchema,
  proposed_occurred_at: dateSchema,
  draft: z.unknown(),
  created_at: dateSchema,
  meal_raw_inputs: rawInputSchema,
});

/** The row `repo.ts` selects (with the embedded raw input kind) as an Understanding, or null when it does not parse. */
export function parseUnderstandingRow(row: unknown): Understanding | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) return null;
  const r = parsed.data;

  // A draft that does not parse is dropped, not guessed: the proposal is still a valid meal.
  const draft = r.draft === null || r.draft === undefined ? null : parseDraft(r.draft);
  if (r.draft !== null && r.draft !== undefined && draft === null) return null;

  return {
    id: r.id,
    kind: r.meal_raw_inputs,
    provider: r.provider,
    model: r.model,
    promptVersion: r.prompt_version,
    status: r.status,
    items: r.items,
    unclear: r.unclear,
    overallConfidence: r.overall_confidence,
    proposed: { mealType: r.proposed_meal_type, occurredAt: r.proposed_occurred_at },
    draft,
    createdAt: r.created_at,
  };
}

/** `understanding.draft`: { items, mealType, occurredAt (ISO string) } as a MealDraft, or null. */
export function parseDraft(json: unknown): MealDraft | null {
  const parsed = draftSchema.safeParse(json);
  if (!parsed.success) return null;
  return { items: parsed.data.items, mealType: parsed.data.mealType, occurredAt: parsed.data.occurredAt };
}

function portionToJson(portion: Portion | null): unknown {
  if (portion === null) return null;
  return portion.kind === "size"
    ? { kind: "size", size: portion.size, estimated: portion.estimated }
    : { kind: "amount", amount: portion.amount, unit: portion.unit, estimated: portion.estimated };
}

/** The value to write to `meal_understandings.draft`. */
export function draftToJson(meal: MealDraft): unknown {
  return {
    items: meal.items.map((i: FoodItem) => ({ name: i.name, portion: portionToJson(i.portion), uncertain: i.uncertain })),
    mealType: meal.mealType,
    occurredAt: meal.occurredAt.toISOString(),
  };
}

/**
 * Items for a jsonb column. An understanding's items keep `uncertain` and `confidence`; a confirmed
 * meal's items are name and portion only, so nothing about the AI's doubt is stored in `meal_entries`.
 */
export function itemsToJson(items: readonly UnderstoodItem[] | readonly ConfirmedItem[]): unknown {
  return (items as readonly (Partial<UnderstoodItem> & ConfirmedItem)[]).map((item) => {
    const out: Record<string, unknown> = { name: item.name, portion: portionToJson(item.portion) };
    if (item.uncertain !== undefined) out.uncertain = item.uncertain;
    if (item.confidence !== undefined) out.confidence = item.confidence;
    return out;
  });
}
