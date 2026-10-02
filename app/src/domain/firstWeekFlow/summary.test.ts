import { describe, expect, it } from "vitest";
import type { ExperimentSelection } from "../experiments/types";
import type { OfflinePeriod } from "../offline";
import type { PatternKind, PatternView } from "../patterns/types";
import { buildFirstWeekSummary } from "./summary";
import type { FirstWeekSummary } from "./types";

const TZ = "Asia/Jerusalem";
const NO_EXPERIMENT: ExperimentSelection = { kind: "NONE", reason: "no_pattern" };

type Input = Parameters<typeof buildFirstWeekSummary>[0];

const input = (overrides: Partial<Input> = {}): Input => ({
  timeZone: TZ,
  mealTimes: [],
  periods: [],
  signals: [],
  experiment: NO_EXPERIMENT,
  goal: { focus: [], motivation: null, numericGoal: false },
  ...overrides,
});

/** `n` meals on consecutive days starting Sunday 2027-01-10 at 10:00 local. */
const meals = (n: number): Date[] => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2027, 0, 10 + i, 8, 0, 0)));

const signal = (view: PatternView, kind: PatternKind = "late_evening_meals") => ({ kind, view });

describe("buildFirstWeekSummary: tone and what you did", () => {
  it.each([
    [0, "NO_MEALS"],
    [1, "LITTLE"],
    [9, "LITTLE"],
    [10, "ENOUGH"],
    [12, "ENOUGH"],
  ] as const)("%i meals -> %s", (count, tone) => {
    expect(buildFirstWeekSummary(input({ mealTimes: meals(count) })).tone).toBe(tone);
  });

  it("says NO_MEALS with no meals and MEALS otherwise, with no count anywhere", () => {
    expect(buildFirstWeekSummary(input()).did).toEqual([{ kind: "NO_MEALS" }]);
    for (const n of [1, 3, 10, 12]) {
      expect(buildFirstWeekSummary(input({ mealTimes: meals(n) })).did).toEqual([{ kind: "MEALS" }]);
    }
  });

  it("adds the EXPERIMENT line only for an ACTIVE experiment, never for an offer or a waiting idea", () => {
    const withExperiment = (experiment: ExperimentSelection) => buildFirstWeekSummary(input({ mealTimes: meals(3), experiment })).did;
    expect(withExperiment({ kind: "ACTIVE", experimentId: "e1" })).toEqual([{ kind: "MEALS" }, { kind: "EXPERIMENT" }]);
    expect(withExperiment({ kind: "PENDING", experimentId: "e1" })).toEqual([{ kind: "MEALS" }]);
    expect(withExperiment(NO_EXPERIMENT)).toEqual([{ kind: "MEALS" }]);
    expect(
      withExperiment({
        kind: "OFFER",
        patternKind: "late_evening_meals",
        key: "eat_intentionally",
        variantId: "default",
        scope: "next_meal",
        params: {},
        constraints: [],
      }),
    ).toEqual([{ kind: "MEALS" }]);
  });

  it("is never empty in `did`, even for an active experiment with no meals", () => {
    expect(buildFirstWeekSummary(input({ experiment: { kind: "ACTIVE", experimentId: "e1" } })).did).toEqual([
      { kind: "NO_MEALS" },
      { kind: "EXPERIMENT" },
    ]);
  });
});

