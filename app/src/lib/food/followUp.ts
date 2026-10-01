import type { LifecycleState } from "@/domain/firstWeek";

/**
 * THE seam for the optional question after a meal is saved (D8). The Behavior Engine's `decide()`
 * will fill it later; until the engine exists nothing is ever asked, and this item adds no question
 * of its own. Adding `{ kind: "ask_after_meal_feeling" }` to the type makes the exhaustive switch in
 * SavedView fail to compile until it renders it, so a new follow-up cannot be forgotten on screen.
 */
export type SavedFollowUp = { kind: "none" };

export function decideSavedFollowUp(facts: { mealId: string; isFirstMeal: boolean; lifecycle: LifecycleState }): SavedFollowUp {
  // The facts are the contract `decide()` will receive; today none of them changes the answer.
  void facts;
  return { kind: "none" };
}
