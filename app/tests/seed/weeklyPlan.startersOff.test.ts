import { describe, expect, it, vi } from "vitest";
import { WEEKLY_FLOW } from "@/domain/weekly";
import { PRESET_ROWS, answeredPreset, evaluatePreset, label, readyOf } from "./weeklyHelpers";

// The KILL SWITCH of the goal-led starters. They ship ON (weeklyPlan.shipped.test.ts); with the constant false every cell of the
// table of 15.2 that offers a starter reads "NONE none_eligible", while a pattern-led offer and the other decisions do not change.
vi.mock("@/domain/weekly/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/weekly/types")>();
  return { ...actual, WEEKLY_FLOW: { ...actual.WEEKLY_FLOW, starterExperimentsEnabled: false } };
});

describe("the presets of 15.2 with the starter switch OFF", () => {
  it("the mock is in effect", () => {
    expect(WEEKLY_FLOW.starterExperimentsEnabled).toBe(false);
  });

  it.each(Object.keys(PRESET_ROWS))("%s", (scenario) => {
    const want = PRESET_ROWS[scenario];
    const { ev } = evaluatePreset(scenario);
    const { ready } = readyOf(ev);
    expect(label(ready.decision)).toBe(want.decisionOff);
    // Nothing else depends on the switch.
    expect([ready.story.mode, ready.story.lineKey, ready.story.weight.kind]).toEqual([want.mode, want.lineKey, want.weight]);
    expect(ev.home.state.key).toBe(want.home);
  });

  it("w3-result-due after 'really helped': the next small step is a starter, so with the switch off there is nothing new to suggest", () => {
    const { ready } = readyOf(answeredPreset("helpful"));
    expect(ready.story.mode).toBe("CELEBRATE");
    expect(label(ready.decision)).toBe("NONE none_eligible");
  });
});
