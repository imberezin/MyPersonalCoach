import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TopupCandidate, TopupStore } from "./shabbatTopup";

/** The only function this job calls to write. Insert-only; granted to service_role alone. */
export const TOPUP_RPC = "top_up_future_auto_shabbat";

/** An explicit allow-list: nothing else about the user (goals, weight, motivation, name) is read. */
export const CANDIDATE_COLUMNS = "user_id, observes_shabbat, place_key, candle_lighting_minutes";

/** Per user: a year of weekly rows is far fewer than this, so the PostgREST row cap never truncates. */
const EXISTING_LIMIT = 100;

/**
 * The Supabase side of the weekly Shabbat top-up, on the service-role client. Reads throw on error (the runner
 * counts them per user); the write returns an error CODE, never a message.
 */
export function createSupabaseTopupStore(admin: SupabaseClient): TopupStore {
  return {
    async listCandidates(afterUserId, limit) {
      let query = admin
        .from("profiles")
        .select(CANDIDATE_COLUMNS)
        .eq("observes_shabbat", true)
        .not("onboarding_completed_at", "is", null)
        .order("user_id")
        .limit(limit);
      if (afterUserId !== null) query = query.gt("user_id", afterUserId);

      const { data, error } = await query;
      if (error) throw new Error("candidates_failed");
      return (data ?? []).map(
        (row): TopupCandidate => ({
          userId: row.user_id,
          observesShabbat: row.observes_shabbat,
          placeKey: row.place_key,
          candleMinutes: row.candle_lighting_minutes,
        }),
      );
    },

    async listFutureAutoShabbat(userId, now) {
      const { data, error } = await admin
        .from("offline_periods")
        .select("start_at, end_at, metadata")
        .eq("user_id", userId)
        .eq("type", "SHABBAT")
        .eq("source", "auto")
        .gt("end_at", now.toISOString())
        .order("start_at")
        .limit(EXISTING_LIMIT);
      if (error) throw new Error("existing_failed");
      return data ?? [];
    },

    async insertRows(userId, target, rows) {
      const { data, error } = await admin.rpc(TOPUP_RPC, {
        p_user_id: userId,
        p_place_key: target.placeKey,
        p_candle_minutes: target.candleMinutes,
        p_rows: rows,
      });
      if (error) return { error: error.code || "rpc_failed" };
      if (typeof data !== "number") return { error: "bad_response" };
      return { inserted: data };
    },
  };
}
