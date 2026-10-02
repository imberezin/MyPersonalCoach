import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CompleteResult = { ok: true; transitioned: boolean } | { ok: false };

/**
 * THE only writer of the First Week transition, and the only irreversible step of the item: FIRST_WEEK to
 * WEEKLY_CYCLE with the moment it happened. ONE conditional update (`lifecycle_state = 'FIRST_WEEK'`), so a second
 * tap, a second tab or a retry matches 0 rows and is reported as "already done" (`transitioned: false`), and the
 * caller emits the analytics event only when this call changed the row.
 *
 * Takes any client: the signed-in user's today (RLS applies); a future tick job could pass another. Uses no rpc and
 * never throws: an error or a throw is { ok: false }.
 */
export async function completeFirstWeek(supabase: SupabaseClient, userId: string, now: Date): Promise<CompleteResult> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ lifecycle_state: "WEEKLY_CYCLE", first_week_ended_at: now.toISOString() })
      .eq("user_id", userId)
      .eq("lifecycle_state", "FIRST_WEEK")
      .select("user_id");
    if (error || !Array.isArray(data)) {
      console.error("First Week: the transition failed", error?.code ?? "no_code");
      return { ok: false };
    }
    return { ok: true, transitioned: data.length > 0 };
  } catch {
    console.error("First Week: the transition threw");
    return { ok: false };
  }
}
