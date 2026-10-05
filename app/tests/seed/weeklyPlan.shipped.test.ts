import { describe, expect, it } from "vitest";
import { WEEKLY_FLOW } from "@/domain/weekly";
import { PRESET_ROWS, answeredPreset, evaluatePreset, label, readyOf } from "./weeklyHelpers";

// The SHIPPED switches, no mock: the goal-led starter experiments are ON (the owner approved both sentences on 2026-10-05). Every cell
// of the table of 15.2 reads its "starters on" decision here. The full table, with its other columns, runs in weeklyPlan.test.ts
// (which mocks the same switch) and the OFF behavior in weeklyPlan.startersOff.test.ts.
describe("the presets of 15.2 with the shipped starter switch (ON)", () => {
  it("the shipped value is true", () => {
    expect(WEEKLY_FLOW.starterExperimentsEnabled).toBe(true);
  });

  it.each(Object.keys(PRESET_ROWS))("%s", (scenario) => {
    const want = PRESET_ROWS[scenario];
    const { ev } = evaluatePreset(scenario);
    const { ready } = readyOf(ev);
    expect(label(ready.decision)).toBe(want.decisionOn);
    expect([ready.story.mode, ready.story.lineKey, ready.story.weight.kind]).toEqual([want.mode, want.lineKey, want.weight]);
    expect(ev.home.state.key).toBe(want.home);
  });

  it("w3-result-due after 'really helped': the next small step is the second starter", () => {
    const { ready } = readyOf(answeredPreset("helpful"));
    expect(ready.story.mode).toBe("CELEBRATE");
    expect(label(ready.decision)).toBe("OFFER starter slow_down NEXT_STEP");
  });
});
