import { describe, expect, it } from "vitest";
import { WEEKLY_FLOW } from "@/domain/weekly";
import { formatExplain, landmarkConfirmedIn, type ExplainFacts, type WeeklyExplain } from "../../scripts/seed-demo/explain";
import { weeklyExplainOf } from "./weeklyExplainHelpers";
import { evaluatePreset } from "./weeklyHelpers";

/**
 * The weekly lines of `--explain` (15.1), with the SHIPPED switches. The facts are built from the plan with the same domain
 * functions the live collector uses; the collector itself (the app's loaders against the local database) is the manual checklist.
 */

function linesOf(scenario: string, extra: Record<string, string | number> = {}, opened: ReadonlySet<string> = new Set()): string[] {
  const { o, plan } = evaluatePreset(scenario, extra);
  return formatExplain(weeklyExplainOf(o, plan, plan.asOf, opened));
}

const weeklyOnly = (lines: string[]) => lines.filter((l) => /^(weekly|shabbat rows|Home weekly)/.test(l));

/** Runs `body` with the AI opening line switched on (it ships OFF), and always puts the shipped value back. */
function withAiLine(body: () => void): void {
  const shipped = WEEKLY_FLOW.aiLineEnabled;
  Object.assign(WEEKLY_FLOW, { aiLineEnabled: true });
  try {
    body();
  } finally {
    Object.assign(WEEKLY_FLOW, { aiLineEnabled: shipped });
  }
}

describe("a learning week (w2-learn)", () => {
  const lines = weeklyOnly(linesOf("w2-learn"));

  it("names the candidate week, its readiness, the window and the moment", () => {
    expect(lines).toContain("weekly week: 2026-09-20 (Sunday to Saturday), ready from 2026-09-27T05:00:00+03:00");
    expect(lines).toContain("weekly window: 2026-09-21T00:00:00+03:00 to 2026-09-27T00:00:00+03:00, 5 available days (a window needs at least 4)");
    expect(lines).toContain("weekly moment: READY, the card window is open");
    expect(lines).toContain("shabbat rows: complete for this week");
  });

  it("names why the card shows, and the link", () => {
    expect(lines.find((l) => l.startsWith("weekly card:"))).toMatch(/^weekly card: SHOWN/);
    expect(lines).toContain("Home weekly link: no");
  });

  it("names the mode, the meal days, the weight line KIND, the invitation, the decision, the question and the gate", () => {
    expect(lines).toContain("weekly mode: LEARN (data), opening line learn");
    expect(lines).toContain("weekly meal days: 5; return after a gap: no");
    expect(lines).toContain("weekly weight line: NONE; landmark confirmed this week: none");
    expect(lines).toContain("weekly weigh-in invitation: shown");
    expect(lines).toContain("weekly experiment: OFFER eat_intentionally / default, origin pattern, rationale PATTERN late_evening_meals");
    expect(lines).toContain("weekly pattern question: due (late_evening_meals)");
    // The AI opening line ships OFF (owner, 2026-10-05): the shipped gate says so before anything else.
    expect(lines).toContain("weekly opening line gate (same assumption): CLOSED (switch_off)");
    expect(lines).toContain("weekly starter experiments: switched on");
  });

  it("with the AI opening line switched on, the gate is open and follows --daily-cap like the experiment sentence's", () => {
    withAiLine(() => {
      expect(weeklyOnly(linesOf("w2-learn"))).toContain("weekly opening line gate (same assumption): OPEN");
      expect(weeklyOnly(linesOf("w2-learn", { "daily-cap": 9 }))).toContain("weekly opening line gate (same assumption): CLOSED (allowance_reserve)");
    });
  });
});

