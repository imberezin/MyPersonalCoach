/**
 * The meal the user is working on: the AI's proposal until they edit it, then their draft. These
 * functions decide what gets saved, with which source, and fingerprint what the screen showed.
 */
import { diffMeal, isDiffEmpty } from "./diff";
import { checkOccurredAt } from "./occurredAt";
import { FOOD_LIMITS, type ConfirmedItem, type FoodItem, type MealDraft, type MealSource, type Portion, type Understanding } from "./types";

type DraftSource = Pick<Understanding, "items" | "proposed" | "draft">;

const toFoodItem = (item: FoodItem): FoodItem => ({ name: item.name, portion: item.portion, uncertain: item.uncertain });

/** The AI's proposal as a meal (items without confidence). */
function proposalOf(u: Pick<Understanding, "items" | "proposed">): MealDraft {
  return { items: u.items.map(toFoodItem), mealType: u.proposed.mealType, occurredAt: u.proposed.occurredAt };
}

/** The user's draft if there is one, else the proposal. */
export function mealOf(u: DraftSource): MealDraft {
  return u.draft ?? proposalOf(u);
}

/** Whether the meal differs from the proposal in a way that counts as a correction (see diffMeal). */
export function isMealEdited(u: DraftSource): boolean {
  return u.draft !== null && !isDiffEmpty(diffMeal(proposalOf(u), u.draft));
}

/** A manual report is always `user_manual`; otherwise edited or not, compared with the proposal. */
export function mealSource(u: Pick<Understanding, "provider" | "items" | "proposed" | "draft">): MealSource {
  if (u.provider === "manual") return "user_manual";
  return isMealEdited(u) ? "ai_edited" : "ai_unedited";
}

// ---------------------------------------------------------------------------
// Revision: a short fingerprint of exactly what the confirm screen shows
// ---------------------------------------------------------------------------

function portionKey(p: Portion | null): unknown {
  if (p === null) return null;
  return p.kind === "size"
    ? { kind: p.kind, size: p.size, estimated: p.estimated }
    : { kind: p.kind, amount: p.amount, unit: p.unit, estimated: p.estimated };
}

/** JSON with every object's keys sorted, so the same meal always gives the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 8 hex characters of FNV-1a (32 bit) over the UTF-8 bytes. Not secret, not crypto: it only spots a stale page. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Fingerprint of the meal as shown: names, portions (with the "about" flag), the "maybe" flag, type
 * and the time. Stable under property order; changes with any of them. `confirmMealAction` compares
 * it with the one the form carried, to notice a page that another tab has since changed.
 */
export function revisionOf(meal: MealDraft): string {
  return fnv1a(
    canonicalJson({
      items: meal.items.map((i) => ({ name: i.name, portion: portionKey(i.portion), uncertain: i.uncertain })),
      mealType: meal.mealType,
      occurredAt: meal.occurredAt.toISOString(),
    }),
  );
}

/** What is stored in `meal_entries.items`: name and portion only; no confidence, no "maybe". */
export function toConfirmedItems(items: readonly FoodItem[]): ConfirmedItem[] {
  return items.map((i) => ({ name: i.name, portion: i.portion }));
}

/** The checks before saving: 1 to itemsMax foods, and a time inside the window. */
export function validateMealForSave(
  meal: MealDraft,
  now: Date,
): { ok: true } | { ok: false; code: "no_items" | "too_many_items" | "time_future" | "time_too_old" } {
  if (meal.items.length === 0) return { ok: false, code: "no_items" };
  if (meal.items.length > FOOD_LIMITS.itemsMax) return { ok: false, code: "too_many_items" };
  const when = checkOccurredAt(meal.occurredAt, now);
  if (when === "future") return { ok: false, code: "time_future" };
  if (when === "too_old") return { ok: false, code: "time_too_old" };
  return { ok: true };
}
