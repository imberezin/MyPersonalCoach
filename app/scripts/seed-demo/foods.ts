import type { FoodItem, MealType } from "@/domain/food/types";

/**
 * The demo foods: realistic, Hebrew, and neutral (no food is flagged, grouped or scored anywhere). A dish is the list of
 * items one meal is made of; the plan turns it into the stored `items` with the app's own helpers.
 */
export type Dish = readonly FoodItem[];

export type FoodSlot = "breakfast" | "lunch" | "dinner" | "snack" | "late";

const size = (s: "small" | "medium" | "large") => ({ kind: "size", size: s, estimated: true }) as const;
const amount = (n: number, unit: "piece" | "slice" | "cup" | "bowl" | "plate" | "handful" | "tablespoon") =>
  ({ kind: "amount", amount: n, unit, estimated: false }) as const;
const item = (name: string, portion: FoodItem["portion"] = null): FoodItem => ({ name, portion, uncertain: false });

export const FOODS: Readonly<Record<FoodSlot, readonly Dish[]>> = {
  breakfast: [
    [item("ביצים", amount(2, "piece")), item("סלט", size("medium"))],
    [item("יוגורט", amount(1, "cup")), item("גרנולה", amount(2, "tablespoon"))],
    [item("לחם", amount(2, "slice")), item("גבינה לבנה", amount(2, "tablespoon"))],
    [item("קפה עם חלב", amount(1, "cup"))],
  ],
  lunch: [
    [item("שניצל", size("medium")), item("אורז", amount(1, "cup"))],
    [item("עוף", size("medium")), item("ירקות", size("large"))],
    [item("פסטה", amount(1, "plate"))],
    [item("סלט טונה", amount(1, "bowl"))],
  ],
  dinner: [
    [item("חביתה", amount(2, "piece")), item("סלט", size("medium"))],
    [item("מרק עדשים", amount(1, "bowl"))],
    [item("פיתה", amount(1, "piece")), item("חומוס", amount(3, "tablespoon"))],
  ],
  snack: [
    [item("תפוח", amount(1, "piece"))],
    [item("שקדים", amount(1, "handful"))],
    [item("עוגיות", amount(3, "piece"))],
  ],
  late: [
    [item("קערת דגנים עם חלב", amount(1, "bowl"))],
    [item("פרוסת לחם", amount(1, "slice")), item("גבינה", size("small"))],
    [item("יוגורט", amount(1, "cup"))],
    [item("תה"), item("עוגיה", amount(1, "piece"))],
  ],
};

/** The stored `meal_type` of a slot. A late-evening meal is a snack; the database knows no "late". */
export function mealTypeOfSlot(slot: FoodSlot): MealType {
  return slot === "late" ? "snack" : slot;
}
