import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEIGHT_LIST, WEIGHT_TREND, isUuid, parseWeightRow, type WeightEntry, type WeightRow } from "@/domain/weight";

/**
 * Everything the weight flow reads and writes in `weight_entries`: the ONLY file that does. Every call runs as the
 * signed-in user, so Row Level Security applies and a UUID that belongs to someone else is simply "not found". The
 * admin client is never used here. No function throws: a failure is a typed result, and nothing the user wrote (a
 * weight, a note) is ever put in a log (only constant messages and Postgres error codes).
 */

export type WeightRepoResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "unavailable" };

/** The series Home and Progress read: columns that exist before the weight migration is applied. */
export const WEIGHT_SERIES_COLUMNS = "id, weight_kg, measured_at";
/** The list and the edit page: needs the `note` column of the weight migration. */
export const WEIGHT_ROW_COLUMNS = "id, weight_kg, measured_at, note";

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;
const NOT_FOUND = { ok: false, code: "not_found" } as const;
const TABLE = "weight_entries";
/** 22P02: the text is not a UUID, so nothing can have that id. */
const INVALID_TEXT = "22P02";

/**
 * A timestamp exactly as PostgREST returns it. The cursor's `measured_at` goes into a filter string unchanged (a Date
 * round trip would cut it to milliseconds), so anything that is not plainly a timestamp is refused first.
 */
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

