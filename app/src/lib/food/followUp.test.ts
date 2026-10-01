import { describe, expect, it } from "vitest";
import type { LifecycleState } from "@/domain/firstWeek";
import { decideSavedFollowUp } from "./followUp";

const LIFECYCLES: LifecycleState[] = ["NEW", "ONBOARDING", "FIRST_WEEK", "WEEKLY_CYCLE"];

describe("decideSavedFollowUp", () => {
  // The Behavior Engine does not exist yet, so this item asks nothing after a saved meal. The function
  // is the one seam where decide() will plug in; this test pins "none" so the day it changes, it changes on purpose.
  it("never asks anything yet, for any meal, first or not, in any lifecycle state", () => {
    for (const lifecycle of LIFECYCLES) {
      for (const isFirstMeal of [true, false]) {
        expect(decideSavedFollowUp({ mealId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", isFirstMeal, lifecycle })).toEqual({ kind: "none" });
      }
    }
  });

  it("does not depend on the meal id", () => {
    expect(decideSavedFollowUp({ mealId: "", isFirstMeal: true, lifecycle: "FIRST_WEEK" })).toEqual({ kind: "none" });
  });
});
