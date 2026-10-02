import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LATE_EVENING,
  PATTERN_FLOW,
  detectLateEvening,
  effectivePatternStatus,
  type MealStamp,
  type Occurrence,
  type PatternFeedback,
  type PatternRow,
  type PatternView,
} from "@/domain/patterns";
import { parseQuietHours, type QuietHours } from "@/domain/quietHours";
import { DAY_MS, resolveTimeZone } from "@/domain/time";

/**
 * The live late-evening signal and the person's own pattern row. Read as the signed-in user (RLS applies, no admin
 * client) and never written here: Home, the B6 page, the B5 page and every Server Action ask this one loader, so
 * there is no second implementation of "is there a signal". Nothing in it reads a stored status except the
 * person's own "not related" (see effectivePatternStatus).
 */
export interface LateEveningSignal {
  occurrences: Occurrence[];
  row: PatternRow | null;
  view: PatternView;
}

const ROW_STATUSES: readonly PatternRow["status"][] = ["OBSERVATION", "CANDIDATE", "VALIDATED", "REJECTED"];
const FEEDBACKS: readonly PatternFeedback[] = ["confirm", "unsure", "reject"];

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Rows with no id or an unreadable time are dropped, not guessed. */
function toStamps(rows: unknown[]): MealStamp[] {
  const stamps: MealStamp[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { id, occurred_at } = row as Record<string, unknown>;
    const occurredAt = toDate(occurred_at);
    if (typeof id === "string" && id !== "" && occurredAt) stamps.push({ id, occurredAt });
  }
  return stamps;
}

/**
 * The person's row, or `undefined` when it exists but cannot be read safely: the person's own answer must never be
 * guessed (a "not related" lost to a malformed row would bring the card back), so the caller treats it as unknown.
 */
function toPatternRow(row: unknown): PatternRow | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const { id, status, user_feedback, user_feedback_at } = row as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return undefined;
  if (!ROW_STATUSES.some((s) => s === status)) return undefined;
  const feedback = user_feedback === null ? null : (FEEDBACKS.find((f) => f === user_feedback) ?? undefined);
  if (feedback === undefined) return undefined;
  const feedbackAt = user_feedback_at === null ? null : toDate(user_feedback_at);
  if (user_feedback_at !== null && feedbackAt === null) return undefined;
  return { id, status: status as PatternRow["status"], feedback, feedbackAt };
}

/**
 * Reads the meal stamps (aggregated meals excluded: their time is an estimate; the last 30 days; at most 400) and the
 * pattern row in parallel, then runs the pure detector and the live level. Never throws: any error, a throw, a row it
 * cannot read, or exactly `LATE_EVENING.maxMeals` rows back (truncated) is `null` = unknown, and unknown means no card
 * and no offer, never a guess. `PATTERN_FLOW.detectionEnabled` false is `null` with no query at all.
 */
export async function loadLateEveningSignal(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  asOf: Date,
): Promise<LateEveningSignal | null> {
  if (!PATTERN_FLOW.detectionEnabled) return null;
  try {
    const zone = resolveTimeZone(timeZone);
    // Formatted first: an invalid instant throws here, before any query is built.
    const fromIso = new Date(asOf.getTime() - LATE_EVENING.lookbackDays * DAY_MS).toISOString();
    const toIso = asOf.toISOString();

    const [meals, patterns] = await Promise.all([
      supabase
        .from("meal_entries")
        .select("id, occurred_at")
        .eq("user_id", userId)
        .eq("aggregated", false)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso)
        .order("occurred_at", { ascending: false })
        .limit(LATE_EVENING.maxMeals),
      supabase
        .from("patterns")
        .select("id, status, user_feedback, user_feedback_at")
        .eq("user_id", userId)
        .eq("kind", LATE_EVENING.kind)
        .limit(1),
    ]);
    if (meals.error || patterns.error) {
      console.error("Patterns: loading the late-evening signal failed", meals.error?.code ?? patterns.error?.code);
      return null;
    }
    if (!Array.isArray(meals.data) || !Array.isArray(patterns.data)) return null;
    if (meals.data.length >= LATE_EVENING.maxMeals) return null;

    let row: PatternRow | null = null;
    if (patterns.data.length > 0) {
      const parsed = toPatternRow(patterns.data[0]);
      if (parsed === undefined) return null;
      row = parsed;
    }

    const occurrences = detectLateEvening({ meals: toStamps(meals.data), timeZone: zone, asOf });
    const view = effectivePatternStatus({ occurrences: occurrences.map((o) => o.occurredAt), timeZone: zone, row });
    return { occurrences, row, view };
  } catch {
    console.error("Patterns: loading the late-evening signal threw");
    return null;
  }
}

/**
 * The person's quiet hours (two `time` columns). null = unknown: a failed read, no preferences row, or only one of
 * the two set. Both null is { kind: "NONE" } (the person turned quiet hours off). Never throws.
 */
export async function loadQuietHours(supabase: SupabaseClient, userId: string): Promise<QuietHours | null> {
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("quiet_hours_start, quiet_hours_end")
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      console.error("Patterns: loading the quiet hours failed", error.code);
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    const row = data[0];
    if (typeof row !== "object" || row === null) return null;
    const { quiet_hours_start, quiet_hours_end } = row as Record<string, unknown>;
    return parseQuietHours(quiet_hours_start, quiet_hours_end);
  } catch {
    console.error("Patterns: loading the quiet hours threw");
    return null;
  }
}
