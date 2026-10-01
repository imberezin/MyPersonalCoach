import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { homePeriodsWindow, resolveTimeZone, type HomeFacts } from "@/domain/home";
import type { OfflinePeriod, OfflineType } from "@/domain/offline";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import type { OnboardingContext } from "@/lib/onboarding/context";

/**
 * The tables whose rows are CONFIRMED reports; any row in any of them means the user has reported.
 * meal_raw_inputs and meal_understandings are unconfirmed and never count.
 */
export const REPORT_TABLES = ["meal_entries", "weight_entries", "activity_entries", "sleep_entries", "stress_entries"] as const;

/** Only a handful of periods can overlap the window; the cap just guards against runaway data. */
const OFFLINE_ROW_LIMIT = 20;

// A Record, so a new OfflineType is a compile error here until it is listed.
const KNOWN_OFFLINE_TYPES: Record<OfflineType, true> = { SHABBAT: true, HOLIDAY: true, USER_DEFINED: true, VACATION: true };

const isOfflineType = (v: unknown): v is OfflineType => typeof v === "string" && Object.hasOwn(KNOWN_OFFLINE_TYPES, v);

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Rows with an unknown type or an unreadable date are dropped, not guessed. */
function toPeriods(rows: unknown[]): OfflinePeriod[] {
  const periods: OfflinePeriod[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { type, start_at, end_at } = row as Record<string, unknown>;
    const start = toDate(start_at);
    const end = toDate(end_at);
    if (isOfflineType(type) && start && end) periods.push({ type, start, end });
  }
  return periods;
}

/**
 * What Home needs to know, read as the signed-in user (RLS applies, no admin client). Never throws:
 * every fact that cannot be read is `null` (unknown) and Home still renders from the clock.
 * Not ready (signed out, Supabase down, no profile) means no queries at all.
 * `facts.timeZone` is ALWAYS a valid IANA zone.
 */
export async function loadHomeFacts(context: OnboardingContext, now: Date = new Date()): Promise<HomeFacts> {
  const nothingKnown: HomeFacts = { now, timeZone: DEFAULT_TIME_ZONE, offlinePeriods: null, hasAnyReport: null };
  if (context.kind !== "ready") return nothingKnown;

  try {
    const [offlinePeriods, hasAnyReport] = await Promise.all([
      loadOfflinePeriods(context.supabase, context.userId, now),
      loadHasAnyReport(context.supabase, context.userId),
    ]);
    return { now, timeZone: resolveTimeZone(context.row.timezone), offlinePeriods, hasAnyReport };
  } catch {
    // The two loaders catch their own failures; this only guards a malformed context.
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
    return Array.isArray(data) ? toPeriods(data) : null;
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
