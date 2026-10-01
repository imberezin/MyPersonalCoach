import { describe, expect, it } from "vitest";
import { classifyPattern } from "./patternLifecycle";

const TZ = "Asia/Jerusalem";
const at = (iso: string) => new Date(iso);

describe("classifyPattern", () => {
  it("is nothing for a single event (an observation is not a pattern)", () => {
    expect(classifyPattern([at("2026-10-01T18:00:00Z")], TZ)).toBe("NONE");
  });

  it("is an early signal at two occurrences", () => {
    expect(classifyPattern([at("2026-10-01T18:00:00Z"), at("2026-10-02T18:00:00Z")], TZ)).toBe("EARLY_SIGNAL");
  });

  it("is a candidate at three occurrences on different days", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-04"].map((d) => at(`${d}T18:00:00Z`));
    expect(classifyPattern(days, TZ)).toBe("CANDIDATE");
  });

  it("stays an early signal when three occurrences fall on the same day", () => {
    const sameDay = ["10:00", "13:00", "18:00"].map((h) => at(`2026-10-01T${h}:00Z`));
    expect(classifyPattern(sameDay, TZ)).toBe("EARLY_SIGNAL");
  });

  it("is validated at five occurrences over at least two weeks", () => {
    const spread = ["2026-10-01", "2026-10-04", "2026-10-08", "2026-10-12", "2026-10-16"].map((d) => at(`${d}T18:00:00Z`));
    expect(classifyPattern(spread, TZ)).toBe("VALIDATED");
  });

  it("stays a candidate at five occurrences inside one week", () => {
    const short = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map((d) => at(`${d}T18:00:00Z`));
    expect(classifyPattern(short, TZ)).toBe("CANDIDATE");
  });

  it("is validated when the user confirms a candidate with at least three occurrences", () => {
    const three = ["2026-10-01", "2026-10-02", "2026-10-03"].map((d) => at(`${d}T18:00:00Z`));
    expect(classifyPattern(three, TZ, true)).toBe("VALIDATED");
  });

  it("never validates on confirmation alone", () => {
    const two = ["2026-10-01", "2026-10-02"].map((d) => at(`${d}T18:00:00Z`));
    expect(classifyPattern(two, TZ, true)).toBe("EARLY_SIGNAL");
    expect(classifyPattern([at("2026-10-01T18:00:00Z")], TZ, true)).toBe("NONE");
  });
});
