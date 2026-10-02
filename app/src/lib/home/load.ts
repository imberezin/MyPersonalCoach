import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_SNOOZED } from "@/domain/firstWeekFlow";
import { homePeriodsWindow, resolveTimeZone, type HomeFacts } from "@/domain/home";
import type { OfflinePeriod } from "@/domain/offline";
import { PATTERN_FLOW, decideEarlySignal } from "@/domain/patterns";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import { loadFirstWeekProgress, loadFirstWeekSnooze } from "@/lib/firstWeek/load";
import { parseOfflinePeriodRows } from "@/lib/offline/rows";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadLateEveningSignal, loadQuietHours } from "@/lib/patterns/load";
import { loadMilestoneMoment } from "@/lib/weight/load";

/**
 * The tables whose rows are CONFIRMED reports; any row in any of them means the user has reported.
 * meal_raw_inputs and meal_understandings are unconfirmed and never count.
 */
export const REPORT_TABLES = ["meal_entries", "weight_entries", "activity_entries", "sleep_entries", "stress_entries"] as const;

/** Only a handful of periods can overlap the window; the cap just guards against runaway data. */
const OFFLINE_ROW_LIMIT = 20;

/**
 * What Home needs to know, read as the signed-in user (RLS applies, no admin client). Never throws:
 * every fact that cannot be read is `null` (unknown) and Home still renders from the clock.
 * Not ready (signed out, Supabase down, no profile) means no queries at all.
 * `facts.timeZone` is ALWAYS a valid IANA zone.
 */
export async function loadHomeFacts(context: OnboardingContext, now: Date = new Date()): Promise<HomeFacts> {
  const nothingKnown: HomeFacts = {
    now,
    timeZone: DEFAULT_TIME_ZONE,
    offlinePeriods: null,
    hasAnyReport: null,
    lifecycle: null,
    firstWeek: null,
    firstWeekSnoozed: { ...NOT_SNOOZED },
    earlySignal: null,
    quietHours: null,
    milestone: null,
  };
  if (context.kind !== "ready") return nothingKnown;

  try {
    const { supabase, userId } = context;
    const timeZone = resolveTimeZone(context.row.timezone);
    const lifecycle = context.row.lifecycle_state;
    // Every First Week read is FIRST_WEEK only: a WEEKLY_CYCLE Home pays for none of them, and none of their
    // failures touches the two facts Home has always needed (they are independent loaders that never throw).
    const inFirstWeek = lifecycle === "FIRST_WEEK";

    const [offlinePeriods, hasAnyReport, firstWeek, firstWeekSnoozed, signal, milestone] = await Promise.all([
      loadOfflinePeriods(supabase, userId, now),
      loadHasAnyReport(supabase, userId),
      inFirstWeek ? loadFirstWeekProgress(supabase, userId, timeZone, now) : Promise.resolve(null),
      // Never null: a failed read is "not snoozed" (a card coming back is calm; a card hidden by a failed read would be invisible).
      inFirstWeek ? loadFirstWeekSnooze(supabase, userId, now) : Promise.resolve({ ...NOT_SNOOZED }),
      // Phase 2: the live meals and the pattern row. null = unknown, and then there is simply no card.
      inFirstWeek && PATTERN_FLOW.earlySignalEnabled ? loadLateEveningSignal(supabase, userId, timeZone, now) : Promise.resolve(null),
      // The weight series, read only for a person with a numeric goal below the start weight (zero queries otherwise).
      // null = no moment or unknown, and unknown is silence: it never changes any other fact.
      loadMilestoneMoment(context, now),
    ]);

    // The data-level decision (pure); the resolver adds only the time-of-day rules.
    const earlySignal = signal === null ? null : decideEarlySignal({ view: signal.view, row: signal.row, now });
    // A second stage that runs only when a card is otherwise due: better silent than intrusive when unknown.
    const quietHours = earlySignal?.due ? await loadQuietHours(supabase, userId) : null;

    return {
      now,
      timeZone,
      offlinePeriods,
      hasAnyReport,
      lifecycle,
      firstWeek,
      firstWeekSnoozed,
      earlySignal,
      quietHours,
      milestone,
    };
  } catch {
    // The loaders catch their own failures; this only guards a malformed context.
    console.error("Home: loading the facts failed unexpectedly");
    return nothingKnown;
  }
}

/**
 * The offline periods that overlap homePeriodsWindow(now), oldest first, any type. `null` when the
 * query fails (Shabbat is then unknown, which is not the same as "there is none").
 */
export async function loadOfflinePeriods(supabase: SupabaseClient, userId: string, now: Date): Promise<OfflinePeriod[] | null> {
  try {
    const { from, to } = homePeriodsWindow(now);
    // Formatted first: an invalid instant throws here, before any query is built.
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    // "Overlaps the window", not "starts near now": a multi-day period that began long ago must still be found.
    const { data, error } = await supabase
      .from("offline_periods")
      .select("type, start_at, end_at")
      .eq("user_id", userId)
      .gt("end_at", fromIso)
      .lte("start_at", toIso)
      .order("start_at", { ascending: true })
      .limit(OFFLINE_ROW_LIMIT);
    if (error) {
      console.error("Home: loading the offline periods failed", error.code);
      return null;
    }
    return Array.isArray(data) ? parseOfflinePeriodRows(data) : null;
  } catch {
    console.error("Home: loading the offline periods threw");
    return null;
  }
}

/** true: a row was found. false: every table answered and all are empty. null: unknown. */
async function probeTable(supabase: SupabaseClient, table: string, userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from(table).select("id").eq("user_id", userId).limit(1);
    if (error) {
      console.error(`Home: checking ${table} for reports failed`, error.code);
      return null;
    }
    return Array.isArray(data) ? data.length > 0 : null;
  } catch {
    console.error(`Home: checking ${table} for reports threw`);
    return null;
  }
}

/**
 * Whether ANY confirmed report exists: one cheap `limit 1` probe per table, all in parallel.
 * A row anywhere is a yes even when another probe failed; "no" needs all five to answer with zero
 * rows; otherwise `null` (unknown).
 */
export async function loadHasAnyReport(supabase: SupabaseClient, userId: string): Promise<boolean | null> {
  const answers = await Promise.all(REPORT_TABLES.map((table) => probeTable(supabase, table, userId)));
  if (answers.includes(true)) return true;
  return answers.every((answer) => answer === false) ? false : null;
}
