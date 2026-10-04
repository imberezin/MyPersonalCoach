import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESULT_TO_DB, type ExperimentResult } from "@/domain/weekly";
import type { WeeklyRepoResult } from "./open";

/**
 * The person's answer to the result question: ONE conditional UPDATE of their single ACTIVE experiment, as the signed-in
 * user (RLS applies, no admin client). The database allows at most one open row per person, so "the ACTIVE row" needs no id
 * from the form. 1 row -> `changed: true` with the experiment's key and the source of its wording (for the event); 0 rows
 * -> `changed: false` (already answered, skipped or gone: not an error, and the caller emits nothing). Error or throw ->
 * `{ ok: false }`, with only a Postgres code in the log.
 *
 * The patch comes from RESULT_TO_DB: "I did not get to try" stores `tried = NO` and `helpfulness = null` (not applicable),
 * never UNKNOWN. `ended_at` is written EXPLICITLY from the action's instant (the database default is the real clock).
 */
export async function recordExperimentResult(
  supabase: SupabaseClient,
  userId: string,
  a: { result: ExperimentResult; now: Date },
): Promise<WeeklyRepoResult<{ changed: boolean; key: string | null; source: "ai" | "library" | null }>> {
  try {
    const { tried, helpfulness } = RESULT_TO_DB[a.result];
    const { data, error } = await supabase
      .from("experiments")
      .update({ status: "DONE", ended_at: a.now.toISOString(), tried, helpfulness })
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .select("intervention_key, wording_source");
    if (error) {
      console.error("Weekly: saving the experiment result failed", error.code ?? "no_code");
      return { ok: false };
    }
    if (!Array.isArray(data)) return { ok: false };
    if (data.length === 0) return { ok: true, value: { changed: false, key: null, source: null } };

    const row = data[0] as { intervention_key?: unknown; wording_source?: unknown } | null;
    const key = typeof row?.intervention_key === "string" ? row.intervention_key : null;
    const source = row?.wording_source === "ai" || row?.wording_source === "library" ? row.wording_source : null;
    return { ok: true, value: { changed: true, key, source } };
  } catch {
    console.error("Weekly: saving the experiment result threw");
    return { ok: false };
  }
}
