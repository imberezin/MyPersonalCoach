import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RESUME_WINDOW_MS,
  draftToJson,
  itemsToJson,
  parseUnderstandingRow,
  toConfirmedItems,
  type MealDraft,
  type MealSource,
  type MealType,
  type ReportMode,
  type Understanding,
  type UnderstoodItem,
} from "@/domain/food";

/**
 * Everything the food flow reads and writes in the database. Every call runs as the signed-in user,
 * so Row Level Security applies and a UUID that belongs to someone else is simply "not found". The
 * admin client is never used here. No function throws: a failure is a typed result, and nothing
 * the user wrote is ever put in a log (only Postgres error codes).
 */

export type RepoResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "not_pending" | "unavailable" };

export interface NewUnderstanding {
  requestId: string | null;
  kind: ReportMode;
  text: string | null;
  provider: string;
  model: string | null;
  promptVersion: string | null;
  items: UnderstoodItem[];
  unclear: string[];
  overallConfidence: number | null;
  proposed: { mealType: MealType; occurredAt: Date };
}

/** The columns `parseUnderstandingRow` reads, with the kind of the raw input it came from. */
export const UNDERSTANDING_COLUMNS =
  "id, provider, model, prompt_version, status, items, unclear, overall_confidence, proposed_meal_type, proposed_occurred_at, draft, created_at, meal_raw_inputs(kind)";

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

type RpcError = { message?: string; code?: string } | null;

/** The RPCs raise short codes as the message ("not_found", "not_pending"). */
function rpcFailure(error: RpcError): { ok: false; code: "not_found" | "not_pending" | "unavailable" } {
  const message = error?.message ?? "";
  if (message.includes("not_found") || error?.code === "P0002") return { ok: false, code: "not_found" };
  if (message.includes("not_pending")) return { ok: false, code: "not_pending" };
  console.error("Food: a database call failed", error?.code ?? "no_code");
  return UNAVAILABLE;
}

/** Creates the raw input and its pending understanding in one call. Idempotent per `requestId`. */
export async function createUnderstanding(supabase: SupabaseClient, input: NewUnderstanding): Promise<RepoResult<{ id: string }>> {
  try {
    const { data, error } = await supabase.rpc("create_meal_understanding", {
      p_request_id: input.requestId,
      p_kind: input.kind,
      p_text: input.text,
      p_provider: input.provider,
      p_model: input.model,
      p_prompt_version: input.promptVersion,
      p_items: itemsToJson(input.items),
      p_unclear: input.unclear,
      p_overall: input.overallConfidence,
      p_meal_type: input.proposed.mealType,
      p_occurred_at: input.proposed.occurredAt.toISOString(),
    });
    if (error || typeof data !== "string") return rpcFailure(error ?? null);
    return { ok: true, value: { id: data } };
  } catch {
    console.error("Food: creating the understanding threw");
    return UNAVAILABLE;
  }
}

/**
 * The understanding that already exists for a client request id, whatever its status (a confirmed
 * one makes D6 redirect to D8). Any error or no row is null: the normal flow goes on, and the RPC
 * stays idempotent as the last line of defence.
 */
export async function findByRequestId(supabase: SupabaseClient, requestId: string): Promise<{ id: string } | null> {
  try {
    const { data, error } = await supabase
      .from("meal_raw_inputs")
      .select("id, meal_understandings(id)")
      .eq("client_request_id", requestId)
      .maybeSingle();
    if (error || !data) return null;
    const embedded = (data as { meal_understandings?: unknown }).meal_understandings;
    const first = Array.isArray(embedded) ? embedded[0] : embedded;
    const id = (first as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" ? { id } : null;
  } catch {
    return null;
  }
}

/** One understanding, as the signed-in user. An id of someone else's, or none, is `not_found`. */
export async function loadUnderstanding(supabase: SupabaseClient, id: string): Promise<RepoResult<Understanding>> {
  try {
    const { data, error } = await supabase.from("meal_understandings").select(UNDERSTANDING_COLUMNS).eq("id", id).maybeSingle();
    if (error) {
      // 22P02: the text is not a UUID, so nothing can have that id.
      if (error.code === "22P02") return { ok: false, code: "not_found" };
      console.error("Food: loading the understanding failed", error.code);
      return UNAVAILABLE;
    }
    if (!data) return { ok: false, code: "not_found" };
    const understanding = parseUnderstandingRow(data);
    if (!understanding) {
      console.error("Food: a stored understanding could not be read");
      return UNAVAILABLE;
    }
    return { ok: true, value: understanding };
  } catch {
    console.error("Food: loading the understanding threw");
    return UNAVAILABLE;
  }
}

/** Saves the user's working copy. Only a pending report can change: zero rows means it is no longer pending. */
export async function saveDraft(supabase: SupabaseClient, id: string, draft: MealDraft): Promise<RepoResult<true>> {
  try {
    const { data, error } = await supabase
      .from("meal_understandings")
      .update({ draft: draftToJson(draft) })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) {
      console.error("Food: saving the draft failed", error.code);
      return UNAVAILABLE;
    }
    return Array.isArray(data) && data.length > 0 ? { ok: true, value: true } : { ok: false, code: "not_pending" };
  } catch {
    console.error("Food: saving the draft threw");
    return UNAVAILABLE;
  }
}

