import type { ExperimentSelection } from "@/domain/experiments";
import { decideWordingGate, type WordingGate } from "@/domain/experiments/wording";
import type { LifecycleState } from "@/domain/firstWeek";
import type { FirstWeekProgress, FirstWeekStep } from "@/domain/firstWeekFlow";
import type { HomeDecision } from "@/domain/home";
import { LATE_EVENING, toDbStatus, type EarlySignalDecision, type Occurrence, type PatternRow, type PatternView } from "@/domain/patterns";
import { isQuiet, type QuietHours } from "@/domain/quietHours";
import { localDayOf, localMinuteOfDay } from "@/domain/time";

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
  return lines;
}
