/**
 * Which meal it was, from the clock. The AI only says a meal type when the input names it
 * ("breakfast", "for dinner"); otherwise the time of day decides, never the food ("pizza" is not dinner).
 */
import { MEAL_TYPES, type MealType } from "./types";

/**
 * Wall-clock windows, minutes since local midnight. `fromMinute` is inclusive, `toMinute` exclusive;
 * a window whose `toMinute` is below its `fromMinute` wraps past midnight. Tunable constants.
 */
export const MEAL_TYPE_WINDOWS: readonly { type: MealType; fromMinute: number; toMinute: number }[] = [
  { type: "breakfast", fromMinute: 5 * 60, toMinute: 11 * 60 },
  { type: "lunch", fromMinute: 11 * 60, toMinute: 16 * 60 },
  { type: "snack", fromMinute: 16 * 60, toMinute: 18 * 60 },
  { type: "dinner", fromMinute: 18 * 60, toMinute: 23 * 60 },
  { type: "snack", fromMinute: 23 * 60, toMinute: 5 * 60 },
];

/** The time assumed when the text says "yesterday evening" and gives no clock time. */
export const MEAL_TYPE_DEFAULT_MINUTE: Readonly<Record<MealType, number>> = {
  breakfast: 480,
  lunch: 780,
  snack: 990,
  dinner: 1170,
  other: 720,
};

/** Total over 0..1439. A value outside the day is taken modulo 24 hours; a non-number is "other". */
export function inferMealType(minuteOfDay: number): MealType {
  if (!Number.isFinite(minuteOfDay)) return "other";
  const minute = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  for (const w of MEAL_TYPE_WINDOWS) {
    const inside =
      w.fromMinute < w.toMinute ? minute >= w.fromMinute && minute < w.toMinute : minute >= w.fromMinute || minute < w.toMinute;
    if (inside) return w.type;
  }
  return "other";
}

export function isMealType(value: unknown): value is MealType {
  return typeof value === "string" && (MEAL_TYPES as readonly string[]).includes(value);
}
