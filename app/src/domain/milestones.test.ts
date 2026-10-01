import { describe, expect, it } from "vitest";
import { computeMilestones } from "./milestones";

describe("computeMilestones", () => {
  it("reproduces the example in the screen specification (120 to 99)", () => {
    expect(computeMilestones(120, 99)).toEqual([120, 115, 110, 105, 99]);
  });

  it("skips a step that would crowd the goal", () => {
    expect(computeMilestones(106, 100)).toEqual([106, 100]);
    expect(computeMilestones(130, 99)).toEqual([130, 125, 120, 115, 110, 105, 99]);
  });

  it("keeps a step that is at least half a step away from the goal", () => {
    expect(computeMilestones(120, 97)).toEqual([120, 115, 110, 105, 100, 97]);
  });

  it("goes straight to the goal when it is within one step", () => {
    expect(computeMilestones(103, 100)).toEqual([103, 100]);
  });

  it("has no weight milestones without a numeric goal, or with a goal that is not lower", () => {
    expect(computeMilestones(120, null)).toEqual([]);
    expect(computeMilestones(120, undefined)).toEqual([]);
    expect(computeMilestones(120, 120)).toEqual([]);
    expect(computeMilestones(100, 110)).toEqual([]);
  });

  it("handles decimal starting weights", () => {
    expect(computeMilestones(118.7, 99)).toEqual([118.7, 113.7, 108.7, 103.7, 99]);
  });
});
