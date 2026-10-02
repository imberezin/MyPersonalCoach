import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LATE_EVENING, toDbStatus, type Occurrence, type PatternView } from "@/domain/patterns";

export type SyncResult = { ok: true; patternId: string } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE ONLY caller of the `sync_pattern_evidence` SQL function, which is the only evidence writer: it makes the
 * stored mirror (`patterns` + `pattern_evidence`) equal the live occurrences, atomically (migration 20261001170000).
 * A source scan in sync.test.ts pins that no other file names the function.
 *
 * It creates the pattern row if missing, so it is called only after an explicit press (a B4 answer, "Let's choose
 * together") or by the end-of-action refresh once the row already exists. REJECTED is never written here and a
 * REJECTED row is left alone by the function. Never throws: an error, a throw or an answer that is not a uuid is
 * { ok: false }.
 */
export async function syncPatternEvidence(
  supabase: SupabaseClient,
  a: { occurrences: readonly Occurrence[]; view: Exclude<PatternView, "REJECTED"> },
): Promise<SyncResult> {
  try {
    const { data, error } = await supabase.rpc("sync_pattern_evidence", {
      p_kind: LATE_EVENING.kind,
      p_status: toDbStatus(a.view),
      p_occurrences: a.occurrences.map((o) => ({ meal_id: o.mealId, observed_at: o.occurredAt.toISOString() })),
    });
    if (error || typeof data !== "string" || !UUID.test(data)) {
      console.error("Patterns: syncing the evidence failed", error?.code ?? "no_code");
      return { ok: false };
    }
    return { ok: true, patternId: data };
  } catch {
    console.error("Patterns: syncing the evidence threw");
    return { ok: false };
  }
}
