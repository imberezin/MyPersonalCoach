import type { ExperimentSelection } from "@/domain/experiments";
import { decideWordingGate, type WordingGate } from "@/domain/experiments/wording";
import type { LifecycleState } from "@/domain/firstWeek";
import type { FirstWeekProgress, FirstWeekStep } from "@/domain/firstWeekFlow";
import type { HomeDecision } from "@/domain/home";
import { LATE_EVENING, toDbStatus, type EarlySignalDecision, type Occurrence, type PatternRow, type PatternView } from "@/domain/patterns";
import { isQuiet, type QuietHours } from "@/domain/quietHours";
import { localDayOf, localMinuteOfDay, resolveTimeZone, zonedMidnightUtc } from "@/domain/time";
import {
  MILESTONE_MOMENT,
  WEIGHT_FLOW,
  addDaysToDayKey,
  parseDayKey,
  type MilestoneMoment,
  type MilestoneProgress,
  type TrendPoint,
  type WeightTrend,
} from "@/domain/weight";
import { formatClockInstant } from "./clockfile";

/**
 * `--explain`: what the app will decide for the demo user at the current clock, as plain lines. The collecting is in
 * db.ts (the app's own loaders); this file only turns the collected facts into text, so it is pure and testable.
 *
 * THE WORDING GATE IS EVALUATED WITH A FIXED ASSUMPTION, printed with it: the runner is a vitest process with
 * NODE_ENV=test, no AI keys (it reads no environment file on purpose) and no admin key, so the real AI runtime would read as
 * unconfigured and every row would say `ai_unconfigured`. The real gate in the running app depends on the dev server's own
 * environment and is observed through the manual checklist (B8 to B11). Nothing here reads real configuration.
 */

export const ASSUMED_AI = { configured: true, usedToday: 0 } as const;

/** The gate with the fixed assumption: AI configured, the allowance allowed with nothing used, and the given daily cap. */
export function assumedWordingGate(a: {
  view: PatternView;
  occurrences: number;
  distinctDays: number;
  availableDays: number;
  dailyCap: number;
}): WordingGate {
  return decideWordingGate({
    view: a.view,
    occurrences: a.occurrences,
    distinctDays: a.distinctDays,
    availableDays: a.availableDays,
    ai: { configured: ASSUMED_AI.configured, dailyCap: a.dailyCap, allowance: { allowed: true, usedToday: ASSUMED_AI.usedToday } },
  });
}

export interface ExcludedMeal {
  localDay: string;
  /** "HH:mm" local. */
  time: string;
  why: "aggregated" | "after_the_clock";
}

const pad = (n: number) => String(n).padStart(2, "0");
export const clockText = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/**
 * The meals that sit in the late-evening hours but are NOT evidence: an after-Shabbat report (its time is an estimate) and a
 * meal dated after the clock (not happened yet). Meals outside the late-evening hours are not listed at all.
 */
export function describeExcluded(
  meals: readonly { occurredAt: Date; aggregated: boolean }[],
  timeZone: string,
  now: Date,
): ExcludedMeal[] {
  const out: ExcludedMeal[] = [];
  for (const meal of meals) {
    const minute = localMinuteOfDay(meal.occurredAt, timeZone);
    if (minute < LATE_EVENING.startMinute || minute >= LATE_EVENING.endMinute) continue;
    const why = meal.aggregated ? "aggregated" : meal.occurredAt.getTime() > now.getTime() ? "after_the_clock" : null;
    if (why === null) continue;
    out.push({ localDay: localDayOf(meal.occurredAt, timeZone).key, time: clockText(minute), why });
  }
  return out.sort((a, b) => (a.localDay + a.time < b.localDay + b.time ? -1 : 1));
}

/** The previous weigh-in the "is that right?" check would compare with, or the start weight when there is none. */
export type ExplainReference = { kind: "previous"; kg: number } | { kind: "start"; kg: number } | { kind: "none" } | { kind: "unknown" };

/** What the weight item decides at the clock, collected with the app's own reads and domain functions (db.ts). */
export interface WeightExplain {
  /** Rows read (the newest 1500 at most). */
  entries: number;
  /** Rows dated after the clock: not happened yet, ignored by every rule. */
  afterClock: number;
  truncated: boolean;
  points: readonly TrendPoint[];
  trend: WeightTrend;
  progress: MilestoneProgress;
  /** What the Home loader decided (null = no card). */
  moment: MilestoneMoment | null;
  /** The week keys of the thanked landmarks. null = the read failed. */
  acknowledgedWeeks: readonly string[] | null;
  /** /report/weight is quiet at this instant (an offline period). null = unknown. */
  quiet: boolean | null;
  reference: ExplainReference;
}

