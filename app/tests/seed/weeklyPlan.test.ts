import { describe, expect, it, vi } from "vitest";
import { eveningOfDay } from "@/domain/asOf";
import { INTERVENTION_KEYS } from "@/domain/interventions/library";
import { localDayOf } from "@/domain/time";
import { RESULT_TO_DB, WEEKLY_FLOW, type ExperimentResult } from "@/domain/weekly";
import { SEED_SCENARIOS } from "../../scripts/seed-demo/args";
import { firstWeekEndedAtOf, toProfileUpdate } from "../../scripts/seed-demo/plan";
import { experimentWording, firstVariantOf, plannedExperimentId, toExperimentRow, toPatternAnswerPatch, toSyncOccurrences } from "../../scripts/seed-demo/weekly";
import { evaluateWeekly, experimentRecordsAt, planWeeklyOpened, toWeeklySummaryRow } from "../../scripts/seed-demo/weeklyEval";
import { PRESET_ROWS, answeredPreset, evaluatePreset, label, optionsOf, planOf, planOfFresh, readyOf } from "./weeklyHelpers";

// The rows of 15.2 that offer a starter describe the SWITCHED-ON behavior, which is also the shipped value (weeklyPlan.shipped.test.ts);
// the switched-off behavior is pinned in weeklyPlan.startersOff.test.ts.
vi.mock("@/domain/weekly/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/weekly/types")>();
  // The table of 15.2 was written with the AI opening line on (its "gate" column), which now ships off: it is switched on here too.
  return { ...actual, WEEKLY_FLOW: { ...actual.WEEKLY_FLOW, starterExperimentsEnabled: true, aiLineEnabled: true } };
});

const TZ = "Asia/Jerusalem";
const WEEKLY_SCENARIOS = SEED_SCENARIOS.filter((s) => /^w[234]-/.test(s));

describe("the presets of 15.2 through the real domain functions, at their clock (starter experiments ON)", () => {
  it("the mock is in effect, and every weekly preset is covered", () => {
    expect(WEEKLY_FLOW.starterExperimentsEnabled).toBe(true);
    expect(WEEKLY_SCENARIOS).toHaveLength(12);
    expect([...Object.keys(PRESET_ROWS), "w2-too-short"].sort()).toEqual([...WEEKLY_SCENARIOS].sort());
  });

  it.each(Object.keys(PRESET_ROWS))("%s", (scenario) => {
    const want = PRESET_ROWS[scenario];
    const { plan, ev } = evaluatePreset(scenario);
    const { moment, ready } = readyOf(ev);

    expect(plan.asOf.toISOString(), "the clock").toBe(want.asOf);
    expect(moment.week.weekStart, "the summarised week").toBe(want.week);
    expect(localDayOf(moment.window.start, TZ).key, "the window starts after the transition day").toBe(want.windowStart);
    expect(moment.availableDays, "available days").toBe(want.availableDays);
    expect(ready.mealDays, "meal days").toBe(want.mealDays);
    expect([ready.story.mode, ready.story.lineKey], "mode and opening line").toEqual([want.mode, want.lineKey]);
    expect(ready.story.weight.kind, "weight line").toBe(want.weight);
    expect(ready.story.patternQuestion.kind, "pattern question").toBe(want.patternQuestion);
    expect(ready.story.invite.weighIn, "weigh-in invitation").toBe(want.invite);
    expect(label(ready.decision), "experiment decision").toBe(want.decisionOn);
    expect(ev.home.state.key, "Home").toBe(want.home);
    expect(ready.lineGate.open ? "OPEN" : ready.lineGate.reason, "opening-line gate").toBe(want.gate);
    // The card is on screen exactly when Home says so, and the quiet link is never beside it.
    expect(ev.home.weeklyLink).toBe(false);
    expect(moment.cardVisible).toBe(true);
  });

  it("every story is a story without a number, and a CELEBRATE sentence is never sent to a provider", () => {
    for (const scenario of Object.keys(PRESET_ROWS)) {
      const { ev } = evaluatePreset(scenario);
      const { ready } = readyOf(ev);
      expect(JSON.stringify(ready.story), scenario).not.toMatch(/\d/);
      if (ready.story.mode !== "LEARN") expect(ready.lineGate, scenario).toEqual({ open: false, reason: "mode_fixed_text" });
    }
  });

  it("the weekly weigh-ins sit on Fridays and a weekly week is Sunday to Saturday", () => {
    const { plan, ev } = evaluatePreset("w4-down");
    expect(plan.weights.map((w) => localDayOf(w.measuredAt, TZ).key)).toEqual(["2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09"]);
    const { moment } = readyOf(ev);
    expect(moment.week.days[0].key).toBe("2026-10-04");
    expect(moment.week.days[6].key).toBe("2026-10-10");
  });
});

