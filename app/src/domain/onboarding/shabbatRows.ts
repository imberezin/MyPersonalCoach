/**
 * Shabbat periods as database rows. The series comes from the server (it needs the Hebcal
 * library, which is GPL and stays out of the domain); this file only shapes the result.
 */
import type { OfflinePeriod } from "../offline";
import type { Place } from "../places";
import type { JsonObject } from "./model";

/** The shape the replace_future_auto_shabbat function takes. Instants are ISO strings in UTC. */
export interface ShabbatPeriodRow {
  start_at: string;
  end_at: string;
  metadata: JsonObject;
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * One row per Shabbat. The metadata records how the times were made, so a later change of
 * rule or place can tell old rows from new ones. `started_before_onboarding` marks a Shabbat
 * that was already under way when the user finished the questions.
 */
export function buildShabbatRows(
  series: ReadonlyArray<{ candleLighting: Date; havdalah: Date }>,
  ctx: { place: Place; candleMinutes: number; now: Date },
): ShabbatPeriodRow[] {
  const { place, candleMinutes, now } = ctx;
  return series.map(({ candleLighting, havdalah }) => ({
    start_at: candleLighting.toISOString(),
    end_at: havdalah.toISOString(),
    metadata: {
      place_key: place.key,
      city: place.cityName,
      timezone: place.timezone,
      in_israel: place.inIsrael,
      candle_lighting_minutes: candleMinutes,
      latitude: place.latitude,
      longitude: place.longitude,
      havdalah_rule: "tzeit_8.5deg",
      // Candle lighting is always on the Friday, in the place's own zone.
      shabbat_date: dateInZone(candleLighting, place.timezone),
      started_before_onboarding: candleLighting.getTime() <= now.getTime(),
    },
  }));
}

/** The rows as offline periods, the type isOffline() and the day counters take. */
export function toOfflinePeriods(rows: ReadonlyArray<{ start_at: string; end_at: string }>): OfflinePeriod[] {
  return rows.map((r) => ({ type: "SHABBAT", start: new Date(r.start_at), end: new Date(r.end_at) }));
}