describe("the other kinds of week", () => {
  it("a celebrating week names the step and the two weeks of the pair, and the gate is closed", () => {
    const lines = weeklyOnly(linesOf("w2-celebrate"));
    expect(lines).toContain("weekly mode: CELEBRATE (milestone), opening line celebrateMilestone");
    expect(lines).toContain("weekly weight line: BUILDING; landmark confirmed this week: step 1, the pair 2026-09-20 and 2026-09-27");
    // Even with the AI opening line switched on, a CELEBRATE sentence is fixed text and never goes to a provider.
    withAiLine(() => {
      expect(weeklyOnly(linesOf("w2-celebrate"))).toContain("weekly opening line gate (same assumption): CLOSED (mode_fixed_text)");
    });
  });

  it("the goal week names the goal, and the experiment is the goal-led starter (the starters ship on)", () => {
    const lines = weeklyOnly(linesOf("w4-goal"));
    expect(lines).toContain("weekly weight line: DOWN; landmark confirmed this week: step 2 (the goal), the pair 2026-09-27 and 2026-10-04");
    expect(lines).toContain("weekly experiment: OFFER eat_intentionally / default, origin starter, rationale GOAL improve_eating");
  });

  it("a returning week and a quiet week", () => {
    expect(weeklyOnly(linesOf("w2-recover"))).toContain("weekly mode: RECOVER (returned), opening line recover");
    expect(weeklyOnly(linesOf("w2-recover"))).toContain("weekly meal days: 2; return after a gap: yes");
    expect(weeklyOnly(linesOf("w2-recover"))).toContain("weekly experiment: NONE (recovering)");
    expect(weeklyOnly(linesOf("w2-quiet-none"))).toContain("weekly mode: RESET (little_data), opening line quiet");
    expect(weeklyOnly(linesOf("w2-quiet-none"))).toContain("weekly experiment: NONE (quiet_week)");
  });

  it("an open result question comes first", () => {
    expect(weeklyOnly(linesOf("w3-result-due"))).toContain("weekly experiment: RESULT_DUE (eat_intentionally: the result question comes first)");
  });

  it("missing Shabbat rows are said plainly (manual row W13)", () => {
    const lines = weeklyOnly(linesOf("w2-shabbat-rows-missing"));
    expect(lines.some((l) => l.startsWith("shabbat rows missing for this week"))).toBe(true);
    expect(lines).toContain("weekly mode: LEARN (data), opening line learn");
  });

  it("no moment: the week is named, the reason is named, and there is no story", () => {
    const lines = weeklyOnly(linesOf("w2-too-short"));
    expect(lines).toContain("weekly moment: NONE (window_too_short)");
    expect(lines).toContain("weekly card: no card: the moment is NONE (window_too_short)");
    expect(lines).toContain("weekly story: none (no weekly moment)");
  });

  it("an opened week hides the card and shows the link", () => {
    const lines = weeklyOnly(linesOf("w2-learn", {}, new Set(["2026-09-20"])));
    expect(lines).toContain("weekly card: no card: the week was already opened, only the quiet link shows");
    expect(lines).toContain("Home weekly link: yes (the card was opened or snoozed: one quiet link)");
  });

  it("a week with no report has no card, and says why", () => {
    const { o, plan } = evaluatePreset("w2-quiet-none");
    const facts = weeklyExplainOf(o, plan, plan.asOf);
    const weekly = facts.weekly as Extract<WeeklyExplain, { kind: "CYCLE" }>;
    const text = formatExplain({ ...facts, weekly: { ...weekly, card: { ...weekly.card, activity: false } } });
    expect(text).toContain("weekly card: no card: no confirmed meal and no weigh-in in the window, so there is no report to talk about");
  });
});