describe("w2-celebrate: the landmark and the Weight item's card", () => {
  it("is confirmed by the PAIR of weeks 09-20 and 09-27, the second being the summarised week, and the Weight card waits below the weekly card", () => {
    const { ev } = evaluatePreset("w2-celebrate");
    expect(ev.milestone).toMatchObject({ week: "2026-09-27", isGoal: false });
    expect(ev.home.state.key).toBe("WEEKLY_SUMMARY_READY");
    // Once the weekly card is opened it no longer takes the place: the Weight item's own moment shows, with no quiet link beside it.
    const opened = evaluatePreset("w2-celebrate", {}, new Set(["2026-09-27"])).ev;
    expect(opened.homeFact).toEqual({ weekStart: "2026-09-27", card: false });
    expect(opened.home.state.key).toBe("MILESTONE_REACHED");
    expect(opened.home.weeklyLink).toBe(false);
  });

  it("w4-goal: the goal and a step are confirmed in the same week, and the highest one (the goal) names the line", () => {
    const { ev } = evaluatePreset("w4-goal");
    expect(ev.milestone).toMatchObject({ week: "2026-10-04", isGoal: true });
    expect(readyOf(ev).ready.story.lineKey).toBe("celebrateGoal");
  });
});

describe("w2-too-short: the transition day and a window under four available days", () => {
  it("at day 14 there is no weekly moment, no card and no link", () => {
    const { ev } = evaluatePreset("w2-too-short");
    expect(ev.moment).toEqual({ kind: "NONE", reason: "window_too_short" });
    expect(ev.ready).toBeNull();
    expect(ev.home.state.key).toBe("MORNING");
    expect(ev.home.weeklyLink).toBe(false);
  });

  it("at day 21 it is a LEARN week of days 15-20 with six available days, an OPEN gate and the card", () => {
    const { plan, ev } = evaluatePreset("w2-too-short", { days: 21 });
    const { moment, ready } = readyOf(ev);
    expect(plan.asOf.toISOString()).toBe("2026-10-04T06:00:00.000Z");
    expect(moment.availableDays).toBe(6);
    expect(ready.story.mode).toBe("LEARN");
    expect(label(ready.decision)).toBe("OFFER starter eat_intentionally GOAL improve_eating");
    expect(ready.lineGate).toEqual({ open: true });
    expect(ev.home.state.key).toBe("WEEKLY_SUMMARY_READY");
  });

  it("the transition day itself is excluded: with the transition on day 12 the first window day of the week is the day after", () => {
    const { plan } = evaluatePreset("w2-too-short");
    expect(firstWeekEndedAtOf(optionsOf({ scenario: "w2-too-short" }), plan.startedAt)?.toISOString()).toBe("2026-09-24T07:00:00.000Z"); // Thu day 12, 10:00 local
  });
});

