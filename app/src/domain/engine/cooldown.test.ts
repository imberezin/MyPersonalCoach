import { describe, expect, it } from "vitest";
import { INTERVENTION_RULES } from "../interventions/library";
import { isCoolingDown, type OutcomeFact } from "./cooldown";

const NOW = new Date("2027-02-01T10:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const fact = (kind: OutcomeFact["kind"], at: Date | null, key: string | null = "eat_intentionally"): OutcomeFact => ({ key, kind, at });
const cooling = (facts: OutcomeFact[], over: Partial<Parameters<typeof isCoolingDown>[0]> = {}) =>
  isCoolingDown({ facts, key: "eat_intentionally", now: NOW, ...over });

describe("isCoolingDown: SKIPPED", () => {
  it("cools for 13 days and is over at exactly 14 (the library's constant)", () => {
    expect(cooling([fact("SKIPPED", daysAgo(INTERVENTION_RULES.cooldownDays - 1))])).toBe(true);
    expect(cooling([fact("SKIPPED", daysAgo(INTERVENTION_RULES.cooldownDays))])).toBe(false);
    expect(cooling([fact("SKIPPED", daysAgo(INTERVENTION_RULES.cooldownDays + 5))])).toBe(false);
  });

  it("cools just under the edge and not at the edge, to the millisecond", () => {
    const edge = INTERVENTION_RULES.cooldownDays * DAY;
    expect(cooling([fact("SKIPPED", new Date(NOW.getTime() - edge + 1))])).toBe(true);
    expect(cooling([fact("SKIPPED", new Date(NOW.getTime() - edge))])).toBe(false);
  });

  it("only the NEWEST fact of the key decides: an older SKIPPED behind a newer answer does not cool", () => {
    expect(cooling([fact("OTHER", daysAgo(1)), fact("SKIPPED", daysAgo(3))])).toBe(false);
    expect(cooling([fact("SKIPPED", daysAgo(1)), fact("OTHER", daysAgo(30))])).toBe(true);
  });

  it("honours a custom number of days", () => {
    expect(cooling([fact("SKIPPED", daysAgo(5))], { days: 7 })).toBe(true);
    expect(cooling([fact("SKIPPED", daysAgo(7))], { days: 7 })).toBe(false);
  });
});

describe("isCoolingDown: consecutive NOT_REALLY", () => {
  it("cools after two in a row with the newest inside the window, and not after one", () => {
    expect(INTERVENTION_RULES.cooldownAfterConsecutiveNotReally).toBe(2);
    expect(cooling([fact("NOT_REALLY", daysAgo(2)), fact("NOT_REALLY", daysAgo(9))])).toBe(true);
    expect(cooling([fact("NOT_REALLY", daysAgo(2))])).toBe(false);
  });

  it("is over when the newest of the run is 14 days old", () => {
    expect(cooling([fact("NOT_REALLY", daysAgo(14)), fact("NOT_REALLY", daysAgo(20))])).toBe(false);
    expect(cooling([fact("NOT_REALLY", daysAgo(13)), fact("NOT_REALLY", daysAgo(20))])).toBe(true);
  });

  it("a different answer between two NOT_REALLY breaks the run", () => {
    expect(cooling([fact("NOT_REALLY", daysAgo(1)), fact("OTHER", daysAgo(5)), fact("NOT_REALLY", daysAgo(9))])).toBe(false);
  });

  it("a NOT_REALLY behind a newer OTHER does not make a run", () => {
    expect(cooling([fact("OTHER", daysAgo(1)), fact("NOT_REALLY", daysAgo(2)), fact("NOT_REALLY", daysAgo(3))])).toBe(false);
  });

  it("a SKIPPED in the run is not a NOT_REALLY", () => {
    expect(cooling([fact("NOT_REALLY", daysAgo(1)), fact("SKIPPED", daysAgo(20))])).toBe(false);
  });

  it("another key's facts are not part of the run", () => {
    expect(cooling([fact("NOT_REALLY", daysAgo(1)), fact("NOT_REALLY", daysAgo(2), "slow_down"), fact("NOT_REALLY", daysAgo(3))])).toBe(true);
    expect(cooling([fact("NOT_REALLY", daysAgo(1)), fact("OTHER", daysAgo(2), "slow_down"), fact("OTHER", daysAgo(3))])).toBe(false);
  });

  it("honours a custom run length", () => {
    expect(cooling([fact("NOT_REALLY", daysAgo(1)), fact("NOT_REALLY", daysAgo(2))], { consecutiveNotReally: 3 })).toBe(false);
    expect(cooling([fact("NOT_REALLY", daysAgo(1)), fact("NOT_REALLY", daysAgo(2)), fact("NOT_REALLY", daysAgo(3))], { consecutiveNotReally: 3 })).toBe(true);
    expect(cooling([fact("NOT_REALLY", daysAgo(1))], { consecutiveNotReally: 1 })).toBe(true);
  });
});

describe("isCoolingDown: nothing to cool", () => {
  it("is false for empty facts", () => {
    expect(cooling([])).toBe(false);
  });

  it("another key never cools", () => {
    expect(cooling([fact("SKIPPED", daysAgo(1), "slow_down")])).toBe(false);
    expect(cooling([fact("SKIPPED", daysAgo(1), null)])).toBe(false);
  });

  it("a fact with a null or invalid `at` never cools", () => {
    expect(cooling([fact("SKIPPED", null)])).toBe(false);
    expect(cooling([fact("SKIPPED", new Date(Number.NaN))])).toBe(false);
    expect(cooling([fact("NOT_REALLY", null), fact("NOT_REALLY", daysAgo(2))])).toBe(false);
  });

  it("an invalid `now` never cools and never throws", () => {
    expect(cooling([fact("SKIPPED", daysAgo(1))], { now: new Date(Number.NaN) })).toBe(false);
  });

  it("does not mutate its facts", () => {
    const facts = [fact("NOT_REALLY", daysAgo(1)), fact("NOT_REALLY", daysAgo(2))];
    const copy = JSON.stringify(facts);
    cooling(facts);
    expect(JSON.stringify(facts)).toBe(copy);
  });
});
