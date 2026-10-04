import { describe, expect, it, vi } from "vitest";

// Runs the story with the pattern question and the weight line switched OFF. WEEKLY_FLOW is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, patternQuestionEnabled: false, weightLineEnabled: false } };
});

import { buildWeeklyStory } from "./story";

describe("buildWeeklyStory with the pattern question and the weight line switched off", () => {
  const start = new Date("2027-01-02T22:00:00Z");
  const end = new Date("2027-01-09T22:00:00Z");
  const story = buildWeeklyStory({
    now: new Date("2027-01-10T03:00:00Z"),
    timeZone: "Asia/Jerusalem",
    window: { start, end },
    week: { start, end },
    answerWindow: { start: end, end: new Date("2027-01-16T22:00:00Z") },
    periods: [],
    periodsComplete: true,
    meals: [],
    lastMealBefore: null,
    weight: { known: true, line: { kind: "DOWN" }, milestone: null, weighedThisWeek: true, lastEntryAt: null, hasBaselineOrEntry: true },
    signals: [{ kind: "late_evening_meals", patternId: "p1", view: "CANDIDATE", feedback: null, feedbackAt: null }],
    experiments: [],
  });

  it("never asks the pattern question", () => {
    expect(story.patternQuestion).toEqual({ kind: "NONE" });
    // The pattern is still something learned.
    expect(story.learned).toEqual([{ kind: "LATE_EVENING", level: "ESTABLISHED" }]);
  });

  it("never invites a weigh-in", () => {
    expect(story.invite.weighIn).toBe(false);
  });
});