export interface ExplainFacts {
  email: string;
  now: Date;
  /** The clock text as written in the file ("2026-09-16T09:00:00+03:00"), or null when the real clock is used. */
  clockFile: string | null;
  timeZone: string;
  lifecycle: LifecycleState | null;
  progress: FirstWeekProgress | null;
  step: FirstWeekStep | null;
  signal: { occurrences: readonly Occurrence[]; row: PatternRow | null; view: PatternView } | null;
  excluded: readonly ExcludedMeal[];
  /** pattern_evidence rows of the stored pattern. null = no pattern row or unknown. */
  storedEvidence: number | null;
  earlySignal: EarlySignalDecision | null;
  quietHours: QuietHours | null;
  home: HomeDecision;
  selection: ExperimentSelection | null;
  dailyCap: number;
  /** null = the weight series could not be read. */
  weight: WeightExplain | null;
}

function describeSelection(selection: ExperimentSelection | null): string {
  if (selection === null) return "unknown (the experiments could not be read)";
  switch (selection.kind) {
    case "NONE":
      return `NONE (${selection.reason})`;
    case "OFFER":
      return `OFFER ${selection.key} / ${selection.variantId}`;
    case "PENDING":
      return "PENDING (an offered experiment waits for the answer)";
    case "ACTIVE":
      return "ACTIVE (a started experiment)";
  }
}

function describeQuiet(quiet: QuietHours | null): string {
  if (quiet === null) return "unknown";
  return quiet.kind === "NONE" ? "none" : `${clockText(quiet.startMinute)}-${clockText(quiet.endMinute)}`;
}

/** Why the Early Signal card would NOT be on screen at this instant even though the data may call for it. */
function earlySignalBlockers(f: ExplainFacts, minute: number): string[] {
  const reasons: string[] = [];
  if (f.quietHours === null) reasons.push("the quiet hours are unknown (better silent than intrusive)");
  else if (isQuiet(f.quietHours, minute)) reasons.push(`quiet hours ${describeQuiet(f.quietHours)}`);
  if (minute >= LATE_EVENING.startMinute) reasons.push(`the signal's own hours (from ${clockText(LATE_EVENING.startMinute)}), so it never points at the evening during the evening`);
  if (f.home.state.key !== "EARLY_SIGNAL") reasons.push(`Home shows ${f.home.state.key} instead`);
  return reasons;
}

const kg = (n: number): string => n.toFixed(1);

/** The window of the Home card for a confirming week: from the local midnight of the week after it, for 14 calendar days. null for a key that is not a date. */
export function momentWindow(week: string, timeZone: string): { start: Date; end: Date } | null {
  const tz = resolveTimeZone(timeZone);
  const startKey = addDaysToDayKey(week, 7);
  const endKey = addDaysToDayKey(startKey, MILESTONE_MOMENT.windowDays);
  const from = parseDayKey(startKey);
  const to = parseDayKey(endKey);
  if (!from || !to) return null;
  return { start: zonedMidnightUtc(from.year, from.month, from.day, tz), end: zonedMidnightUtc(to.year, to.month, to.day, tz) };
}

/** The highest reached landmark after the start: the one the Home card is about. */
function highestReached(progress: MilestoneProgress) {
  if (progress.kind !== "LIST") return null;
  return [...progress.steps].reverse().find((s) => s.index >= 1 && s.state === "REACHED" && s.confirmedWeekStart !== null) ?? null;
}

