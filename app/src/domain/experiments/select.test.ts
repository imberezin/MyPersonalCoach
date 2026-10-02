import { describe, expect, it } from "vitest";
import { INTERVENTIONS } from "../interventions/library";
import type { PatternView } from "../patterns/types";
import { selectFirstExperiment } from "./select";
import { EXPERIMENT_RULES, type ExperimentFact, type ExperimentSelection, type ExperimentStatus, type PatternFact } from "./types";

const NOW = new Date("2027-02-01T10:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const pattern = (view: PatternView, overrides: Partial<PatternFact> = {}): PatternFact => ({
  patternId: "p1",
  kind: "late_evening_meals",
  view,
  feedback: null,
  feedbackAt: null,
  ...overrides,
});

const experiment = (status: ExperimentStatus, overrides: Partial<ExperimentFact> = {}): ExperimentFact => ({
  id: `e-${status.toLowerCase()}`,
  status,
  sourcePatternId: "p1",
  endedAt: null,
  ...overrides,
});

const select = (patterns: PatternFact[], experiments: ExperimentFact[] = [], now: Date = NOW): ExperimentSelection =>
  selectFirstExperiment({ patterns, experiments, now });

const none = (reason: Extract<ExperimentSelection, { kind: "NONE" }>["reason"]): ExperimentSelection => ({ kind: "NONE", reason });

describe("selectFirstExperiment: why there is no offer", () => {
  it("says no_pattern with no patterns at all", () => {
    expect(select([])).toEqual(none("no_pattern"));
  });

  it("says no_pattern when every pattern is at the NONE level", () => {
    expect(select([pattern("NONE")])).toEqual(none("no_pattern"));
  });

  it("says pattern_not_established for an Early Signal (an experiment needs a Candidate)", () => {
    expect(select([pattern("EARLY_SIGNAL")])).toEqual(none("pattern_not_established"));
  });

  it("says pattern_rejected for a rejected pattern", () => {
    expect(select([pattern("REJECTED", { feedback: "reject", feedbackAt: daysAgo(3) })])).toEqual(none("pattern_rejected"));
  });

  it("says pattern_unsure_cooldown for 'not sure' inside the 14 days, and offers at the edge", () => {
    const cooldown = EXPERIMENT_RULES.skippedCooldownDays * DAY;
    const unsure = (answeredAt: Date) => pattern("CANDIDATE", { feedback: "unsure", feedbackAt: answeredAt });
    expect(select([unsure(new Date(NOW.getTime() - cooldown + 1))])).toEqual(none("pattern_unsure_cooldown"));
    expect(select([unsure(new Date(NOW.getTime() - cooldown))]).kind).toBe("OFFER");
    expect(select([unsure(daysAgo(30))]).kind).toBe("OFFER");
  });

  it("keeps 'not sure' with no time as a pause (the cooldown cannot be shown to have passed)", () => {
    expect(select([pattern("CANDIDATE", { feedback: "unsure", feedbackAt: null })])).toEqual(none("pattern_unsure_cooldown"));
  });

  it("says skipped_recently for a SKIPPED experiment of that pattern that ended 13 days ago, and offers at 14", () => {
    expect(select([pattern("CANDIDATE")], [experiment("SKIPPED", { endedAt: daysAgo(13) })])).toEqual(none("skipped_recently"));
    expect(select([pattern("CANDIDATE")], [experiment("SKIPPED", { endedAt: daysAgo(14) })]).kind).toBe("OFFER");
    expect(select([pattern("CANDIDATE")], [experiment("SKIPPED", { endedAt: daysAgo(40) })]).kind).toBe("OFFER");
  });

  it("is not blocked by a SKIPPED experiment of ANOTHER pattern id", () => {
    expect(select([pattern("CANDIDATE")], [experiment("SKIPPED", { sourcePatternId: "other", endedAt: daysAgo(1) })]).kind).toBe("OFFER");
    expect(select([pattern("CANDIDATE")], [experiment("SKIPPED", { sourcePatternId: null, endedAt: daysAgo(1) })]).kind).toBe("OFFER");
  });

  it("is not blocked by a DONE experiment", () => {
    expect(select([pattern("CANDIDATE")], [experiment("DONE", { endedAt: daysAgo(1) })]).kind).toBe("OFFER");
  });

  it("gives the pause when a SKIPPED row has no end time (it cannot be shown to be old)", () => {
    expect(select([pattern("CANDIDATE")], [experiment("SKIPPED", { endedAt: null })])).toEqual(none("skipped_recently"));
  });

  it("does not match a SKIPPED experiment against a pattern that has no row yet", () => {
    expect(select([pattern("CANDIDATE", { patternId: null })], [experiment("SKIPPED", { sourcePatternId: null, endedAt: daysAgo(1) })]).kind).toBe(
      "OFFER",
    );
  });

  it("gives the most informative reason across several patterns", () => {
    const early = pattern("EARLY_SIGNAL", { patternId: "a" });
    const skipped = pattern("CANDIDATE", { patternId: "b" });
    const experiments = [experiment("SKIPPED", { sourcePatternId: "b", endedAt: daysAgo(2) })];
    expect(select([early, skipped], experiments)).toEqual(none("skipped_recently"));
    expect(select([skipped, early], experiments)).toEqual(none("skipped_recently"));
    expect(select([pattern("NONE", { patternId: "a" }), pattern("REJECTED", { patternId: "b" })])).toEqual(none("pattern_rejected"));
  });
});