describe("buildFirstWeekSummary: the meaningful moment", () => {
  const monday = new Date("2027-01-11T08:00:00Z");
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  const shabbat: OfflinePeriod = {
    type: "SHABBAT",
    start: new Date("2027-01-08T14:10:00Z"), // Friday 16:10 local
    end: new Date("2027-01-09T15:25:00Z"), // Saturday 17:25 local
  };
  const moment = (mealTimes: Date[], periods: OfflinePeriod[] = []) => buildFirstWeekSummary(input({ mealTimes, periods })).moment;

  it("is RETURNED after a gap of four whole days between two meals", () => {
    expect(moment([monday, addDays(monday, 5)])).toEqual({ kind: "RETURNED" }); // Tue, Wed, Thu, Fri have ended
  });

  it("is RETURNED at exactly the 3-day threshold and not at 2", () => {
    expect(moment([monday, addDays(monday, 4)])).toEqual({ kind: "RETURNED" }); // Tue, Wed, Thu
    expect(moment([monday, addDays(monday, 3)])).toEqual({ kind: "FIRST_REPORT" }); // Tue, Wed
  });

  it("is not RETURNED for a Thursday-to-Monday gap that has a Shabbat in it (two available days)", () => {
    const thursday = new Date("2027-01-07T08:00:00Z");
    const nextMonday = new Date("2027-01-11T08:00:00Z");
    expect(moment([thursday, nextMonday], [shabbat])).toEqual({ kind: "FIRST_REPORT" });
    // The same dates with no Shabbat are three available days: a calendar-days rule would have been RETURNED.
    expect(moment([thursday, nextMonday])).toEqual({ kind: "RETURNED" });
  });

  it("does not depend on the order of the meals", () => {
    const list = [addDays(monday, 5), monday, addDays(monday, 6)];
    expect(moment(list)).toEqual(moment([...list].reverse()));
    expect(moment(list)).toEqual({ kind: "RETURNED" });
  });

  it("is FIRST_REPORT when any meal exists and the section is absent with none", () => {
    expect(moment([monday])).toEqual({ kind: "FIRST_REPORT" });
    expect(moment([monday, addDays(monday, 1), addDays(monday, 2)])).toEqual({ kind: "FIRST_REPORT" });
    expect(moment([])).toEqual({ kind: "NONE" });
  });

  it("looks only at neighbours: one gap anywhere is enough", () => {
    expect(moment([monday, addDays(monday, 1), addDays(monday, 7), addDays(monday, 8)])).toEqual({ kind: "RETURNED" });
  });
});

describe("buildFirstWeekSummary: what we noticed (Phase 2)", () => {
  const noticed = (signals: Input["signals"]) => buildFirstWeekSummary(input({ signals })).noticed;

  it("is NOT_ENOUGH_YET with no signals", () => {
    expect(noticed([])).toEqual({ kind: "NOT_ENOUGH_YET" });
  });

  it.each(["EARLY_SIGNAL", "CANDIDATE", "VALIDATED"] as const)("lists one late-evening line at the level %s", (view) => {
    expect(noticed([signal(view)])).toEqual({ kind: "OBSERVATIONS", items: [{ kind: "LATE_EVENING_MEALS" }] });
  });

  it.each(["NONE", "REJECTED"] as const)("says nothing at the level %s", (view) => {
    expect(noticed([signal(view)])).toEqual({ kind: "NOT_ENOUGH_YET" });
  });

  it("lists a kind once, however many times it appears", () => {
    expect(noticed([signal("CANDIDATE"), signal("EARLY_SIGNAL")])).toEqual({
      kind: "OBSERVATIONS",
      items: [{ kind: "LATE_EVENING_MEALS" }],
    });
  });
});

describe("buildFirstWeekSummary: next (the experiment)", () => {
  const next = (experiment: ExperimentSelection) => buildFirstWeekSummary(input({ experiment })).next;

  it("maps the selection onto the four lines", () => {
    expect(next(NO_EXPERIMENT)).toEqual({ kind: "NO_EXPERIMENT" });
    for (const reason of ["switch_off", "pattern_rejected", "skipped_recently", "no_mapping"] as const) {
      expect(next({ kind: "NONE", reason })).toEqual({ kind: "NO_EXPERIMENT" });
    }
    expect(
      next({
        kind: "OFFER",
        patternKind: "late_evening_meals",
        key: "eat_intentionally",
        variantId: "default",
        scope: "next_meal",
        params: {},
        constraints: [],
      }),
    ).toEqual({ kind: "OFFER" });
    expect(next({ kind: "PENDING", experimentId: "e1" })).toEqual({ kind: "PENDING" });
    expect(next({ kind: "ACTIVE", experimentId: "e1" })).toEqual({ kind: "ACTIVE" });
  });

  it("carries nothing of the experiment (its text is the view's, from the stored row)", () => {
    expect(Object.keys(next({ kind: "ACTIVE", experimentId: "e1" }))).toEqual(["kind"]);
  });
});