/** Why the Home milestone card is NOT on screen at `now`, or null when nothing in the data hides it. */
export function milestoneHiddenReason(w: WeightExplain, timeZone: string, now: Date): string | null {
  if (!WEIGHT_FLOW.milestoneMomentEnabled) return "the milestone switch is off";
  if (w.progress.kind === "NONE") return "there is no numeric goal below the start weight";
  if (w.progress.kind === "UNKNOWN") return "the weight history is truncated, so no landmark can be claimed";
  const step = highestReached(w.progress);
  if (step === null || step.confirmedWeekStart === null) {
    return "no landmark is reached yet (it takes two completed weekly averages in a row at or below it; the current week does not count)";
  }
  const window = momentWindow(step.confirmedWeekStart, timeZone);
  if (window === null) return "the confirming week is not a date";
  if (now.getTime() < window.start.getTime()) return `outside the window: it opens ${formatClockInstant(window.start, timeZone)}`;
  if (now.getTime() >= window.end.getTime()) return `outside the window: it closed ${formatClockInstant(window.end, timeZone)}`;
  if (w.acknowledgedWeeks === null) return "the acknowledgements could not be read (unknown is silence)";
  if (w.acknowledgedWeeks.includes(step.confirmedWeekStart)) return "acknowledged (the person pressed Thanks for this week)";
  return w.moment === null ? "the app could not decide (a read failed)" : null;
}

function weightLines(f: ExplainFacts, w: WeightExplain): string[] {
  const lines: string[] = [];
  lines.push(`weights: ${w.entries} entries${w.truncated ? " (the newest 1500: truncated, so no landmark is claimed)" : ""}, ${w.afterClock} dated after the clock and ignored`);

  if (w.points.length === 0) {
    lines.push("weekly points: none");
  } else {
    lines.push(`weekly points: ${w.points.map((p) => `${p.weekStart}=${kg(p.averageKg)} ${p.complete ? "complete" : "partial"}`).join(", ")}`);
  }

  const t = w.trend;
  lines.push(
    `weight trend: ${t.state}, direction ${t.direction ?? "none"}, stale ${t.stale ? "yes" : "no"}, plateau ${t.plateau ? "yes" : "no"}, since the start ${
      t.sinceStart === null ? "none" : `${t.sinceStart.kind} ${kg(t.sinceStart.kg)} kg`
    }`,
  );

  if (w.progress.kind !== "LIST") {
    lines.push(w.progress.kind === "UNKNOWN" ? "landmarks: unknown (the history is truncated)" : "landmarks: none (no numeric goal below the start weight)");
  } else {
    const parts = w.progress.steps.map((s) => {
      if (s.state !== "REACHED") return `${s.kg} ${s.state === "NEXT" ? "next" : "ahead"}`;
      return s.reachedWeekStart === null ? `${s.kg} reached (the start)` : `${s.kg} reached (first week ${s.reachedWeekStart}, confirmed ${s.confirmedWeekStart})`;
    });
    lines.push(`landmarks: ${parts.join("; ")}${w.progress.goalReached ? "; the goal is reached" : ""}`);
  }

  const kind = w.moment === null ? "none" : w.moment.isGoal ? "goal" : "landmark";
  lines.push(`Home milestone: ${kind}${w.moment === null ? "" : ` (confirming week ${w.moment.week})`}`);
  const step = highestReached(w.progress);
  if (step !== null && step.confirmedWeekStart !== null) {
    const window = momentWindow(step.confirmedWeekStart, f.timeZone);
    if (window !== null) {
      const thanked = w.acknowledgedWeeks === null ? "unknown" : w.acknowledgedWeeks.includes(step.confirmedWeekStart) ? "yes" : "no";
      lines.push(`milestone window for the week ${step.confirmedWeekStart}: ${formatClockInstant(window.start, f.timeZone)} to ${formatClockInstant(window.end, f.timeZone)}; acknowledged ${thanked}`);
    }
  }
  if (w.moment === null) {
    const why = milestoneHiddenReason(w, f.timeZone, f.now);
    if (why !== null) lines.push(`milestone card hidden because: ${why}`);
  }

  lines.push(`/report/weight now: ${w.quiet === null ? "unknown (the offline periods could not be read)" : w.quiet ? "quiet (an offline period)" : "open"}`);
  const r = w.reference;
  lines.push(
    `double-check reference: ${
      r.kind === "previous"
        ? `${kg(r.kg)} kg (the previous weigh-in)`
        : r.kind === "start"
          ? `${kg(r.kg)} kg (the start weight; no earlier weigh-in)`
          : r.kind === "none"
            ? "none (it will not ask)"
            : "unknown (it will not ask)"
    }`,
  );
  return lines;
}

