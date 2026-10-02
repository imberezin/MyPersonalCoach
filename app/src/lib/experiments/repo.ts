import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FIRST_EXPERIMENT_LIMITS,
  type ExperimentFact,
  type ExperimentStatus,
} from "@/domain/experiments";
import { INTERVENTIONS, type InterventionKey } from "@/domain/interventions/library";
import type { RepoResult } from "@/lib/food/repo";

/**
 * Everything the first experiment reads and writes in `experiments`. Every call runs as the signed-in user, so Row
 * Level Security applies and the admin client is never used. No function throws: a failure is a typed result or
 * null, and no text is ever put in a log (only Postgres error codes).
 *
 * The states: no row -> OFFERED -> ACTIVE, or OFFERED -> SKIPPED (DONE is Weekly Learning's). The database allows at
 * most ONE open (OFFERED or ACTIVE) row per person (migration 20261001170000, `experiments_one_open`), so every
 * update below addresses "the person's single open row" and needs no id from the form.
 */

/** The person's open experiment, with the sentence they were shown. */
export interface OpenExperiment {
  id: string;
  status: "OFFERED" | "ACTIVE";
  key: InterventionKey;
  variantId: string;
  wording: string;
  source: "library" | "ai";
  locale: "he" | "en";
}

export const EXPERIMENT_COLUMNS =
  "id, status, source_pattern_id, intervention_key, variant, wording, wording_source, wording_locale, ended_at";

const STATUSES: readonly ExperimentStatus[] = ["OFFERED", "ACTIVE", "DONE", "SKIPPED"];
const UNAVAILABLE = { ok: false, code: "unavailable" } as const;
const UNIQUE_VIOLATION = "23505";

const isInterventionKey = (v: unknown): v is InterventionKey => typeof v === "string" && Object.hasOwn(INTERVENTIONS, v);

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface ParsedRow {
  fact: ExperimentFact;
  open: OpenExperiment | null;
}

/** A row with an unknown status, or without an id, is dropped, not guessed. */
function parseRow(row: unknown): ParsedRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const status = STATUSES.find((s) => s === r.status);
  if (typeof r.id !== "string" || r.id === "" || status === undefined) return null;

  const endedAt = r.ended_at === null || r.ended_at === undefined ? null : toDate(r.ended_at);
  if (r.ended_at !== null && r.ended_at !== undefined && endedAt === null) return null;
  const fact: ExperimentFact = {
    id: r.id,
    status,
    sourcePatternId: typeof r.source_pattern_id === "string" ? r.source_pattern_id : null,
    endedAt,
  };

  let open: OpenExperiment | null = null;
  if (
    (status === "OFFERED" || status === "ACTIVE") &&
    isInterventionKey(r.intervention_key) &&
    typeof r.variant === "string" &&
    typeof r.wording === "string" &&
    r.wording !== "" &&
    (r.wording_source === "library" || r.wording_source === "ai") &&
    (r.wording_locale === "he" || r.wording_locale === "en")
  ) {
    open = {
      id: r.id,
      status,
      key: r.intervention_key,
      variantId: r.variant,
      wording: r.wording,
      source: r.wording_source,
      locale: r.wording_locale,
    };
  }
  return { fact, open };
}

/**
 * All of the person's experiments (at most FIRST_EXPERIMENT_LIMITS.rows, newest first) as facts for the pure
 * selection, plus the open one's stored text. `open` is the newest OFFERED or ACTIVE row that carries a readable
 * wording. null = unknown (an error, a throw or a non-array answer).
 */