describe("the card window moves the card in and out at the documented instants (manual row W6)", () => {
  const { o, plan } = evaluatePreset("w2-learn");
  const at = (day: number, time: string) => eveningOfDay({ startedAt: plan.startedAt, day, time, timeZone: TZ });
  const home = (instant: Date) => evaluateWeekly(o, plan, instant).home.state.key;

  it.each([
    ["day 15 04:59 (Sunday, the week is not ready)", 15, "04:59", false],
    ["day 15 05:00 (Sunday, ready)", 15, "05:00", true],
    ["day 17 23:59 (Tuesday night)", 17, "23:59", true],
    ["day 18 04:59 (Wednesday, before 05:00)", 18, "04:59", true],
    ["day 18 05:00 (Wednesday, the window is over)", 18, "05:00", false],
  ])("%s", (_name, day, time, card) => {
    expect(home(at(day, time)) === "WEEKLY_SUMMARY_READY").toBe(card);
  });

  it("on the Saturday before, Home is the Shabbat silence", () => {
    expect(evaluateWeekly(o, plan, at(14, "12:00")).home.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" });
  });
});

describe("opened: the card is gone and one quiet link stays (manual row W3)", () => {
  it("an opened week keeps only the link, in a calm clock state", () => {
    const { ev } = evaluatePreset("w2-learn", {}, new Set(["2026-09-20"]));
    expect(ev.homeFact).toEqual({ weekStart: "2026-09-20", card: false });
    expect(ev.home.state.key).toBe("MORNING");
    expect(ev.home.weeklyLink).toBe(true);
  });

  it("another week's opened row changes nothing", () => {
    const { ev } = evaluatePreset("w2-learn", {}, new Set(["2026-09-13"]));
    expect(ev.home.state.key).toBe("WEEKLY_SUMMARY_READY");
    expect(ev.home.weeklyLink).toBe(false);
  });
});

describe("w3-result-due: the answer is made at the reading moment, and the next story follows it (manual row W10)", () => {
  const answered = (result: ExperimentResult) => readyOf(answeredPreset(result));

  it("before the answer the story is LEARN and the result question comes first", () => {
    const { ready } = readyOf(evaluatePreset("w3-result-due").ev);
    expect(ready.story.mode).toBe("LEARN");
    expect(ready.decision).toMatchObject({ kind: "RESULT_DUE", key: "eat_intentionally" });
  });

  it("'really helped' celebrates, says it helped, and offers the NEXT small step, never the same habit", () => {
    const { ready } = answered("helpful");
    expect([ready.story.mode, ready.story.reason, ready.story.lineKey]).toEqual(["CELEBRATE", "experiment_helpful", "celebrateExperiment"]);
    expect(ready.story.learned).toContainEqual({ kind: "EXPERIMENT", result: "helpful" });
    expect(ready.story.happened).toContainEqual({ kind: "EXPERIMENT_TRIED" });
    expect(label(ready.decision)).toBe("OFFER starter slow_down NEXT_STEP");
    expect(ready.lineGate).toEqual({ open: false, reason: "mode_fixed_text" });
  });

  it.each([
    ["somewhat", "OFFER pattern eat_intentionally KEEP_GOING"],
    ["unknown", "OFFER pattern eat_intentionally KEEP_GOING"],
    ["not_tried", "OFFER pattern eat_intentionally KEEP_GOING"],
  ] as const)("'%s' offers the same habit once more", (result, want) => {
    const { ready } = answered(result);
    expect(ready.story.mode).toBe("LEARN");
    expect(label(ready.decision)).toBe(want);
  });

  it("'not really' offers a different habit", () => {
    const { ready } = answered("not_really");
    expect(ready.decision.kind).toBe("OFFER");
    expect(ready.decision.kind === "OFFER" && ready.decision.key).toBe("slow_down");
  });

  it("'I did not get to try' is never worded as a failure and carries no helpfulness", () => {
    const { ready } = answered("not_tried");
    expect(ready.story.learned).toContainEqual({ kind: "EXPERIMENT", result: "not_tried" });
    expect(ready.story.happened.some((h) => h.kind === "EXPERIMENT_TRIED")).toBe(false);
    expect(RESULT_TO_DB.not_tried).toEqual({ tried: "NO", helpfulness: null });
  });

  it("an answer belongs to the story it was answered in: a week later it no longer makes a meaningful week", () => {
    const o = optionsOf({ scenario: "w3-result-due", days: 28, "late-days": "none", "meals-per-day": 0 });
    const plan = planOf(o);
    const answeredAtSunday = plan.experiments.map((e) => ({ ...e, status: "DONE" as const, endedAt: eveningOfDay({ startedAt: plan.startedAt, day: 22, time: "09:00", timeZone: TZ }), tried: "YES" as const, helpfulness: "HELPFUL" as const }));
    const next = evaluateWeekly(o, { ...plan, experiments: answeredAtSunday }, plan.asOf);
    const { ready } = readyOf(next);
    expect(ready.story.mode).toBe("RESET");
    expect(ready.story.happened).toEqual([]);
  });
});

describe("w4-history-rotation: the history decides, not the last answer alone", () => {
  it("a habit that helped is out for good, and the last answer 'did not get to try' offers its habit once more", () => {
    const { ev } = evaluatePreset("w4-history-rotation");
    const { ready } = readyOf(ev);
    expect(label(ready.decision)).toBe("OFFER starter slow_down KEEP_GOING");
    // Both answers (days 16 and 23) lie outside the answer window of this week: they belonged to earlier stories.
    expect(ready.story.happened.map((h) => h.kind)).toEqual(["MEALS", "WEIGHED"]);
    expect(ready.story.weight).toEqual({ kind: "UP" });
  });

  it("an increase is described exactly like a decrease: the same shape, no number", () => {
    const up = readyOf(evaluatePreset("w4-history-rotation").ev).ready.story;
    const down = readyOf(evaluatePreset("w4-down").ev).ready.story;
    expect(Object.keys(up.weight)).toEqual(Object.keys(down.weight));
    expect(JSON.stringify(up)).not.toMatch(/\d/);
  });

  it("'Not this time' on the offered habit pauses it for the library's cooldown (manual row W11)", () => {
    const o = optionsOf({ scenario: "w4-history-rotation" });
    const plan = planOf(o);
    const skippedAt = plan.asOf;
    const withSkip = [...plan.experiments, { ...plan.experiments[1], id: "skip", status: "SKIPPED" as const, key: "slow_down" as const, createdAt: skippedAt, startedAt: null, endedAt: skippedAt, tried: null, helpfulness: null }];
    const at = (days: number) => new Date(skippedAt.getTime() + days * 86_400_000);
    const decide = (instant: Date) => label(readyOf(evaluateWeekly(o, { ...plan, experiments: withSkip }, instant)).ready.decision);
    expect(decide(skippedAt)).toBe("NONE cooling_down");
    // (Past a week the weekly moment moves on; the decision itself is what the cooldown pins.)
    expect(decide(at(0.5))).toBe("NONE cooling_down");
  });
});

describe("the experiments of the plan", () => {
  const flags = { scenario: "w4-down", days: 30, "late-days": "none", exp: ["skipped@5:eat_intentionally", "done@9:helpful", "done@16:not_tried:slow_down", "active@23:micro_walk"] };

  it("land on the right local days at 10:00, with the documented end of each status", () => {
    const o = optionsOf(flags);
    const plan = planOf(o);
    const local = (d: Date | null) => (d === null ? null : `${localDayOf(d, TZ).key} ${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d)}`);
    expect(plan.experiments.map((e) => [e.status, local(e.createdAt), local(e.startedAt), local(e.endedAt)])).toEqual([
      ["SKIPPED", "2026-09-17 10:00", null, "2026-09-17 10:05"],
      ["DONE", "2026-09-21 10:00", "2026-09-21 10:00", "2026-09-28 09:00"],
      ["DONE", "2026-09-28 10:00", "2026-09-28 10:00", "2026-10-05 09:00"],
      ["ACTIVE", "2026-10-05 10:00", "2026-10-05 10:00", null],
    ]);
    expect(plan.experiments.map((e) => [e.key, e.variantId])).toEqual([
      ["eat_intentionally", "default"],
      ["eat_intentionally", "default"],
      ["slow_down", "utensils_between_bites"],
      ["micro_walk", "default"],
    ]);
  });

  it("carry the answer as the database wants it", () => {
    const plan = planOf(optionsOf(flags));
    expect(plan.experiments.map((e) => [e.tried, e.helpfulness])).toEqual([
      [null, null],
      ["YES", "HELPFUL"],
      ["NO", null],
      [null, null],
    ]);
    for (const e of plan.experiments) {
      const row = toExperimentRow(e);
      expect(row.wording_source).toBe("library");
      expect(row.wording_locale).toBe("he");
      expect(Object.keys(row)).not.toContain("source_pattern_id");
      expect(Object.keys(row)).not.toContain("user_id");
    }
  });

  it("are deterministic, unique and different per e-mail and per seed", () => {
    const a = planOf(optionsOf(flags)).experiments.map((e) => e.id);
    expect(planOfFresh(optionsOf(flags)).experiments.map((e) => e.id)).toEqual(a);
    expect(new Set(a).size).toBe(4);
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(planOf(optionsOf({ ...flags, email: "second@eating-coach.test" })).experiments.map((e) => e.id).some((id) => a.includes(id))).toBe(false);
    expect(planOf(optionsOf({ ...flags, seed: 2 })).experiments.map((e) => e.id).some((id) => a.includes(id))).toBe(false);
    expect(plannedExperimentId({ email: "demo@eating-coach.test", seed: 1 }, 0)).toBe(a[0]);
  });

  it("have an empty plan when --exp is not given and the preset has none", () => {
    expect(planOf(optionsOf({ scenario: "w2-learn" })).experiments).toEqual([]);
    expect(planOf(optionsOf({ scenario: "day3" })).experiments).toEqual([]);
  });

  it("use the library sentence of the first variant, in Hebrew, with no placeholder left, for every key", () => {
    expect(experimentWording("eat_intentionally")).toBe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך.");
    expect(experimentWording("slow_down")).toBe('בארוחה אחת היום, נסה להניח את הסכו"ם בין ביס לביס.');
    for (const key of INTERVENTION_KEYS) {
      const text = experimentWording(key);
      expect(text, key).not.toMatch(/[{}]/);
      expect(text.length, key).toBeGreaterThan(5);
      expect(text.length, key).toBeLessThanOrEqual(400);
      expect(firstVariantOf(key)).not.toBe("");
    }
    // The one entry with a parameter gets its own number.
    expect(experimentWording("delay")).toContain("10");
  });

  it("the history the app reads at an instant: a DONE row that ends later is still ACTIVE, a SKIPPED one still OFFERED, a future one does not exist", () => {
    const plan = planOf(optionsOf(flags));
    const day = (d: number, t: string) => eveningOfDay({ startedAt: plan.startedAt, day: d, time: t, timeZone: TZ });
    const states = (instant: Date) => experimentRecordsAt(plan.experiments, instant).map((r) => [r.status, r.tried, r.helpfulness]);
    expect(states(day(4, "12:00"))).toEqual([]);
    expect(states(day(5, "10:02"))).toEqual([["OFFERED", null, null]]);
    expect(states(day(10, "12:00"))).toEqual([["ACTIVE", null, null], ["SKIPPED", null, null]]);
    expect(states(day(23, "12:00"))).toEqual([["ACTIVE", null, null], ["DONE", "NO", null], ["DONE", "YES", "HELPFUL"], ["SKIPPED", null, null]]);
  });
});

describe("--first-weigh-day, --transition-day and the profile", () => {
  it("w2-first-weigh-in has exactly one weigh-in: Monday of day 9 at 08:00, inside the window that starts that day", () => {
    const { plan } = evaluatePreset("w2-first-weigh-in");
    expect(plan.weights).toHaveLength(1);
    expect(plan.weights[0]).toMatchObject({ day: 9, weightKg: 79.8 });
    expect(new Date(plan.weights[0].measuredAt).toISOString()).toBe("2026-09-21T05:00:00.000Z");
  });

  it("the first entry falls on the first weigh day on or after --first-weigh-day; later ones follow every 7 days", () => {
    const base = { days: 30, weights: "weekly", "weigh-day": 1, "meals-per-day": 0 } as const;
    const days = (extra: Record<string, string | number>) => planOf(optionsOf({ ...base, ...extra })).weights.map((w) => w.day);
    expect(days({})).toEqual([2, 9, 16, 23, 30]);
    expect(days({ "first-weigh-day": 9 })).toEqual([9, 16, 23, 30]);
    expect(days({ "first-weigh-day": 10 })).toEqual([16, 23, 30]);
    expect(days({ "first-weigh-day": 3 })).toEqual([9, 16, 23, 30]);
  });

  it("--first-weigh-day is ignored without a weekly weights mode", () => {
    const daily = planOf(optionsOf({ days: 12, weights: "daily", "first-weigh-day": 9, "meals-per-day": 0 })).weights.map((w) => w.day);
    expect(daily).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]); // not Saturday, day 7: a weigh-in inside Shabbat is dropped like a meal
    expect(planOf(optionsOf({ days: 12, "first-weigh-day": 9, "meals-per-day": 0 })).weights).toEqual([]);
  });

  it("--transition-day sets first_week_ended_at at 10:00 local on that day; without it the Weight item's rule still holds", () => {
    const o = optionsOf({ scenario: "w2-learn" });
    const plan = planOf(o);
    expect(toProfileUpdate(o, plan.startedAt)).toMatchObject({ lifecycle_state: "WEEKLY_CYCLE", observes_shabbat: true, first_week_ended_at: "2026-09-20T07:00:00.000Z" });
    const w = optionsOf({ scenario: "w-down" });
    expect(firstWeekEndedAtOf(w, planOf(w).startedAt)?.toISOString()).toBe("2026-09-27T09:00:00.000Z");
    expect(toProfileUpdate(optionsOf({ scenario: "day3" }), planOf(optionsOf({ scenario: "day3" })).startedAt)).toMatchObject({ lifecycle_state: "FIRST_WEEK", first_week_ended_at: null });
  });

  it("a profile that keeps Shabbat with its rows missing has no offline periods in the plan and observes_shabbat true", () => {
    const o = optionsOf({ scenario: "w2-shabbat-rows-missing" });
    const plan = planOf(o);
    expect(plan.offline).toEqual([]);
    expect(toProfileUpdate(o, plan.startedAt).observes_shabbat).toBe(true);
    expect(toProfileUpdate(optionsOf({ scenario: "w2-learn", shabbat: "false" }), plan.startedAt).observes_shabbat).toBe(false);
  });
});

