import { eveningOfDay } from "@/domain/asOf";
import { NOT_SNOOZED } from "@/domain/firstWeekFlow";
import { resolveHome, type HomeDecision } from "@/domain/home";
import type { OfflinePeriod } from "@/domain/offline";
import { LATE_EVENING, detectLateEvening, effectivePatternStatus, type PatternRow } from "@/domain/patterns";
import { DAY_MS, localDayOf, resolveTimeZone } from "@/domain/time";
import { decideMilestoneMoment, milestoneProgress, weeklyPoints, type MilestoneMoment, type WeightEntry } from "@/domain/weight";
import {
  buildWeeklyStory,
  decideWeeklyExperiment,
  decideWeeklyMoment,
  mealDaysIn,
  findReturn,
  shiftWeek,
  weeklyCardPrecheck,
  weeklyWeightFacts,
  WEEKLY_THRESHOLDS,
  type ExperimentRecord,
  type OpeningMode,
  type PatternSignal,
  type WeekWindow,
  type WeeklyExperimentDecision,
  type WeeklyHomeFact,
  type WeeklyMeal,
  type WeeklyMoment,
  type WeeklyStory,
} from "@/domain/weekly";
import { decideWeeklyLineGate, type WeeklyLineGate } from "@/domain/weekly/wording";
import type { SeedOptions } from "./args";
import { firstWeekEndedAtOf } from "./plan";
import type { PlannedExperiment, PlannedPatternAnswer } from "./weekly";

/**
 * What the app would decide about "your week" for a seeded user at an instant, computed with the app's own domain functions on the
 * PLAN (no database): the loaders' reads reproduced on the planned rows. The seed uses it to give a `--weekly-opened` row the
 * opening mode the real press would store, and tests/seed/weeklyPlan.test.ts uses it as the authority for the presets of 15.2.
 * `--explain` does NOT use it: that reads the live database through the app's own loaders.
 */

/** The planned rows, structurally: a SeedPlan satisfies it. */
export interface WeeklyData {
  startedAt: Date;
  meals: readonly { id: string; occurredAt: Date; aggregated: boolean }[];
  offline: readonly { type: "SHABBAT"; start: Date; end: Date }[];
  weights: readonly { id: string; weightKg: number; measuredAt: Date }[];
  experiments: readonly PlannedExperiment[];
  patternAnswer: PlannedPatternAnswer | null;
}

export interface WeeklyEvaluation {
  moment: WeeklyMoment;
  /** null unless the moment is READY. false = the Shabbat rows of the week are missing (a return is never claimed on shaky days). */
  periodsComplete: boolean | null;
  /** null unless the moment is READY. */
  ready: {
    story: WeeklyStory;
    decision: WeeklyExperimentDecision;
    /** The gate of the opening line under the fixed assumption of --explain: AI configured, the options' daily cap, nothing used. */
    lineGate: WeeklyLineGate;
    mealDays: number;
    returned: boolean;
    /** The late-evening signal at the instant. */
    signal: PatternSignal;
  } | null;
  /** What the Home loader would decide (the opened weeks given by the caller). */
  homeFact: WeeklyHomeFact | null;
  /** The Weight item's Home moment at the instant (nothing is thanked yet). It waits below the weekly card. */
  milestone: MilestoneMoment | null;
  home: HomeDecision;
}

/** A SHABBAT period overlaps the week: the automatic rows run out, and after the last one a Saturday would read as an available day. */
export function shabbatCovers(periods: readonly OfflinePeriod[], week: WeekWindow): boolean {
  return periods.some((p) => p.type === "SHABBAT" && p.start.getTime() < week.end.getTime() && p.end.getTime() > week.start.getTime());
}

/**
 * The experiment rows as the history read sees them at `at`, newest first by the offer: a row not offered yet does not exist, a DONE
 * row that ends later is still ACTIVE (no answer yet) and a SKIPPED row that ends later is still OFFERED.
 */
export function experimentRecordsAt(planned: readonly PlannedExperiment[], at: Date): ExperimentRecord[] {
  const records: { record: ExperimentRecord; createdAt: number; index: number }[] = [];
  planned.forEach((e, index) => {
    if (e.createdAt.getTime() > at.getTime()) return;
    const ended = e.endedAt !== null && e.endedAt.getTime() <= at.getTime();
    const status = e.status === "DONE" ? (ended ? "DONE" : "ACTIVE") : e.status === "SKIPPED" ? (ended ? "SKIPPED" : "OFFERED") : e.status;
    const answered = status === "DONE";
    records.push({
      record: {
        id: e.id,
        status,
        key: e.key,
        variantId: e.variantId,
        sourcePatternId: null,
        startedAt: status === "ACTIVE" || status === "DONE" ? e.startedAt : null,
        endedAt: status === "DONE" || status === "SKIPPED" ? e.endedAt : null,
        tried: answered ? e.tried : null,
        helpfulness: answered ? e.helpfulness : null,
      },
      createdAt: e.createdAt.getTime(),
      index,
    });
  });
  return records.sort((a, b) => b.createdAt - a.createdAt || b.index - a.index).map((r) => r.record);
}

