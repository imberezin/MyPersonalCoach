import { MEAL_NOTICES } from "@/domain/food/routes";

const leaves = (prefix: string, names: readonly string[]) => names.map((name) => `${prefix}.${name}`);

/**
 * The copy "My meals" reads, as dotted keys from the catalog root, plus the two lines the Me page adds.
 * This is the contract with whoever renders it: meals.messages.test.ts demands every key in he.json and
 * en.json, and refuses a key in the `meals` namespace that nothing here lists. The notices come from the
 * domain list, so a new notice cannot ship without its words.
 */
export const MEALS_MESSAGE_KEYS: readonly string[] = [
  ...leaves("meals", ["title", "lead", "back", "listLabel", "more", "capNote"]),
  "meals.meta.title",
  ...leaves("meals.row", ["when", "more", "noFoods", "delete", "deleteThis"]),
  ...leaves("meals.confirm", ["title", "body", "keep", "delete", "deleting"]),
  ...MEAL_NOTICES.map((notice) => `meals.notice.${notice}`),
  ...leaves("meals.empty", ["title", "body"]),
  ...leaves("meals.unavailable", ["title", "body", "retry"]),
  ...leaves("me", ["mealsLink", "mealsHint"]),
];
