import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperimentStatus } from "@/domain/experiments";
import { INTERVENTIONS, type InterventionKey } from "@/domain/interventions/library";
import { WEEKLY_LIMITS, type ExperimentRecord, type Helpfulness } from "@/domain/weekly";

/**
 * The weekly experiment history: the person's newest experiments with what the weekly loop needs (the key, the result, the
 * start), which the First Week's ExperimentFact does not carry. Read as the signed-in user (RLS applies, no admin client),
 * never written here, never thrown. It selects `variant` and `wording*`, so it needs the First Week's pattern_detection
 * migration; without it the read fails and the caller treats the history as unknown.
 */

/** The person's OFFERED or ACTIVE experiment with the sentence they were shown. */
export interface OpenWeeklyExperiment {
  id: string;
  status: "OFFERED" | "ACTIVE";
  key: InterventionKey;
  variantId: string;
  /** `pattern` iff the row has a source pattern; a weekly starter has none. */
  origin: "pattern" | "starter";
  wording: string;
  source: "library" | "ai";
  locale: "he" | "en";
  startedAt: Date | null;
}

export interface ExperimentHistory {
  /** Newest first, every status. */
  records: ExperimentRecord[];
  /** The newest OFFERED or ACTIVE row that carries a readable wording and a key of the library. */
  open: OpenWeeklyExperiment | null;
}

export const HISTORY_COLUMNS =
  "id, status, intervention_key, variant, source_pattern_id, started_at, ended_at, helpfulness, tried, wording, wording_source, wording_locale";

const STATUSES: readonly ExperimentStatus[] = ["OFFERED", "ACTIVE", "DONE", "SKIPPED"];
const HELPFULNESS: readonly Helpfulness[] = ["HELPFUL", "SOMEWHAT", "NOT_REALLY", "UNKNOWN"];

const isInterventionKey = (v: unknown): v is InterventionKey => typeof v === "string" && Object.hasOwn(INTERVENTIONS, v);

/** undefined = present but unreadable (the row is then dropped); null = absent. */
function dateOrNull(v: unknown): Date | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

interface Parsed {
  record: ExperimentRecord;
  open: OpenWeeklyExperiment | null;
}

/** A row with an unknown status, without an id, or with a malformed date or answer is dropped, not guessed. */
function parseRow(raw: unknown): Parsed | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const status = STATUSES.find((s) => s === r.status);
  if (typeof r.id !== "string" || r.id === "" || status === undefined) return null;

  const startedAt = dateOrNull(r.started_at);
  const endedAt = dateOrNull(r.ended_at);
  if (startedAt === undefined || endedAt === undefined) return null;

  const helpfulness = r.helpfulness === null || r.helpfulness === undefined ? null : (HELPFULNESS.find((h) => h === r.helpfulness) ?? undefined);
  const tried = r.tried === null || r.tried === undefined ? null : r.tried === "YES" || r.tried === "NO" ? r.tried : undefined;
  if (helpfulness === undefined || tried === undefined) return null;

  // A value outside the library keeps the row as history without a key: it still counts for what it is, never for a text.
  const key = isInterventionKey(r.intervention_key) ? r.intervention_key : null;
  const variantId = typeof r.variant === "string" && r.variant !== "" ? r.variant : null;
  const sourcePatternId = typeof r.source_pattern_id === "string" ? r.source_pattern_id : null;

  const record: ExperimentRecord = { id: r.id, status, key, variantId, sourcePatternId, startedAt, endedAt, helpfulness, tried };

  let open: OpenWeeklyExperiment | null = null;
  if (
    (status === "OFFERED" || status === "ACTIVE") &&
    key !== null &&
    variantId !== null &&
    typeof r.wording === "string" &&
    r.wording !== "" &&
    (r.wording_source === "library" || r.wording_source === "ai") &&
    (r.wording_locale === "he" || r.wording_locale === "en")
  ) {
    open = {
      id: r.id,
      status,
      key,
      variantId,
      origin: sourcePatternId !== null ? "pattern" : "starter",
      wording: r.wording,
      source: r.wording_source,
      locale: r.wording_locale,
      startedAt,
    };
  }
  return { record, open };
}

/**
 * The person's newest WEEKLY_LIMITS.experiments experiments (about five months at one a week), newest first. null = unknown:
 * an error, a throw or a non-array answer. Never throws.
 */
export async function loadExperimentHistory(supabase: SupabaseClient, userId: string): Promise<ExperimentHistory | null> {
  try {
    const { data, error } = await supabase
      .from("experiments")
      .select(HISTORY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(WEEKLY_LIMITS.experiments);
    if (error) {
      console.error("Weekly: loading the experiment history failed", error.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(data)) return null;

    const parsed = data.map(parseRow).filter((p): p is Parsed => p !== null);
    return { records: parsed.map((p) => p.record), open: parsed.find((p) => p.open !== null)?.open ?? null };
  } catch {
    console.error("Weekly: loading the experiment history threw");
    return null;
  }
}
