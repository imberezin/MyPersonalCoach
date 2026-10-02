import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatternFeedback } from "@/domain/patterns";

/**
 * The person's answer to the Early Signal card. ONE conditional UPDATE: it sets `user_feedback` and
 * `user_feedback_at` (the cooldown clock), plus `status = 'REJECTED'` for "reject", and only on a row that is not
 * already REJECTED (the person's "not related" is final). 0 rows (no such row, or already rejected) is { ok: false }.
 * The sync never touches these columns, so it can never erase an answer. Runs as the signed-in user (RLS); never throws.
 */
export async function recordPatternFeedback(
  supabase: SupabaseClient,
  a: { patternId: string; feedback: PatternFeedback; now: Date },
): Promise<{ ok: boolean }> {
  try {
    const patch: Record<string, string> = { user_feedback: a.feedback, user_feedback_at: a.now.toISOString() };
    if (a.feedback === "reject") patch.status = "REJECTED";
    const { data, error } = await supabase
      .from("patterns")
      .update(patch)
      .eq("id", a.patternId)
      .neq("status", "REJECTED")
      .select("id");
    if (error) {
      console.error("Patterns: recording the answer failed", error.code ?? "no_code");
      return { ok: false };
    }
    return { ok: Array.isArray(data) && data.length > 0 };
  } catch {
    console.error("Patterns: recording the answer threw");
    return { ok: false };
  }
}