describe("buildFirstWeekSummary: why we started (the table of cases is why.test.ts)", () => {
  const why = (goal: Partial<Input["goal"]>, extra: Partial<Input> = {}) =>
    buildFirstWeekSummary(input({ goal: { focus: [], motivation: null, numericGoal: false, ...goal }, ...extra })).why;

  it("is NONE without any answer and SOME with one", () => {
    expect(why({})).toEqual({ kind: "NONE" });
    expect(why({ focus: ["be_active"] })).toEqual({ kind: "SOME", focus: ["be_active"], notSure: false, motivation: null });
    expect(why({ focus: ["not_sure"] })).toEqual({ kind: "SOME", focus: [], notSure: true, motivation: null });
    expect(why({ motivation: "my words" })).toEqual({ kind: "SOME", focus: [], notSure: false, motivation: "my words" });
  });

  it("is independent of the tone and of everything else: the same for no meals and for enough meals", () => {
    const goal = { focus: ["feel_lighter"], motivation: "my words" };
    expect(why(goal, { mealTimes: [] })).toEqual(why(goal, { mealTimes: meals(12) }));
    expect(why(goal, { signals: [signal("VALIDATED")], experiment: { kind: "ACTIVE", experimentId: "e1" } })).toEqual(why(goal));
    expect(why(goal)).toEqual({ kind: "SOME", focus: ["feel_lighter"], notSure: false, motivation: "my words" });
  });

  it("does not let the weight target in: the input has no field for it, and a stray one is ignored", () => {
    const given = { focus: ["lose_weight"], motivation: null, numericGoal: true, goalWeightKg: 61.5 };
    const result = buildFirstWeekSummary(input({ goal: given as Input["goal"] })).why;
    expect(JSON.stringify(result)).not.toContain("61");
    expect(Object.keys(result).sort()).toEqual(["focus", "kind", "motivation", "notSure"]);
  });
});

describe("buildFirstWeekSummary: no numbers, no mutation", () => {
  const everything = (): Input =>
    input({
      mealTimes: meals(12),
      signals: [signal("VALIDATED")],
      experiment: { kind: "ACTIVE", experimentId: "e1" },
      goal: { focus: ["lose_weight", "improve_eating"], motivation: "42 reasons, 3 of them real", numericGoal: true },
    });

  const withoutMotivation = (summary: FirstWeekSummary): unknown => {
    const copy = structuredClone(summary);
    if (copy.why.kind === "SOME") copy.why.motivation = null;
    return copy;
  };

  const numbersIn = (value: unknown): number[] => {
    if (typeof value === "number") return [value];
    if (Array.isArray(value)) return value.flatMap(numbersIn);
    if (value && typeof value === "object") return Object.values(value).flatMap(numbersIn);
    return [];
  };

  it.each([
    ["no meals", input()],
    ["a few meals", input({ mealTimes: meals(4), signals: [signal("EARLY_SIGNAL")] })],
    ["everything", everything()],
  ])("holds no number and no digit for %s (the motivation is the person's own text and is excluded)", (_name, given) => {
    const summary = withoutMotivation(buildFirstWeekSummary(given));
    expect(numbersIn(summary)).toEqual([]);
    expect(JSON.stringify(summary)).not.toMatch(/\d/);
  });

  it("does not mutate its input", () => {
    const given = everything();
    const snapshot = structuredClone(given);
    buildFirstWeekSummary(given);
    expect(given).toEqual(snapshot);
  });

  it("is deterministic and reads no clock", () => {
    expect(buildFirstWeekSummary(everything())).toEqual(buildFirstWeekSummary(everything()));
  });

  it("falls back to Jerusalem for a garbage zone", () => {
    const given = { mealTimes: [new Date("2027-01-07T08:00:00Z"), new Date("2027-01-11T08:00:00Z")] };
    expect(buildFirstWeekSummary(input({ ...given, timeZone: "Not/AZone" }))).toEqual(buildFirstWeekSummary(input(given)));
  });

  it("ignores an invalid meal time", () => {
    const summary = buildFirstWeekSummary(input({ mealTimes: [new Date("nope")] }));
    expect(summary.tone).toBe("NO_MEALS");
    expect(summary.moment).toEqual({ kind: "NONE" });
  });
});
