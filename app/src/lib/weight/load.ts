import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMilestones } from "@/domain/milestones";
import { resolveTimeZone } from "@/domain/time";
import {
  MILESTONE_MOMENT,
  WEIGHT_FLOW,
  buildWeightTrend,
  decideMilestoneMoment,
  milestoneProgress,
  parseDayKey,
  weeklyPoints,
  type MilestoneMoment,
  type MilestoneProgress,
  type WeightTrend,
} from "@/domain/weight";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadNoticed, type NoticedFacts } from "@/lib/progress/noticed";
import { loadWeightSeries } from "./repo";

/**
 * The composite reads of the weight item: the Progress screen and the Home milestone moment. Read as the signed-in
 * user (RLS applies, no admin client), never written, and never thrown: every read that fails is unknown, and unknown
 * is silence, never a guess and never a celebration.
 */

export type ProgressLoad =
  /** The context is not ready (signed out, Supabase down, no profile). */
  | { kind: "unavailable" }
  | {
      kind: "ready";
      /** unknown = the series read failed. */
      weight: { kind: "unknown" } | { kind: "ready"; trend: WeightTrend };
      /** UNKNOWN when the series failed or was truncated and a numeric goal exists. */
      milestones: MilestoneProgress;
      noticed: NoticedFacts;
    };

/**
 * Reads the series and `loadNoticed` in parallel. weeklyPoints(all) -> buildWeightTrend (sliced by the domain) and
 * milestoneProgress (all points, so a landmark reached long ago still shows as reached).
 */
export async function loadProgress(context: OnboardingContext, now: Date): Promise<ProgressLoad> {
  if (context.kind !== "ready") return { kind: "unavailable" };
  try {
    const { supabase, userId, row } = context;
    const timeZone = resolveTimeZone(row.timezone);
    const [series, noticed] = await Promise.all([loadWeightSeries(supabase, userId), loadNoticed(context, now)]);

    const landmarks = {
      startKg: row.start_weight_kg,
      goalKg: row.goal_weight_kg,
      goalType: row.goal_type,
    };

    if (series === null) {
      // No history to read: no "reached" can be claimed (UNKNOWN when there are landmarks, NONE otherwise).
      return { kind: "ready", weight: { kind: "unknown" }, milestones: milestoneProgress({ ...landmarks, weeklyPoints: [], complete: false }), noticed };
    }

    const points = weeklyPoints(series.entries, timeZone, now);
    const trend = buildWeightTrend({ points, baselineKg: row.start_weight_kg, timeZone, now });
    const milestones = milestoneProgress({ ...landmarks, weeklyPoints: points, complete: !series.truncated });
    return { kind: "ready", weight: { kind: "ready", trend }, milestones, noticed };
  } catch {
    // The loaders catch their own failures; this only guards a malformed context.
    console.error("Progress: loading the screen failed unexpectedly");
    return { kind: "unavailable" };
  }
}

/** The calendar-valid week keys of the `milestone_acknowledged` events, newest 50. null = the read failed. */
async function loadAcknowledgedWeeks(supabase: SupabaseClient, userId: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("payload")
      .eq("user_id", userId)
      .eq("name", MILESTONE_MOMENT.ackEvent)
      .order("occurred_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Progress: reading the acknowledged landmarks failed", error.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(data)) return null;

    const weeks = new Set<string>();
    for (const row of data) {
      const payload = typeof row === "object" && row !== null ? (row as { payload?: unknown }).payload : null;
      const week = typeof payload === "object" && payload !== null ? (payload as { week?: unknown }).week : null;
      // A malformed payload (no week, a string that is not a calendar day) acknowledges nothing.
      if (typeof week === "string" && parseDayKey(week) !== null) weeks.add(week);
    }
    return weeks;
  } catch {
    console.error("Progress: reading the acknowledged landmarks threw");
    return null;
  }
}

/**
 * Home. Never throws; null = no moment OR unknown. The switch off, a non-ready context, or no landmarks (the goal is
 * not numeric, or not below the start weight) is null with ZERO queries. Otherwise one query (the series); a second
 * (the acknowledged weeks) only when the domain finds a candidate. A failed or truncated series, and a failed read of
 * the acknowledgements, are silence: an unknown read must never put a celebration on the screen.
 */
export async function loadMilestoneMoment(context: OnboardingContext, now: Date): Promise<MilestoneMoment | null> {
  if (!WEIGHT_FLOW.milestoneMomentEnabled || context.kind !== "ready") return null;
  try {
    const { supabase, userId, row } = context;
    if (row.goal_type !== "numeric" || row.start_weight_kg === null || row.goal_weight_kg === null) return null;
    if (computeMilestones(row.start_weight_kg, row.goal_weight_kg).length === 0) return null;

    const series = await loadWeightSeries(supabase, userId);
    if (series === null || series.truncated) return null;

    const timeZone = resolveTimeZone(row.timezone);
    const progress = milestoneProgress({
      startKg: row.start_weight_kg,
      goalKg: row.goal_weight_kg,
      goalType: row.goal_type,
      weeklyPoints: weeklyPoints(series.entries, timeZone, now),
      complete: true,
    });

    // Is there a candidate at all? Only then is the second read worth its cost.
    if (decideMilestoneMoment({ progress, now, timeZone, acknowledged: new Set() }) === null) return null;
    const acknowledged = await loadAcknowledgedWeeks(supabase, userId);
    if (acknowledged === null) return null;
    return decideMilestoneMoment({ progress, now, timeZone, acknowledged });
  } catch {
    console.error("Progress: finding the milestone moment failed unexpectedly");
    return null;
  }
}
