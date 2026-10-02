import { describe, expect, it } from "vitest";
import { AI_WORDING } from "./constants";
import { tokenizeSurface } from "./validate";

describe("AI_WORDING timing (measured live, 2026-10-02)", () => {
  it("one attempt of 12 seconds inside a 13 second budget, and no retry (the gateway retries only an invalid answer)", () => {
    expect(AI_WORDING.attemptTimeoutMs).toBe(12_000);
    expect(AI_WORDING.totalBudgetMs).toBe(13_000);
    expect(AI_WORDING.retries).toBe(0);
  });

  it("the budget holds one whole attempt and stays under the route's 40 second limit", () => {
    expect(AI_WORDING.totalBudgetMs).toBeGreaterThanOrEqual(AI_WORDING.attemptTimeoutMs);
    expect(AI_WORDING.totalBudgetMs).toBeLessThan(40_000);
  });
});

describe("tokenizeSurface", () => {
  it("returns the words as written: letter case kept, Hebrew points and the geresh normalised", () => {
    expect(tokenizeSurface("Sit down, בְּלִי מסך ג׳ינס")).toEqual(["Sit", "down", "בלי", "מסך", "ג'ינס"]);
    expect(tokenizeSurface("")).toEqual([]);
  });
});
