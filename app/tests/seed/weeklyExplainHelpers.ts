import { decideWeeklyMoment } from "@/domain/weekly";
import type { ExplainFacts, WeeklyExplain } from "../../scripts/seed-demo/explain";
import { landmarkConfirmedIn } from "../../scripts/seed-demo/explain";
import type { SeedOptions } from "../../scripts/seed-demo/args";
import type { SeedPlan } from "../../scripts/seed-demo/plan";
import { evaluateWeekly } from "../../scripts/seed-demo/weeklyEval";

/**
 * The --explain facts the live collector (db.ts) would build for a seeded user, built here from the plan with the same domain
 * functions, so the lines can be tested without a database. The collector itself is covered by the manual checklist.
 */
export function weeklyExplainOf(o: SeedOptions, plan: SeedPlan, now: Date, opened: ReadonlySet<string> = new Set()): ExplainFacts {
  const ev = evaluateWeekly(o, plan, now, opened);
  const candidate = decideWeeklyMoment({ now, timeZone: o.timeZone, lifecycle: "WEEKLY_CYCLE", firstWeekEndedAt: new Date(0), periods: [], aggregatedReportConfirmedAt: null });
  if (candidate.kind !== "READY") throw new Error("expected a candidate week");
  const week = { weekStart: candidate.week.weekStart, start: candidate.week.start, end: candidate.week.end };
  const entries = plan.weights.map((w) => ({ id: w.id, weightKg: w.weightKg, measuredAt: w.measuredAt }));

  const weekly: WeeklyExplain = {
    kind: "CYCLE",
    week,
    readyAt: candidate.readyAt,
    moment: ev.moment,
    periodsComplete: ev.periodsComplete,
    card: { windowOpen: true, opened: opened.has(week.weekStart), snoozed: false, activity: ev.homeFact !== null, fact: ev.homeFact },
    story:
      ev.ready === null || ev.moment.kind !== "READY"
        ? null
        : {
            story: ev.ready.story,
            decision: ev.ready.decision,
            availableDays: ev.moment.availableDays,
            mealDays: ev.ready.mealDays,
            returned: ev.ready.returned,
            landmark: landmarkConfirmedIn({
              series: { entries, truncated: false },
              profile: { startKg: o.startWeightKg, goalKg: o.goalWeightKg, goalType: o.goalWeightKg === null ? "none" : "numeric" },
              weekStart: week.weekStart,
              timeZone: o.timeZone,
              now,
            }),
          },
  };
  return {
    email: o.email,
    now,
    clockFile: null,
    timeZone: o.timeZone,
    lifecycle: o.lifecycle === "weekly_cycle" ? "WEEKLY_CYCLE" : "FIRST_WEEK",
    progress: null,
    step: null,
    signal: null,
    excluded: [],
    storedEvidence: null,
    earlySignal: null,
    quietHours: null,
    home: ev.home,
    selection: null,
    dailyCap: o.explainDailyCap,
    weight: null,
    weekly,
  };
}