/**
 * Confirms the meal through the one atomic RPC. The items sent are rebuilt from the meal (name and
 * portion only); the client never supplies them. Confirming twice returns the same entry.
 */
export async function confirmMeal(
  supabase: SupabaseClient,
  a: { id: string; meal: MealDraft; source: MealSource },
): Promise<RepoResult<{ entryId: string }>> {
  try {
    const { data, error } = await supabase.rpc("confirm_meal_understanding", {
      p_id: a.id,
      p_occurred_at: a.meal.occurredAt.toISOString(),
      p_meal_type: a.meal.mealType,
      p_items: itemsToJson(toConfirmedItems(a.meal.items)),
      p_source: a.source,
    });
    if (error || typeof data !== "string") return rpcFailure(error ?? null);
    return { ok: true, value: { entryId: data } };
  } catch {
    console.error("Food: confirming the meal threw");
    return UNAVAILABLE;
  }
}

/** Deletes a pending report and its raw text. A confirmed report is never touched: the RPC answers false. */
export async function discardUnderstanding(supabase: SupabaseClient, id: string): Promise<RepoResult<true>> {
  try {
    const { data, error } = await supabase.rpc("discard_meal_understanding", { p_id: id });
    if (error) return rpcFailure(error);
    return data === true ? { ok: true, value: true } : { ok: false, code: "not_pending" };
  } catch {
    console.error("Food: discarding the report threw");
    return UNAVAILABLE;
  }
}

/** The newest pending report younger than RESUME_WINDOW_MS. Any error is null. */
export async function findResumable(supabase: SupabaseClient, now: Date): Promise<{ id: string; createdAt: Date } | null> {
  try {
    const since = new Date(now.getTime() - RESUME_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("meal_understandings")
      .select("id, created_at")
      .eq("status", "pending")
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as { id?: unknown; created_at?: unknown };
    const createdAt = typeof row.created_at === "string" ? new Date(row.created_at) : null;
    if (typeof row.id !== "string" || !createdAt || Number.isNaN(createdAt.getTime())) return null;
    return { id: row.id, createdAt };
  } catch {
    return null;
  }
}

/**
 * The confirmed meal of a report, and whether it is the very first meal the user ever saved
 * (`meal_entries` holds exactly one row; the query asks for two and stops).
 */
export async function loadSavedMeal(
  supabase: SupabaseClient,
  understandingId: string,
): Promise<RepoResult<{ entryId: string; confirmedAt: Date; isFirstMeal: boolean }>> {
  try {
    const [entry, anyEntries] = await Promise.all([
      supabase.from("meal_entries").select("id, confirmed_at").eq("understanding_id", understandingId).maybeSingle(),
      supabase.from("meal_entries").select("id").limit(2),
    ]);
    if (entry.error || anyEntries.error) {
      console.error("Food: loading the saved meal failed", entry.error?.code ?? anyEntries.error?.code);
      return UNAVAILABLE;
    }
    if (!entry.data) return { ok: false, code: "not_found" };

    const row = entry.data as { id?: unknown; confirmed_at?: unknown };
    const confirmedAt = typeof row.confirmed_at === "string" ? new Date(row.confirmed_at) : null;
    if (typeof row.id !== "string" || !confirmedAt || Number.isNaN(confirmedAt.getTime())) return UNAVAILABLE;
    const count = Array.isArray(anyEntries.data) ? anyEntries.data.length : 0;
    return { ok: true, value: { entryId: row.id, confirmedAt, isFirstMeal: count === 1 } };
  } catch {
    console.error("Food: loading the saved meal threw");
    return UNAVAILABLE;
  }
}