describe("the weekly lines carry no kilogram figure and no secret", () => {
  it.each(["w2-learn", "w2-celebrate", "w2-first-weigh-in", "w4-history-rotation", "w4-down", "w4-goal"])("%s", (scenario) => {
    const text = weeklyOnly(linesOf(scenario)).join("\n");
    expect(text).not.toMatch(/\bkg\b|kilogram|\d+\.\d/i);
    expect(text).not.toMatch(/@|eyj|sb_|password|secret/i);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

describe("the experiment sentence's wording gate in the weekly cycle", () => {
  const candidate = (n: number) => ({
    occurrences: Array.from({ length: n }, (_, i) => ({ mealId: `m${i}`, occurredAt: new Date(`2026-09-1${i}T18:30:00Z`), localDay: `2026-09-1${i}` })),
    row: null,
    view: "CANDIDATE" as const,
  });

  it("takes the weekly window's available days, as the weekly actions pass them", () => {
    const { o, plan } = evaluatePreset("w2-learn");
    const facts = { ...weeklyExplainOf(o, plan, plan.asOf), signal: candidate(5) };
    expect(formatExplain(facts)).toContain("wording gate: OPEN"); // 5 available days in the window, at least 4 needed
    expect(formatExplain({ ...facts, dailyCap: 9 })).toContain("wording gate: CLOSED (allowance_reserve)");
  });

  it("is unknown without a weekly story, and the First Week's own days still win in the First Week", () => {
    const { o, plan } = evaluatePreset("w2-too-short");
    expect(formatExplain({ ...weeklyExplainOf(o, plan, plan.asOf), signal: candidate(5) }).join("\n")).toContain("wording gate: unknown");
    const first = weeklyExplainOf(o, plan, plan.asOf);
    expect(formatExplain({ ...first, signal: candidate(3), progress: { availableDays: 3, confirmedMeals: 10, availableDaysSinceLastMeal: 0 } })).toContain("wording gate: CLOSED (too_few_days)");
  });
});

describe("the other states of the weekly part", () => {
  const base = (weekly: ExplainFacts["weekly"], lifecycle: ExplainFacts["lifecycle"] = "WEEKLY_CYCLE") => {
    const { o, plan } = evaluatePreset("w2-learn");
    return formatExplain({ ...weeklyExplainOf(o, plan, plan.asOf), lifecycle, weekly });
  };

  it("not in the weekly cycle (manual row W1)", () => {
    const lines = base({ kind: "NOT_WEEKLY_CYCLE" }, "FIRST_WEEK");
    expect(lines).toContain("weekly: not in the weekly cycle (lifecycle FIRST_WEEK), nothing weekly can happen");
  });

  it("switched off, and unknown", () => {
    expect(base({ kind: "SWITCHED_OFF" })).toContain("weekly: switched off (WEEKLY_FLOW.enabled is false), no card, no page");
    expect(base(null)).toContain("weekly: unknown (the weekly reads failed)");
  });
});

describe("landmarkConfirmedIn", () => {
  const entries = [
    { id: "a", weightKg: 75.9, measuredAt: new Date("2026-09-18T05:00:00Z") },
    { id: "b", weightKg: 74.8, measuredAt: new Date("2026-09-25T05:00:00Z") },
    { id: "c", weightKg: 74.6, measuredAt: new Date("2026-10-02T05:00:00Z") },
  ];
  const profile = { startKg: 80, goalKg: 70, goalType: "numeric" as const };
  const now = new Date("2026-10-04T06:00:00Z");

  it("is the step whose second week of the pair is the summarised week", () => {
    expect(landmarkConfirmedIn({ series: { entries, truncated: false }, profile, weekStart: "2026-09-27", timeZone: "Asia/Jerusalem", now })).toEqual({
      index: 1,
      isGoal: false,
      firstWeek: "2026-09-20",
      secondWeek: "2026-09-27",
    });
  });

  it("is null for a week that did not confirm anything, without a numeric goal and for a truncated history", () => {
    expect(landmarkConfirmedIn({ series: { entries, truncated: false }, profile, weekStart: "2026-09-20", timeZone: "Asia/Jerusalem", now })).toBeNull();
    expect(landmarkConfirmedIn({ series: { entries, truncated: false }, profile: { ...profile, goalType: "none" }, weekStart: "2026-09-27", timeZone: "Asia/Jerusalem", now })).toBeNull();
    expect(landmarkConfirmedIn({ series: { entries, truncated: true }, profile, weekStart: "2026-09-27", timeZone: "Asia/Jerusalem", now })).toBeNull();
  });
});
