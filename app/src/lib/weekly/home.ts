import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WEEKLY_FLOW,
  WEEKLY_LIMITS,
  WEEKLY_SNOOZE,
  WEEKLY_TIMING,
  activeWeeklySnooze,
  decideWeeklyMoment,
  weeklyCardPrecheck,
  type WeeklyHomeFact,
} from "@/domain/weekly";
import { DAY_MS, resolveTimeZone } from "@/domain/time";
import { parseOfflinePeriodRows } from "@/lib/offline/rows";

/**
 * What Home needs for the weekly card, read as the signed-in user (RLS applies, no admin client). Nothing here writes and
 * nothing calls the AI. Never throws: any error, throw, truncated read or malformed answer is `null` (unknown = no card;
 * Home stays calm and its `degraded` note is not set).
 */

const HOUR_MS = 3_600_000;

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** true: a row was found. false: the table answered with no rows. null: unknown. */
function found(result: { data: unknown; error: { code?: string } | null }, what: string): boolean | null {
  if (result.error) {
    console.error(`Weekly: ${what} failed`, result.error.code ?? "no_code");
    return null;
  }
  return Array.isArray(result.data) ? result.data.length > 0 : null;
}

/**
 * The weekly card fact, in the stages 6.2 describes:
 *  0. pure: weeklyCardPrecheck says whether the CARD window (Sunday 05:00 to Wednesday 05:00) is open; if not, null with
 *     ZERO queries (Wednesday to Saturday a WEEKLY_CYCLE Home pays nothing).
 *  1. four parallel reads: the transition stamp, the offline periods, whether the week was opened, the snooze events.
 *  2. pure: decideWeeklyMoment must say READY with the card visible. An opened or snoozed week is `{ weekStart, card: false }`
 *     (the card is gone, the quiet link stays) with no further reads.
 *  3. only for an untouched card, two `limit 1` probes: a confirmed non-aggregated meal, or a weigh-in, from the WINDOW start
 *     (a weigh-in made before the "Let's continue" press already belongs to the First Week summary). Neither is silence:
 *     a week with no report at all is met with no card, not with a "quiet week" card.
 * The caller reads this only for the WEEKLY_CYCLE lifecycle.
 */
export async function loadWeeklyHomeFact(
  supabase: SupabaseClient,
  userId: string,
  a: { timeZone: string; now: Date },
): Promise<WeeklyHomeFact | null> {
  try {
    if (!WEEKLY_FLOW.enabled) return null;
    const timeZone = resolveTimeZone(a.timeZone);
    const { now } = a;
    const precheck = weeklyCardPrecheck({ now, timeZone, aggregatedReportConfirmedAt: null });
    if (precheck === null) return null;
    const { week } = precheck;

    const periodsFrom = new Date(week.start.getTime() - WEEKLY_LIMITS.periodsLookbackDays * DAY_MS).toISOString();
    const since = new Date(now.getTime() - WEEKLY_TIMING.snoozeHours * HOUR_MS).toISOString();
    const [profile, periods, opened, snooze] = await Promise.all([
      supabase.from("profiles").select("first_week_ended_at").eq("user_id", userId).limit(1),
      supabase
        .from("offline_periods")
        .select("type, start_at, end_at")
        .eq("user_id", userId)
        .gt("end_at", periodsFrom)
        .lte("start_at", week.end.toISOString())
        .order("start_at", { ascending: true })
        .limit(WEEKLY_LIMITS.periods),
      supabase.from("weekly_summaries").select("id").eq("user_id", userId).eq("week_start", week.weekStart).limit(1),
      supabase
        .from("events")
        .select("payload, occurred_at")
        .eq("user_id", userId)
        .eq("name", WEEKLY_SNOOZE.event)
        .gt("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(WEEKLY_LIMITS.snooze),
    ]);
    if (profile.error || periods.error || opened.error || snooze.error) {
      console.error("Weekly: loading the Home card facts failed", profile.error?.code ?? periods.error?.code ?? opened.error?.code ?? snooze.error?.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(profile.data) || !Array.isArray(periods.data) || !Array.isArray(opened.data) || !Array.isArray(snooze.data)) return null;
    // Exactly the limit back means more may exist: unknown beats a count of available days that could be wrong.
    if (periods.data.length >= WEEKLY_LIMITS.periods) return null;

    const moment = decideWeeklyMoment({
      now,
      timeZone,
      lifecycle: "WEEKLY_CYCLE",
      firstWeekEndedAt: toDate((profile.data[0] as Record<string, unknown> | undefined)?.first_week_ended_at),
      periods: parseOfflinePeriodRows(periods.data),
      aggregatedReportConfirmedAt: null,
    });
    if (moment.kind !== "READY" || !moment.cardVisible || moment.week.weekStart !== week.weekStart) return null;

    const events: { week: unknown; occurredAt: Date }[] = [];
    for (const row of snooze.data) {
      if (typeof row !== "object" || row === null) continue;
      const { payload, occurred_at } = row as Record<string, unknown>;
      const occurredAt = toDate(occurred_at);
      if (occurredAt === null) continue;
      events.push({ week: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).week : undefined, occurredAt });
    }
    // The card is gone; the quiet link stays. No probes: an opened or snoozed card had activity when it was shown.
    if (opened.data.length > 0 || activeWeeklySnooze({ events, weekStart: week.weekStart, now })) {
      return { weekStart: week.weekStart, card: false };
    }

    const [mealProbe, weightProbe] = await Promise.all([
      supabase
        .from("meal_entries")
        .select("id")
        .eq("user_id", userId)
        .eq("aggregated", false)
        .gte("occurred_at", moment.window.start.toISOString())
        .lt("occurred_at", week.end.toISOString())
        .limit(1),
      supabase
        .from("weight_entries")
        .select("id")
        .eq("user_id", userId)
        .gte("measured_at", moment.window.start.toISOString())
        .lt("measured_at", week.end.toISOString())
        .limit(1),
    ]);
    const hasMeal = found(mealProbe, "checking the week's meals");
    const hasWeight = found(weightProbe, "checking the week's weigh-ins");
    if (hasMeal === null || hasWeight === null) return null;
    return hasMeal || hasWeight ? { weekStart: week.weekStart, card: true } : null;
  } catch {
    console.error("Weekly: loading the Home card facts threw");
    return null;
  }
}