/** The late-evening signal at `at`, as the loader builds it: the live occurrences of the last 30 days and the person's own row. */
function signalAt(options: SeedOptions, data: WeeklyData, at: Date): PatternSignal {
  const timeZone = resolveTimeZone(options.timeZone);
  const from = at.getTime() - LATE_EVENING.lookbackDays * DAY_MS;
  const stamps = data.meals.filter((m) => !m.aggregated && m.occurredAt.getTime() >= from && m.occurredAt.getTime() <= at.getTime()).map((m) => ({ id: m.id, occurredAt: m.occurredAt }));
  const occurrences = detectLateEvening({ meals: stamps, timeZone, asOf: at });
  const answer = data.patternAnswer !== null && data.patternAnswer.answeredAt.getTime() <= at.getTime() ? data.patternAnswer : null;
  const row: PatternRow | null =
    answer === null
      ? null
      : { id: "seed-pattern", status: answer.answer === "reject" ? "REJECTED" : answer.syncStatus, feedback: answer.answer, feedbackAt: answer.answeredAt };
  const view = effectivePatternStatus({ occurrences: occurrences.map((o) => o.occurredAt), timeZone, row });
  return { kind: LATE_EVENING.kind, patternId: row?.id ?? null, view, feedback: row?.feedback ?? null, feedbackAt: row?.feedbackAt ?? null };
}

/**
 * Pure. `opened` holds the week keys whose `weekly_summaries` row exists (the Home card then stays hidden and the quiet link shows).
 * Only the weekly cycle has a weekly moment: any other lifecycle answers NONE not_weekly_cycle and no Home fact.
 */