export async function loadExperiments(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ facts: ExperimentFact[]; open: OpenExperiment | null } | null> {
  try {
    const { data, error } = await supabase
      .from("experiments")
      .select(EXPERIMENT_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(FIRST_EXPERIMENT_LIMITS.rows);
    if (error) {
      console.error("Experiments: loading failed", error.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(data)) return null;

    const parsed = data.map(parseRow).filter((p): p is ParsedRow => p !== null);
    return { facts: parsed.map((p) => p.fact), open: parsed.find((p) => p.open !== null)?.open ?? null };
  } catch {
    console.error("Experiments: loading threw");
    return null;
  }
}

/**
 * INSERTS one OFFERED row carrying the LIBRARY sentence, BEFORE any AI call (so a second press or tab finds it and an
 * interrupted request leaves approved text in place). `started_at` is not written: an offer never started. A unique
 * violation on `experiments_one_open` (23505) means an open experiment already exists (a double tap, a second tab, an
 * earlier press still waiting for the AI): that row's id comes back with `created: false`, and the caller makes no AI
 * call and emits nothing. RLS scopes the lookup of that row to the person.
 */
export async function insertOfferedExperiment(
  supabase: SupabaseClient,
  a: { patternId: string; key: InterventionKey; variantId: string; libraryText: string; locale: "he" | "en" },
): Promise<RepoResult<{ id: string; created: boolean }>> {
  try {
    const { data, error } = await supabase
      .from("experiments")
      .insert({
        source_pattern_id: a.patternId,
        intervention_key: a.key,
        variant: a.variantId,
        status: "OFFERED",
        wording: a.libraryText,
        wording_source: "library",
        wording_locale: a.locale,
      })
      .select("id");

    if (!error) {
      const id = Array.isArray(data) ? (data[0] as { id?: unknown } | undefined)?.id : undefined;
      if (typeof id === "string") return { ok: true, value: { id, created: true } };
      console.error("Experiments: the insert answered without an id");
      return UNAVAILABLE;
    }
    if (error.code !== UNIQUE_VIOLATION) {
      console.error("Experiments: inserting the offer failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }

    const existing = await supabase
      .from("experiments")
      .select("id")
      .in("status", ["OFFERED", "ACTIVE"])
      .order("created_at", { ascending: false })
      .limit(1);
    const existingId = Array.isArray(existing.data) ? (existing.data[0] as { id?: unknown } | undefined)?.id : undefined;
    if (existing.error || typeof existingId !== "string") {
      console.error("Experiments: the open experiment could not be read", existing.error?.code ?? "no_code");
      return UNAVAILABLE;
    }
    return { ok: true, value: { id: existingId, created: false } };
  } catch {
    console.error("Experiments: inserting the offer threw");
    return UNAVAILABLE;
  }
}

/** One conditional UPDATE of the person's OFFERED row; 0 rows is `changed: false`, which is not an error. */
async function updateOffered(
  supabase: SupabaseClient,
  patch: Record<string, string>,
  filters: Array<[string, string]>,
  what: string,
): Promise<RepoResult<{ changed: boolean }>> {
  try {
    let query = supabase.from("experiments").update(patch);
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query.select("id");
    if (error) {
      console.error(`Experiments: ${what} failed`, error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (!Array.isArray(data)) return UNAVAILABLE;
    return { ok: true, value: { changed: data.length > 0 } };
  } catch {
    console.error(`Experiments: ${what} threw`);
    return UNAVAILABLE;
  }
}

/**
 * After a VALIDATED AI wording only: replaces the text of the person's OFFERED row that still carries the library
 * text. 0 rows (skipped, started or already upgraded meanwhile) is `changed: false`, and nothing changes.
 */
export function upgradeOfferedWording(
  supabase: SupabaseClient,
  userId: string,
  a: { text: string; locale: "he" | "en" },
): Promise<RepoResult<{ changed: boolean }>> {
  return updateOffered(
    supabase,
    { wording: a.text, wording_source: "ai", wording_locale: a.locale },
    [
      ["user_id", userId],
      ["status", "OFFERED"],
      ["wording_source", "library"],
    ],
    "upgrading the wording",
  );
}

/** OFFERED -> ACTIVE (`started_at` = now). 0 rows = already started, skipped or gone: `changed: false`. */
export function startExperiment(supabase: SupabaseClient, userId: string, now: Date): Promise<RepoResult<{ changed: boolean }>> {
  return updateOffered(
    supabase,
    { status: "ACTIVE", started_at: now.toISOString() },
    [
      ["user_id", userId],
      ["status", "OFFERED"],
    ],
    "starting",
  );
}

/**
 * OFFERED -> SKIPPED (`ended_at` = now). Also what finishFirstWeekAction calls to close an unanswered offer in the
 * same press as the transition. 0 rows = nothing was offered (the common case): `changed: false`.
 */
export function skipExperiment(supabase: SupabaseClient, userId: string, now: Date): Promise<RepoResult<{ changed: boolean }>> {
  return updateOffered(
    supabase,
    { status: "SKIPPED", ended_at: now.toISOString() },
    [
      ["user_id", userId],
      ["status", "OFFERED"],
    ],
    "skipping",
  );
}