/** The decisions as lines. Never contains a secret: only the demo e-mail, counts, ISO instants and codes. */
export function formatExplain(f: ExplainFacts): string[] {
  const lines: string[] = [];
  const minute = localMinuteOfDay(f.now, f.timeZone);
  lines.push(`explain for ${f.email}`);
  lines.push(`dev clock: ${f.clockFile ?? "off (the real clock)"}; now is ${f.now.toISOString()}, ${clockText(minute)} local (${f.timeZone})`);
  lines.push(`lifecycle: ${f.lifecycle ?? "unknown"}`);

  if (f.progress === null) {
    lines.push("First Week: not read (the lifecycle is not FIRST_WEEK, or a read failed)");
  } else {
    lines.push(`available days: ${f.progress.availableDays}`);
    lines.push(`confirmed meals: ${f.progress.confirmedMeals} (the app counts at most 10)`);
    lines.push(
      `available days since the last meal: ${f.progress.availableDaysSinceLastMeal === null ? "no meal yet" : f.progress.availableDaysSinceLastMeal}`,
    );
  }
  lines.push(`First Week step: ${f.step === null ? "unknown" : f.step.kind === "SUMMARY_READY" ? `SUMMARY_READY (${f.step.reason}, hadEnoughData ${f.step.hadEnoughData})` : f.step.kind}`);

  if (f.signal === null) {
    lines.push("late evenings: unknown (the signal could not be read)");
  } else {
    const evenings = f.signal.occurrences.map((o) => `${o.localDay} ${clockText(localMinuteOfDay(o.occurredAt, f.timeZone))}`);
    lines.push(`late evenings: ${f.signal.occurrences.length}${evenings.length > 0 ? ` (${evenings.join(", ")})` : ""}`);
    lines.push(`live level: ${f.signal.view}`);
  }
  if (f.excluded.length === 0) {
    lines.push("late-evening meals not counted: none");
  } else {
    for (const e of f.excluded) {
      lines.push(
        `late-evening meal not counted: ${e.localDay} ${e.time}, ${e.why === "aggregated" ? "an after-Shabbat report (its time is an estimate)" : "dated after the clock"}`,
      );
    }
  }

  if (f.signal?.row) {
    const row = f.signal.row;
    const answer = row.feedback === null ? "no answer" : `answer ${row.feedback}${row.feedbackAt ? ` at ${row.feedbackAt.toISOString()}` : ""}`;
    lines.push(`stored pattern row: status ${row.status}, ${answer}, ${f.storedEvidence ?? "?"} evidence rows`);
    if (f.signal.view !== "REJECTED" && f.signal.view !== "NONE") {
      const expected = toDbStatus(f.signal.view);
      lines.push(row.status === expected ? "the stored status matches the live level" : `the stored status differs from the live level (stored ${row.status}, live ${f.signal.view}); Home reads the live level`);
    }
  } else {
    lines.push("stored pattern row: none");
  }

  if (f.earlySignal === null) {
    lines.push("Early Signal: unknown (no signal)");
  } else if (!f.earlySignal.due) {
    lines.push("Early Signal: not due");
  } else {
    lines.push(`Early Signal: due at level ${f.earlySignal.level}`);
    const blockers = earlySignalBlockers(f, minute);
    lines.push(blockers.length === 0 ? "Early Signal: it would be on screen now" : `Early Signal: it would not be on screen now: ${blockers.join("; ")}`);
  }
  lines.push(`quiet hours: ${describeQuiet(f.quietHours)}`);

  lines.push(`Home state: ${f.home.state.key}${"reason" in f.home.state ? ` (${f.home.state.reason})` : ""}; action ${f.home.action ? f.home.action.kind : "none"}; degraded ${f.home.degraded}`);
  lines.push(`experiment selection: ${describeSelection(f.selection)}`);

  lines.push(`wording gate evaluated assuming AI is configured, daily cap ${f.dailyCap}, nothing used yet`);
  if (f.signal === null || f.progress === null) {
    lines.push("wording gate: unknown (the signal or the First Week counts are not available)");
  } else {
    const gate = assumedWordingGate({
      view: f.signal.view,
      occurrences: f.signal.occurrences.length,
      distinctDays: new Set(f.signal.occurrences.map((o) => o.localDay)).size,
      availableDays: f.progress.availableDays,
      dailyCap: f.dailyCap,
    });
    lines.push(`wording gate: ${gate.open ? "OPEN" : `CLOSED (${gate.reason})`}`);
  }

  if (f.weight === null) lines.push("weights: unknown (the series could not be read)");
  else lines.push(...weightLines(f, f.weight));
  return lines;
}