describe("selectFirstExperiment: the offer", () => {
  it.each(["CANDIDATE", "VALIDATED"] as const)("offers the mapped library experiment for a %s pattern", (view) => {
    const result = select([pattern(view)]);
    expect(result).toEqual({
      kind: "OFFER",
      patternKind: "late_evening_meals",
      key: "eat_intentionally",
      variantId: "default",
      scope: "next_meal",
      params: {},
      constraints: [],
    });
  });

  it("copies the library's params and constraints (no shared references)", () => {
    const result = select([pattern("CANDIDATE")]);
    if (result.kind !== "OFFER") throw new Error("expected an offer");
    expect(result.params).toEqual(INTERVENTIONS.eat_intentionally.params);
    expect(result.params).not.toBe(INTERVENTIONS.eat_intentionally.params);
    expect(result.constraints).toEqual(INTERVENTIONS.eat_intentionally.constraints);
    expect(result.constraints).not.toBe(INTERVENTIONS.eat_intentionally.constraints);
  });

  it("offers for a pattern that has no row yet (patternId null)", () => {
    expect(select([pattern("CANDIDATE", { patternId: null })]).kind).toBe("OFFER");
  });

  it("offers for the first pattern that qualifies, in the given order", () => {
    expect(select([pattern("EARLY_SIGNAL", { patternId: "a" }), pattern("CANDIDATE", { patternId: "b" })]).kind).toBe("OFFER");
  });

  it("is not blocked by a 'Sounds right' answer", () => {
    expect(select([pattern("VALIDATED", { feedback: "confirm", feedbackAt: daysAgo(2) })]).kind).toBe("OFFER");
  });

  it("is deterministic, and does not mutate its input", () => {
    const patterns = [pattern("CANDIDATE")];
    const experiments = [experiment("SKIPPED", { endedAt: daysAgo(30) })];
    const snapshot = JSON.stringify({ patterns, experiments });
    expect(select(patterns, experiments)).toEqual(select(patterns, experiments));
    expect(JSON.stringify({ patterns, experiments })).toBe(snapshot);
  });

  it("answers no_pattern, and never throws, for an invalid now", () => {
    expect(select([pattern("CANDIDATE")], [], new Date("nope"))).toEqual(none("no_pattern"));
  });
});

describe("selectFirstExperiment: an ACTIVE experiment", () => {
  it("is ACTIVE whatever the meals say", () => {
    const active = experiment("ACTIVE");
    for (const view of ["NONE", "EARLY_SIGNAL", "CANDIDATE", "VALIDATED", "REJECTED"] as const) {
      expect(select([pattern(view)], [active])).toEqual({ kind: "ACTIVE", experimentId: "e-active" });
    }
    expect(select([], [active])).toEqual({ kind: "ACTIVE", experimentId: "e-active" });
  });

  it("wins over an OFFERED row", () => {
    expect(select([pattern("CANDIDATE")], [experiment("OFFERED"), experiment("ACTIVE")])).toEqual({
      kind: "ACTIVE",
      experimentId: "e-active",
    });
  });
});

describe("selectFirstExperiment: an OFFERED row is resolved against the live pattern", () => {
  const offered = experiment("OFFERED");

  it.each(["CANDIDATE", "VALIDATED"] as const)("is PENDING while its pattern is %s", (view) => {
    expect(select([pattern(view)], [offered])).toEqual({ kind: "PENDING", experimentId: "e-offered" });
  });

  it.each(["EARLY_SIGNAL", "NONE"] as const)("is NONE pattern_not_established when its pattern fell back to %s (evidence deleted)", (view) => {
    expect(select([pattern(view)], [offered])).toEqual(none("pattern_not_established"));
  });

  it("is NONE pattern_rejected when its pattern is REJECTED", () => {
    expect(select([pattern("REJECTED")], [offered])).toEqual(none("pattern_rejected"));
  });

  it("is NONE pattern_not_established with no matching pattern (the row is gone, or source_pattern_id is null)", () => {
    expect(select([], [offered])).toEqual(none("pattern_not_established"));
    expect(select([pattern("CANDIDATE")], [experiment("OFFERED", { sourcePatternId: null })])).toEqual(none("pattern_not_established"));
  });

  it("treats an OFFERED row of ANOTHER pattern id as the no-match case", () => {
    expect(select([pattern("CANDIDATE", { patternId: "p1" })], [experiment("OFFERED", { sourcePatternId: "p2" })])).toEqual(
      none("pattern_not_established"),
    );
  });

  it("never falls through to a new OFFER for another pattern in those NONE cases", () => {
    const stale = pattern("EARLY_SIGNAL", { patternId: "p1" });
    const established = pattern("CANDIDATE", { patternId: "p2" });
    expect(select([stale, established], [offered])).toEqual(none("pattern_not_established"));
    expect(select([pattern("REJECTED", { patternId: "p1" }), established], [offered])).toEqual(none("pattern_rejected"));
  });

  it("is PENDING even inside a 'not sure' pause or after a recent skip (an open row is an open row)", () => {
    const paused = pattern("CANDIDATE", { feedback: "unsure", feedbackAt: daysAgo(1) });
    expect(select([paused], [offered])).toEqual({ kind: "PENDING", experimentId: "e-offered" });
  });
});

describe("selectFirstExperiment: the closed answers", () => {
  it("is one of the four kinds with the documented shapes", () => {
    const kinds = new Set([
      select([]).kind,
      select([pattern("CANDIDATE")]).kind,
      select([pattern("CANDIDATE")], [experiment("OFFERED")]).kind,
      select([pattern("CANDIDATE")], [experiment("ACTIVE")]).kind,
    ]);
    expect(kinds).toEqual(new Set(["NONE", "OFFER", "PENDING", "ACTIVE"]));
  });
});
