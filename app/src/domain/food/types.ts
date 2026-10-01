/**
 * The vocabulary of food reporting: what a meal is made of, how it is described, and the limits
 * every layer agrees on. Pure types and constants; the AI wire format maps onto these in src/lib/ai.
 */

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const PORTION_SIZES = ["small", "medium", "large"] as const;
export type PortionSize = (typeof PORTION_SIZES)[number];

export const PORTION_UNITS = [
  "piece",
  "slice",
  "cup",
  "bowl",
  "plate",
  "tablespoon",
  "teaspoon",
  "handful",
  "can",
  "bottle",
  "gram",
  "ml",
] as const;
export type PortionUnit = (typeof PORTION_UNITS)[number];

/** The largest amount that is believable for one food, per unit. Above it a portion is dropped, not clamped. */
export const PORTION_AMOUNT_MAX: Readonly<Record<PortionUnit, number>> = {
  piece: 50,
  slice: 50,
  cup: 20,
  bowl: 10,
  plate: 10,
  tablespoon: 50,
  teaspoon: 50,
  handful: 20,
  can: 20,
  bottle: 20,
  gram: 3000,
  ml: 5000,
};

/** `estimated` is true when the amount was inferred (from a photo, or a vague word like "about a cup"). */
export type Portion =
  | { kind: "size"; size: PortionSize; estimated: boolean }
  | { kind: "amount"; amount: number; unit: PortionUnit; estimated: boolean };

export interface FoodItem {
  name: string;
  portion: Portion | null;
  uncertain: boolean;
}

/** `confidence` lives on the understanding only; it never reaches a confirmed meal or the screen. */
export interface UnderstoodItem extends FoodItem {
  confidence: number;
}

export interface ConfirmedItem {
  name: string;
  portion: Portion | null;
}

export const FOOD_LIMITS = { nameMax: 80, itemsMax: 20, textMax: 500, unclearMax: 5, unclearTextMax: 120, uncertainBelow: 0.6 } as const;

/** How the user told it. */
export type ReportMode = "photo" | "text";

export type MealSource = "ai_unedited" | "ai_edited" | "user_manual";
export type UnderstandingStatus = "pending" | "accepted" | "edited" | "rejected";

/** The user's working copy of a meal: what D6 shows and D7 edits. */
export interface MealDraft {
  items: FoodItem[];
  mealType: MealType;
  occurredAt: Date;
}

/** What the AI said about when, as hints. The code turns them into an instant (occurredAt.ts). */
export interface TimeHint {
  day: "today" | "yesterday";
  minuteOfDay: number | null;
}

/** The validated, normalized AI answer. */
export interface UnderstoodMeal {
  items: UnderstoodItem[];
  unclear: string[];
  overallConfidence: number;
  mealTypeHint: MealType | null;
  timeHint: TimeHint | null;
  notFood: boolean;
}

/** A stored understanding of one report (a `meal_understandings` row with its raw input kind). */
export interface Understanding {
  id: string;
  kind: ReportMode;
  /** "gemini" | "groq" | "fake" | "manual" */
  provider: string;
  model: string | null;
  promptVersion: string | null;
  status: UnderstandingStatus;
  items: UnderstoodItem[];
  unclear: string[];
  overallConfidence: number | null;
  proposed: { mealType: MealType; occurredAt: Date };
  draft: MealDraft | null;
  createdAt: Date;
}