export function evaluateWeekly(options: SeedOptions, data: WeeklyData, at: Date, opened: ReadonlySet<string> = new Set()): WeeklyEvaluation {
  const timeZone = resolveTimeZone(options.timeZone);
  const weeklyCycle = options.lifecycle === "weekly_cycle";
  const periods: OfflinePeriod[] = data.offline.map((p) => ({ type: p.type, start: p.start, end: p.end }));
  const firstWeekEndedAt = firstWeekEndedAtOf(options, data.startedAt);

  const moment = decideWeeklyMoment({
    now: at,
    timeZone,
    lifecycle: weeklyCycle ? "WEEKLY_CYCLE" : "FIRST_WEEK",
    firstWeekEndedAt,
    periods,
    aggregatedReportConfirmedAt: null,
  });

  const entries: WeightEntry[] = data.weights.map((w) => ({ id: w.id, weightKg: w.weightKg, measuredAt: w.measuredAt }));
  const profile = { startWeightKg: options.startWeightKg, goalWeightKg: options.goalWeightKg, goalType: options.goalWeightKg === null ? ("none" as const) : ("numeric" as const) };
  const signal = signalAt(options, data, at);
  const history = experimentRecordsAt(data.experiments, at);

  let periodsComplete: boolean | null = null;
  let ready: WeeklyEvaluation["ready"] = null;
  if (moment.kind === "READY") {
    const { week, window } = moment;
    periodsComplete = !options.observesShabbat || shabbatCovers(periods, week);
    const meals: WeeklyMeal[] = data.meals.filter((m) => m.occurredAt.getTime() < week.end.getTime()).map((m) => ({ id: m.id, occurredAt: m.occurredAt, aggregated: m.aggregated }));
    const before = data.meals.filter((m) => !m.aggregated && m.occurredAt.getTime() < window.start.getTime()).map((m) => m.occurredAt.getTime());
    const lastMealBefore = before.length === 0 ? null : new Date(Math.max(...before));
    const weight = weeklyWeightFacts({
      entries,
      truncated: false,
      week: { weekStart: week.weekStart, start: week.start, end: week.end },
      windowStart: window.start,
      timeZone,
      now: at,
      profile,
    });
    const story = buildWeeklyStory({
      now: at,
      timeZone,
      window,
      week: { start: week.start, end: week.end },
      answerWindow: { start: week.end, end: shiftWeek(week, 1, timeZone).end },
      periods,
      periodsComplete,
      meals,
      lastMealBefore,
      weight,
      signals: [signal],
      experiments: history,
    });
    const decision = decideWeeklyExperiment({ now: at, mode: story.mode, patterns: [signal], history, goalFocus: options.goals });
    ready = {
      story,
      decision,
      lineGate: decideWeeklyLineGate({ mode: story.mode, availableDays: moment.availableDays, ai: { configured: true, dailyCap: options.explainDailyCap, allowance: { allowed: true, usedToday: 0 } } }),
      mealDays: mealDaysIn({ meals, periods, timeZone, window }),
      returned: findReturn({ meals, lastMealBefore, periods, timeZone, window, minGapAvailableDays: WEEKLY_THRESHOLDS.returnGapAvailableDays }),
      signal,
    };
  }

  // The Home fact, as loadWeeklyHomeFact decides it: the card window must be open, an opened week keeps only the quiet link (no snooze
  // is ever seeded), and an untouched card needs a confirmed meal or a weigh-in from the window start to the week's end.
  let homeFact: WeeklyHomeFact | null = null;
  if (weeklyCycle && moment.kind === "READY") {
    const precheck = weeklyCardPrecheck({ now: at, timeZone, aggregatedReportConfirmedAt: null });
    if (precheck !== null && moment.cardVisible && moment.week.weekStart === precheck.week.weekStart) {
      const { week, window } = moment;
      if (opened.has(week.weekStart)) homeFact = { weekStart: week.weekStart, card: false };
      else {
        const inWindow = (t: Date) => t.getTime() >= window.start.getTime() && t.getTime() < week.end.getTime();
        const active = data.meals.some((m) => !m.aggregated && inWindow(m.occurredAt)) || data.weights.some((w) => inWindow(w.measuredAt));
        if (active) homeFact = { weekStart: week.weekStart, card: true };
      }
    }
  }

  const points = weeklyPoints(entries, timeZone, at);
  const progress = milestoneProgress({ startKg: profile.startWeightKg, goalKg: profile.goalWeightKg, goalType: profile.goalType, weeklyPoints: points, complete: true });
  const milestone = decideMilestoneMoment({ progress, now: at, timeZone, acknowledged: new Set() });
  const home = resolveHome({
    now: at,
    timeZone,
    offlinePeriods: periods,
    hasAnyReport: data.meals.length > 0 || data.weights.length > 0,
    lifecycle: weeklyCycle ? "WEEKLY_CYCLE" : "FIRST_WEEK",
    firstWeek: null,
    firstWeekSnoozed: { ...NOT_SNOOZED },
    earlySignal: null,
    quietHours: null,
    milestone,
    weekly: homeFact,
    // The active-experiment card is shipped OFF and the seed plans no experiment card (it reads no ACTIVE row here).
    activeExperiment: null,
  });

  return { moment, periodsComplete, ready, homeFact, milestone, home };
}

export interface PlannedWeeklyOpened {
  /** The local Sunday that starts the week (weekly_summaries.week_start). */
  weekStart: string;
  /** What the real press would have stored for that week. */
  openingMode: OpeningMode;
  /** The Sunday after the week, 09:00 local: when the week was ready and the person pressed the card. */
  viewedAt: Date;
}

/**
 * `--weekly-opened`: the row the press of "To my week" would have written for the week that starts on that Sunday, stamped on the
 * Sunday after it at 09:00, with the opening mode the story had at that moment. null when there was no such moment (the week had no
 * weekly moment then, or the requested day is not the week that became ready), because the app could not have written the row.
 */
export function planWeeklyOpened(options: SeedOptions, data: WeeklyData): PlannedWeeklyOpened | null {
  if (options.weeklyOpened === null) return null;
  const timeZone = resolveTimeZone(options.timeZone);
  const viewedAt = eveningOfDay({ startedAt: data.startedAt, day: options.weeklyOpened + 7, time: "09:00", timeZone });
  const requested = localDayOf(eveningOfDay({ startedAt: data.startedAt, day: options.weeklyOpened, time: "12:00", timeZone }), timeZone).key;
  const evaluation = evaluateWeekly(options, data, viewedAt);
  if (evaluation.moment.kind !== "READY" || evaluation.ready === null || evaluation.moment.week.weekStart !== requested) return null;
  return { weekStart: requested, openingMode: evaluation.ready.story.mode, viewedAt };
}

/** The `weekly_summaries` insert: the same row `openWeeklyStory` writes (content `{ "v": 1 }`, both stamps explicit). `user_id` is the column default. */
export function toWeeklySummaryRow(w: PlannedWeeklyOpened) {
  return {
    week_start: w.weekStart,
    opening_mode: w.openingMode,
    content: { v: 1 },
    generated_at: w.viewedAt.toISOString(),
    viewed_at: w.viewedAt.toISOString(),
  };
}
