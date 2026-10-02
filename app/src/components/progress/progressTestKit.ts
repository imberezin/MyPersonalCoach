// Imported by the Progress tests only. It builds a Progress load the way the real loader does, through the real domain
// functions, so the screens are tested on what the domain really says (a state, a direction, a landmark) and not on a
// hand-written object that could drift from it.
import {
  buildWeightTrend,
  milestoneProgress,
  weeklyPoints,
  type MilestoneProgress,
  type WeightEntry,
  type WeightTrend,
} from "@/domain/weight";
import type { OpenExperiment } from "@/lib/experiments/repo";
import type { NoticedFacts } from "@/lib/progress/noticed";
import type { ProgressLoad } from "@/lib/weight/load";

export const ZONE = "Asia/Jerusalem";
/** A Wednesday morning in Jerusalem. The week of `now` started on Sunday 2026-11-01, so the weeks before it are complete. */
export const NOW = new Date("2026-11-04T09:00:00+02:00");
const FIRST_COMPLETE_WEEK_START = Date.UTC(2026, 9, 25); // Sunday 2026-10-25: the newest complete week
const WEEK_MS = 7 * 86_400_000;

export type ReadyLoad = Extract<ProgressLoad, { kind: "ready" }>;

const NOTHING: NoticedFacts = { patterns: [], activeExperiment: null };

/**
 * One entry per week on a Tuesday at noon. `kgs` is oldest first and ends `endWeeksAgo` complete weeks before the newest
 * complete week (0 = the week that just ended). `unfinished` adds an entry in the week that contains `now`.
 */
export function weeklyEntries(kgs: readonly number[], opts: { endWeeksAgo?: number; unfinished?: number } = {}): WeightEntry[] {
  const newest = FIRST_COMPLETE_WEEK_START - (opts.endWeeksAgo ?? 0) * WEEK_MS;
  const entries = kgs.map((weightKg, index) => ({
    id: `w${index}`,
    weightKg,
    // Tuesday noon UTC of that week: Tuesday noon in Jerusalem too, and never near a week boundary.
    measuredAt: new Date(newest - (kgs.length - 1 - index) * WEEK_MS + 2 * 86_400_000 + 12 * 3_600_000),
  }));
  if (opts.unfinished !== undefined) {
    entries.push({ id: "now", weightKg: opts.unfinished, measuredAt: new Date(Date.UTC(2026, 10, 3, 10)) });
  }
  return entries;
}

export function buildTrend(entries: readonly WeightEntry[], baselineKg: number | null, now: Date = NOW): WeightTrend {
  return buildWeightTrend({ points: weeklyPoints(entries, ZONE, now), baselineKg, timeZone: ZONE, now });
}

export function buildMilestones(
  entries: readonly WeightEntry[],
  a: { startKg: number | null; goalKg: number | null; complete?: boolean },
  now: Date = NOW,
): MilestoneProgress {
  return milestoneProgress({
    startKg: a.startKg,
    goalKg: a.goalKg,
    goalType: a.goalKg === null ? "none" : "numeric",
    weeklyPoints: weeklyPoints(entries, ZONE, now),
    complete: a.complete ?? true,
  });
}

/** A ready Progress load from weekly numbers, a start weight and a goal. */
export function loadFor(a: {
  kgs: readonly number[];
  startKg?: number | null;
  goalKg?: number | null;
  endWeeksAgo?: number;
  unfinished?: number;
  noticed?: NoticedFacts;
}): ReadyLoad {
  const startKg = a.startKg === undefined ? 80 : a.startKg;
  const goalKg = a.goalKg === undefined ? 70 : a.goalKg;
  const entries = weeklyEntries(a.kgs, { endWeeksAgo: a.endWeeksAgo, unfinished: a.unfinished });
  return {
    kind: "ready",
    weight: { kind: "ready", trend: buildTrend(entries, startKg) },
    milestones: buildMilestones(entries, { startKg, goalKg }),
    noticed: a.noticed ?? NOTHING,
  };
}

export const OPEN_EXPERIMENT: OpenExperiment = {
  id: "exp-1",
  status: "ACTIVE",
  key: "eat_intentionally",
  variantId: "default",
  wording: "the stored sentence",
  source: "library",
  locale: "he",
};
