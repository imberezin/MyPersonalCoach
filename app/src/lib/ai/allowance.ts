import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTimeZone } from "@/domain/home";
import { localDayOf } from "@/domain/time";

export type AiAllowance =
  | { allowed: true; usedToday: number }
  | { allowed: false; reason: "daily_cap" | "rate_limited" | "ledger_unavailable" };

/** The ledger operations that count against the caps (the meal calls and the experiment wording: one free-tier budget). */
const COUNTED_OPERATIONS = ["analyzeMeal", "analyzeText", "wordExperiment"];

const MINUTE_MS = 60_000;

/**
 * Whether this user may make another AI call now. It runs as the USER (row level security lets
 * the owner SELECT their own `ai_requests` rows) and counts provider attempts: since the user's
 * LOCAL midnight, and in the last 60 seconds. Fail closed: if the ledger cannot be read the answer
 * is "not allowed", which protects the free quotas and sends the user to the manual path.
 *
 * Known approximation: concurrent requests can overshoot a cap by a few calls (check, then write).
 */
export async function checkAiAllowance(
  supabase: SupabaseClient,
  a: { now: Date; timeZone: string; dailyCap: number; perMinuteCap: number },
): Promise<AiAllowance> {
  try {
    const dayStart = localDayOf(a.now, resolveTimeZone(a.timeZone)).start;
    const minuteStart = new Date(a.now.getTime() - MINUTE_MS);

    const countSince = (since: Date) =>
      supabase
        .from("ai_requests")
        .select("id", { count: "exact", head: true })
        .in("operation", COUNTED_OPERATIONS)
        .gte("created_at", since.toISOString());

    const [day, minute] = await Promise.all([countSince(dayStart), countSince(minuteStart)]);
    if (day.error || minute.error || typeof day.count !== "number" || typeof minute.count !== "number") {
      return { allowed: false, reason: "ledger_unavailable" };
    }

    if (day.count >= a.dailyCap) return { allowed: false, reason: "daily_cap" };
    if (minute.count >= a.perMinuteCap) return { allowed: false, reason: "rate_limited" };
    return { allowed: true, usedToday: day.count };
  } catch {
    return { allowed: false, reason: "ledger_unavailable" };
  }
}
