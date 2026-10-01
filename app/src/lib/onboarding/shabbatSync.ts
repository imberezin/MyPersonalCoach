import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHABBAT_HORIZON_WEEKS, buildShabbatRows } from "@/domain/onboarding";
import { getPlace } from "@/domain/places";
import { computeShabbatSeries } from "@/lib/shabbat/series";

/**
 * synced: the upcoming Shabbat periods were replaced. cleared: the user no longer observes
 * Shabbat and the upcoming automatic periods were removed. pending: nothing was changed and
 * the sync has to be tried again (the finish step does).
 */
export type ShabbatSyncResult = "synced" | "cleared" | "pending";

const RPC = "replace_future_auto_shabbat";

/**
 * Brings the stored Shabbat periods in line with the place and candle-lighting minutes the user
 * confirmed. Best effort: it never throws, because a calendar problem must not stop onboarding.
 * An empty result from the calculation is treated as a failure, not as "no Shabbat", so the
 * rows that already exist are kept instead of wiped.
 */
export async function syncShabbatPeriods(
  supabase: SupabaseClient,
  target: { placeKey: string; candleMinutes: number } | "clear",
  now: Date,
): Promise<ShabbatSyncResult> {
  try {
    if (target === "clear") {
      const { error } = await supabase.rpc(RPC, { p_rows: [] });
      if (error) {
        console.error("Shabbat sync: clearing the upcoming periods failed", error.code);
        return "pending";
      }
      return "cleared";
    }

    const place = getPlace(target.placeKey);
    if (!place) return "pending";

    const series = computeShabbatSeries(
      {
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone,
        inIsrael: place.inIsrael,
        candleLightingMinutes: target.candleMinutes,
        cityName: place.cityName,
      },
      now,
      SHABBAT_HORIZON_WEEKS,
    );
    if (series.length === 0) return "pending";

    const rows = buildShabbatRows(series, { place, candleMinutes: target.candleMinutes, now });
    const { error } = await supabase.rpc(RPC, { p_rows: rows });
    if (error) {
      console.error("Shabbat sync: replacing the upcoming periods failed", error.code);
      return "pending";
    }
    return "synced";
  } catch {
    console.error("Shabbat sync: unexpected error");
    return "pending";
  }
}
