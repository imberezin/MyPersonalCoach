/**
 * What the user changed between two versions of a meal (the AI's proposal and the final one).
 * It feeds the correction-rate metric and the `ai_edited` / `ai_unedited` source. Content-free.
 */
import { portionsEqual } from "./portion";
import type { FoodItem, MealDraft } from "./types";

export interface MealDiff {
  foodChanged: boolean;
  portionChanged: boolean;
  typeChanged: boolean;
  timeChanged: boolean;
  added: number;
  removed: number;
}

const nameKey = (name: string): string => name.normalize("NFC").trim().toLowerCase();

/** Items grouped by case-folded name; a name used twice keeps both items in order. */
function byName(items: readonly FoodItem[]): Map<string, FoodItem[]> {
  const map = new Map<string, FoodItem[]>();
  for (const item of items) {
    const key = nameKey(item.name);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

const minuteOf = (at: Date): number => Math.floor(at.getTime() / 60_000);

/**
 * Items are matched by case-folded name. `uncertain` is ignored (a review that changes nothing is not
 * a correction). Time compares to the minute. A rename counts as one removed and one added.
 */
export function diffMeal(before: MealDraft, after: MealDraft): MealDiff {
  const was = byName(before.items);
  const now = byName(after.items);

  let added = 0;
  let removed = 0;
  let portionChanged = false;

  for (const [key, list] of now) {
    const old = was.get(key) ?? [];
    list.forEach((item, i) => {
      if (i >= old.length) added += 1;
      else if (!portionsEqual(old[i].portion, item.portion)) portionChanged = true;
    });
  }
  for (const [key, list] of was) {
    const kept = now.get(key)?.length ?? 0;
    removed += Math.max(0, list.length - kept);
  }

  return {
    foodChanged: added > 0 || removed > 0,
    portionChanged,
    typeChanged: before.mealType !== after.mealType,
    timeChanged: minuteOf(before.occurredAt) !== minuteOf(after.occurredAt),
    added,
    removed,
  };
}

export function isDiffEmpty(d: MealDiff): boolean {
  return !d.foodChanged && !d.portionChanged && !d.typeChanged && !d.timeChanged && d.added === 0 && d.removed === 0;
}
