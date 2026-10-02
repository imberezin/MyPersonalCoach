import { buildShabbatRows, type ShabbatPeriodRow } from "@/domain/onboarding/shabbatRows";
import { getPlace, type Place } from "@/domain/places";
import { DAY_MS, localDayOf, resolveTimeZone } from "@/domain/time";
import { computeShabbatSeries } from "@/lib/shabbat/series";
import type { ShabbatTimes } from "@/lib/shabbat";
import type { SeedOptions } from "./args";
import { resolveAsOf, startedAtOf } from "./plan";

/**
 * The Shabbat periods of a demo run, from the SAME engine onboarding uses (Hebcal through src/lib/shabbat), for the place
 * and candle-lighting minutes the demo profile gets. Every Shabbat from the first day to the clock's day plus 14 days, so
 * a "before Shabbat" window exists in the future too.
 */
export const SEED_PLACE_KEY = "jerusalem";
/** Days past the clock that still get a Shabbat row. */
export const SHABBAT_LOOKAHEAD_DAYS = 14;

export function seedPlace(): Place {
  const place = getPlace(SEED_PLACE_KEY);
  if (!place) throw new Error("seed_place_missing");
  return place;
}

export function seedShabbatSeries(options: SeedOptions): ShabbatTimes[] {
  const place = seedPlace();
  const timeZone = resolveTimeZone(options.timeZone);
  const startedAt = startedAtOf(options);
  const from = localDayOf(startedAt, timeZone).start;
  const until = new Date(resolveAsOf(options, startedAt).getTime() + SHABBAT_LOOKAHEAD_DAYS * DAY_MS);
  const weeks = Math.max(1, Math.ceil((until.getTime() - from.getTime()) / (7 * DAY_MS)) + 1);
  return computeShabbatSeries(
    {
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
      inIsrael: place.inIsrael,
      candleLightingMinutes: place.candleDefault,
      cityName: place.cityName,
    },
    from,
    weeks,
  );
}

/** What `buildSeedPlan` takes: just the instants. */
export function toPlanShabbat(series: readonly ShabbatTimes[]): { start: Date; end: Date }[] {
  return series.map((s) => ({ start: s.candleLighting, end: s.havdalah }));
}

/** The `offline_periods` rows, shaped by the app's own function. */
export function seedShabbatRows(series: readonly ShabbatTimes[], startedAt: Date): ShabbatPeriodRow[] {
  const place = seedPlace();
  return buildShabbatRows(series, { place, candleMinutes: place.candleDefault, now: startedAt });
}
