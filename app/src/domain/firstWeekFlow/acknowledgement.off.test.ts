import { describe, expect, it, vi } from "vitest";

// Runs the line with FIRST_WEEK_FLOW.acknowledgementEnabled OFF. The switch is a `const`, so the module is mocked.
vi.mock("./types", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types")>();
  return { ...original, FIRST_WEEK_FLOW: { ...original.FIRST_WEEK_FLOW, acknowledgementEnabled: false } };
});

import { acknowledgementFor } from "./acknowledgement";

describe("acknowledgementFor with the switch off", () => {
  it("says nothing, not even for the very first meal", () => {
    const thisMealAt = new Date("2026-10-01T09:00:00Z");
    expect(
      acknowledgementFor({ lifecycle: "FIRST_WEEK", thisMealAt, mealTimes: [thisMealAt], timeZone: "Asia/Jerusalem" }),
    ).toEqual({ kind: "none" });
  });
});