describe("--pattern-answer", () => {
  const flags = { scenario: "w2-learn" } as const;

  it("confirm and unsure sync the live evenings of that morning, with the status the live level gives", () => {
    const confirm = planOf(optionsOf({ ...flags, "pattern-answer": "confirm@12" })).patternAnswer;
    const unsure = planOf(optionsOf({ ...flags, "pattern-answer": "unsure@12" })).patternAnswer;
    expect(confirm?.occurrences.map((o) => localDayOf(o.observedAt, TZ).key)).toEqual(["2026-09-14", "2026-09-15", "2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(unsure?.occurrences).toEqual(confirm?.occurrences);
    expect(confirm?.answeredAt.toISOString()).toBe("2026-09-24T06:00:00.000Z"); // Thu 09:00 Asia/Jerusalem
    // A "Sounds right" given while the pattern is already a Candidate makes it Validated; "Not sure" leaves it a Candidate.
    expect(confirm?.syncStatus).toBe("VALIDATED");
    expect(unsure?.syncStatus).toBe("CANDIDATE");
    expect(toPatternAnswerPatch(confirm!)).toEqual({ user_feedback: "confirm", user_feedback_at: "2026-09-24T06:00:00.000Z" });
    expect(toSyncOccurrences(confirm!)).toHaveLength(5);
  });

  it("an answer given at the two-evening Early Signal is not counted as Validated later", () => {
    const early = planOf(optionsOf({ ...flags, "pattern-answer": "confirm@4" })).patternAnswer; // evenings of day 2 and 3 only
    expect(early?.occurrences).toHaveLength(2);
    expect(early?.syncStatus).toBe("OBSERVATION");
  });

  it("reject syncs an empty set and marks the row REJECTED", () => {
    const reject = planOf(optionsOf({ ...flags, "pattern-answer": "reject@12" })).patternAnswer;
    expect(reject).toMatchObject({ answer: "reject", syncStatus: "OBSERVATION", occurrences: [] });
    expect(toPatternAnswerPatch(reject!)).toEqual({ user_feedback: "reject", user_feedback_at: "2026-09-24T06:00:00.000Z", status: "REJECTED" });
  });

  it("an after-Shabbat report is never evidence: its time is an estimate", () => {
    const o = optionsOf({ ...flags, days: 21, "late-days": "none", "aggregated-saturday-night": "true", "pattern-answer": "unsure@16" });
    const plan = planOf(o);
    expect(plan.meals.filter((m) => m.aggregated)).toHaveLength(3); // the Saturday nights of days 7, 14 and 21, each at a late-evening time
    expect(plan.patternAnswer?.occurrences).toEqual([]);
    expect(plan.patternAnswer?.syncStatus).toBe("OBSERVATION");
  });

  it("with no flag there is no answer", () => {
    expect(planOf(optionsOf(flags)).patternAnswer).toBeNull();
  });

  it("the story reads the answer: after 'Sounds right' the question is gone and the pattern-led offer remains; after a rejection both are gone (manual row W7)", () => {
    const base = readyOf(evaluatePreset("w2-learn").ev).ready;
    expect(base.story.patternQuestion.kind).toBe("ASK");
    const confirm = readyOf(evaluatePreset("w2-learn", { "pattern-answer": "confirm@12" }).ev).ready;
    expect(confirm.story.patternQuestion.kind).toBe("NONE");
    expect(label(confirm.decision)).toBe("OFFER pattern eat_intentionally PATTERN");
    const unsure = readyOf(evaluatePreset("w2-learn", { "pattern-answer": "unsure@12" }).ev).ready;
    expect(unsure.story.patternQuestion.kind).toBe("NONE");
    // "Not sure" keeps the question away for the library's cooldown, and the offer waits with it: the goal-led starter comes instead.
    expect(label(unsure.decision)).toBe("OFFER starter eat_intentionally GOAL improve_eating");
    const reject = readyOf(evaluatePreset("w2-learn", { "pattern-answer": "reject@12" }).ev).ready;
    expect(reject.story.patternQuestion.kind).toBe("NONE");
    expect(reject.story.learned).toEqual([{ kind: "NOT_YET" }]);
    expect(label(reject.decision)).toBe("OFFER starter eat_intentionally GOAL improve_eating");
  });
});

describe("--weekly-opened", () => {
  it("is the row the press would have written: the week's Sunday, the story's mode, stamped the Sunday after at 09:00", () => {
    const o = optionsOf({ scenario: "w2-learn", "weekly-opened": 8 });
    const opened = planWeeklyOpened(o, planOf(o));
    expect(opened).toMatchObject({ weekStart: "2026-09-20", openingMode: "LEARN" });
    expect(opened?.viewedAt.toISOString()).toBe("2026-09-27T06:00:00.000Z");
    expect(toWeeklySummaryRow(opened!)).toEqual({
      week_start: "2026-09-20",
      opening_mode: "LEARN",
      content: { v: 1 },
      generated_at: "2026-09-27T06:00:00.000Z",
      viewed_at: "2026-09-27T06:00:00.000Z",
    });
  });

  it("carries the mode of each kind of week", () => {
    for (const [scenario, day, mode] of [["w2-celebrate", 15, "CELEBRATE"], ["w2-recover", 8, "RECOVER"], ["w2-quiet-card", 8, "RESET"], ["w4-down", 22, "LEARN"]] as const) {
      const o = optionsOf({ scenario, "weekly-opened": day });
      expect(planWeeklyOpened(o, planOf(o))?.openingMode, scenario).toBe(mode);
    }
  });

  it("is null when the week had no weekly moment, when no flag was given and for a lifecycle that is not the weekly cycle", () => {
    const short = optionsOf({ scenario: "w2-too-short", "weekly-opened": 8 });
    expect(planWeeklyOpened(short, planOf(short))).toBeNull();
    const none = optionsOf({ scenario: "w2-learn" });
    expect(planWeeklyOpened(none, planOf(none))).toBeNull();
    const first = optionsOf({ scenario: "w2-learn", lifecycle: "first_week", "weekly-opened": 8 });
    expect(planWeeklyOpened(first, planOf(first))).toBeNull();
  });
});

describe("the plan stays deterministic and carries nothing secret", () => {
  it.each(WEEKLY_SCENARIOS)("%s: the same options give the same plan, and no e-mail or key is in it", (scenario) => {
    const o = optionsOf({ scenario });
    expect(planOfFresh(o)).toEqual(planOf(o));
    const text = JSON.stringify(planOf(o));
    expect(text).not.toContain(o.email);
    expect(text.toLowerCase()).not.toMatch(/password|secret|eyj|sb_/);
  });

  it.each(WEEKLY_SCENARIOS)("%s: nothing is dated after the clock", (scenario) => {
    const o = optionsOf({ scenario });
    const plan = planOf(o);
    for (const m of plan.meals) expect(m.confirmedAt.getTime()).toBeLessThanOrEqual(plan.asOf.getTime());
    for (const w of plan.weights) expect(w.measuredAt.getTime()).toBeLessThanOrEqual(plan.asOf.getTime());
    for (const e of plan.experiments) {
      expect(e.createdAt.getTime()).toBeLessThanOrEqual(plan.asOf.getTime());
      if (e.endedAt !== null) expect(e.endedAt.getTime()).toBeLessThanOrEqual(plan.asOf.getTime());
    }
  });
});