function toKg(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** INSERT ... on conflict (id) do nothing. `created: false` = the id already existed (a double tap or a second tab): still success. `note` is sent only when non-null. */
export async function insertWeightEntry(
  supabase: SupabaseClient,
  a: { id: string; weightKg: number; measuredAt: Date; note: string | null },
): Promise<WeightRepoResult<{ created: boolean }>> {
  try {
    const row: Record<string, unknown> = { id: a.id, weight_kg: a.weightKg, measured_at: a.measuredAt.toISOString(), source: "manual" };
    // Without the key the insert works before the weight migration is applied (a note needs the column).
    if (a.note !== null) row.note = a.note;
    const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (error) {
      console.error("Weight: saving the weight failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (!Array.isArray(data)) return UNAVAILABLE;
    return { ok: true, value: { created: data.length > 0 } };
  } catch {
    console.error("Weight: saving the weight threw");
    return UNAVAILABLE;
  }
}

/** One own row with its note (edit page). Not mine, or missing: not_found. */
export async function loadWeightEntry(supabase: SupabaseClient, id: string): Promise<WeightRepoResult<WeightRow>> {
  try {
    const { data, error } = await supabase.from(TABLE).select(WEIGHT_ROW_COLUMNS).eq("id", id).limit(1);
    if (error) {
      if (error.code === INVALID_TEXT) return NOT_FOUND;
      console.error("Weight: loading the weight failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (!Array.isArray(data)) return UNAVAILABLE;
    if (data.length === 0) return NOT_FOUND;
    const row = parseWeightRow(data[0]);
    if (!row) {
      console.error("Weight: a stored weight could not be read");
      return UNAVAILABLE;
    }
    return { ok: true, value: row };
  } catch {
    console.error("Weight: loading the weight threw");
    return UNAVAILABLE;
  }
}

/** One own row without the note (Saved screen: works before the weight migration is applied). */
export async function loadSavedWeight(supabase: SupabaseClient, id: string): Promise<WeightRepoResult<WeightEntry>> {
  try {
    const { data, error } = await supabase.from(TABLE).select(WEIGHT_SERIES_COLUMNS).eq("id", id).limit(1);
    if (error) {
      if (error.code === INVALID_TEXT) return NOT_FOUND;
      console.error("Weight: loading the saved weight failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (!Array.isArray(data)) return UNAVAILABLE;
    if (data.length === 0) return NOT_FOUND;
    const row = parseWeightRow(data[0]);
    if (!row) {
      console.error("Weight: a stored weight could not be read");
      return UNAVAILABLE;
    }
    return { ok: true, value: { id: row.id, weightKg: row.weightKg, measuredAt: row.measuredAt } };
  } catch {
    console.error("Weight: loading the saved weight threw");
    return UNAVAILABLE;
  }
}

/** UPDATE of the person's own row. `measuredAt: null` = leave the time alone. 0 rows = not_found. */
export async function updateWeightEntry(
  supabase: SupabaseClient,
  a: { id: string; weightKg: number; measuredAt: Date | null; note: string | null },
): Promise<WeightRepoResult<{ changed: true }>> {
  try {
    const values: Record<string, unknown> = { weight_kg: a.weightKg, note: a.note };
    if (a.measuredAt !== null) values.measured_at = a.measuredAt.toISOString();
    const { data, error } = await supabase.from(TABLE).update(values).eq("id", a.id).select("id");
    if (error) {
      if (error.code === INVALID_TEXT) return NOT_FOUND;
      console.error("Weight: updating the weight failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (!Array.isArray(data)) return UNAVAILABLE;
    return data.length > 0 ? { ok: true, value: { changed: true } } : NOT_FOUND;
  } catch {
    console.error("Weight: updating the weight threw");
    return UNAVAILABLE;
  }
}

/**
 * Erases one weigh-in through the RPC. `deleted: false` means there was nothing to delete: already gone, or not the
 * caller's (the two are indistinguishable on purpose). A boolean answer is the only success.
 */
export async function deleteWeightEntry(supabase: SupabaseClient, id: string): Promise<WeightRepoResult<{ deleted: boolean }>> {
  try {
    const { data, error } = await supabase.rpc("delete_weight_entry", { p_entry_id: id });
    if (error) {
      console.error("Weight: deleting the weight failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (typeof data !== "boolean") {
      console.error("Weight: deleting the weight gave an unexpected answer");
      return UNAVAILABLE;
    }
    return { ok: true, value: { deleted: data } };
  } catch {
    console.error("Weight: deleting the weight threw");
    return UNAVAILABLE;
  }
}

/** The cursor row's `measured_at` as returned. null = no such row of the caller's (deleted, forged, not theirs). undefined = the read failed. */
async function readCursorTime(supabase: SupabaseClient, cursorId: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from(TABLE).select("measured_at").eq("id", cursorId).limit(1);
  if (error) {
    console.error("Weight: reading the list cursor failed", error.code ?? "no_code");
    return undefined;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const at = (data[0] as { measured_at?: unknown }).measured_at;
  return typeof at === "string" && TIMESTAMP_TEXT.test(at) ? at : null;
}

/**
 * The person's weights, newest first, `WEIGHT_LIST.pageSize` per page, after the cursor row when `after` is a UUID that
 * is one of the caller's entries (otherwise the newest page). One row more is asked for to learn `hasMore`; the next
 * cursor is the id of the last entry returned. A row that cannot be read is skipped; an empty table is an empty list,
 * and a failure is `unavailable` (never an empty list: that would claim "no weights" while some exist).
 */
export async function listWeightEntries(
  supabase: SupabaseClient,
  a: { after: string | null },
): Promise<WeightRepoResult<{ entries: WeightRow[]; hasMore: boolean }>> {
  try {
    let cursor: { id: string; at: string } | null = null;
    if (a.after !== null && isUuid(a.after)) {
      const at = await readCursorTime(supabase, a.after);
      if (at === undefined) return UNAVAILABLE;
      if (at !== null) cursor = { id: a.after, at };
    }

    let query = supabase.from(TABLE).select(WEIGHT_ROW_COLUMNS);
    if (cursor) query = query.or(`measured_at.lt.${cursor.at},and(measured_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await query
      .order("measured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(WEIGHT_LIST.pageSize + 1);
    if (error) {
      console.error("Weight: listing the weights failed", error.code ?? "no_code");
      return UNAVAILABLE;
    }
    if (!Array.isArray(data)) return UNAVAILABLE;

    const entries: WeightRow[] = [];
    for (const raw of data.slice(0, WEIGHT_LIST.pageSize)) {
      const row = parseWeightRow(raw);
      if (row) entries.push(row);
    }
    return { ok: true, value: { entries, hasMore: data.length > WEIGHT_LIST.pageSize } };
  } catch {
    console.error("Weight: listing the weights threw");
    return UNAVAILABLE;
  }
}

/** The newest weight strictly before `before` (excluding `excludeId`); null = none; "unknown" = the read failed (the double-check then does not ask). */
export async function loadReferenceWeight(
  supabase: SupabaseClient,
  a: { before: Date; excludeId?: string },
): Promise<number | null | "unknown"> {
  try {
    let query = supabase.from(TABLE).select("weight_kg").lt("measured_at", a.before.toISOString());
    if (a.excludeId !== undefined) query = query.neq("id", a.excludeId);
    const { data, error } = await query.order("measured_at", { ascending: false }).limit(1);
    if (error) {
      console.error("Weight: reading the previous weight failed", error.code ?? "no_code");
      return "unknown";
    }
    if (!Array.isArray(data)) return "unknown";
    if (data.length === 0) return null;
    const kg = toKg((data[0] as { weight_kg?: unknown }).weight_kg);
    return kg === null ? "unknown" : kg;
  } catch {
    console.error("Weight: reading the previous weight threw");
    return "unknown";
  }
}

/**
 * The series for the trend: newest first, at most WEIGHT_TREND.maxEntriesRead; `truncated` when exactly that many came
 * back (the oldest weeks may be missing, so nothing may be claimed from the history). A row that cannot be read is
 * dropped. null = the read failed.
 */
export async function loadWeightSeries(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ entries: WeightEntry[]; truncated: boolean } | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(WEIGHT_SERIES_COLUMNS)
      .eq("user_id", userId)
      .order("measured_at", { ascending: false })
      .limit(WEIGHT_TREND.maxEntriesRead);
    if (error) {
      console.error("Weight: loading the series failed", error.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(data)) return null;

    const entries: WeightEntry[] = [];
    for (const raw of data) {
      const row = parseWeightRow(raw);
      if (row) entries.push({ id: row.id, weightKg: row.weightKg, measuredAt: row.measuredAt });
    }
    return { entries, truncated: data.length >= WEIGHT_TREND.maxEntriesRead };
  } catch {
    console.error("Weight: loading the series threw");
    return null;
  }
}
