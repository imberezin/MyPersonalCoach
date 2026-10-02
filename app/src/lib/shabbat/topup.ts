import "server-only";
import { RANGES, SHABBAT_HORIZON_WEEKS, buildShabbatRows, type ShabbatPeriodRow } from "@/domain/onboarding";
import { getPlace } from "@/domain/places";
import { computeShabbatSeries } from "./series";

/** A stored automatic Shabbat row, as much of it as the planner needs. */
export type ExistingAutoShabbat = { start_at: string; end_at: string; metadata: unknown };

export interface TopupProfile {
  observesShabbat: boolean | null;
  placeKey: string | null;
  candleMinutes: number | null;
}

export type TopupSkipReason = "not_observing" | "no_place" | "unknown_place" | "bad_minutes" | "stale_rows" | "calc_failed";

export type TopupPlan = { kind: "add"; rows: ShabbatPeriodRow[] } | { kind: "current" } | { kind: "skip"; reason: TopupSkipReason };

/** Written into the metadata of every row this job adds, so they can be told from onboarding's. */
export const TOPUP_ADDED_BY = "weekly_topup";

const skip = (reason: TopupSkipReason): TopupPlan => ({ kind: "skip", reason });

type Span = { start: number; end: number; placeKey: unknown; minutes: unknown };

function spanOf(row: ExistingAutoShabbat): Span | null {
  const start = new Date(row.start_at).getTime();
  const end = new Date(row.end_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const meta = row.metadata !== null && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  return { start, end, placeKey: meta.place_key, minutes: meta.candle_lighting_minutes };
}

/**
 * Which upcoming Shabbat rows to ADD for one user so the next SHABBAT_HORIZON_WEEKS Shabbatot are stored.
 * Pure: no I/O, never throws (any failure is `skip: calc_failed`). Insert-only by construction: it returns
 * rows to add and nothing else, never a row that has already started, never one that overlaps a stored
 * future row (an exact duplicate or a drifted time), and nothing at all when the stored rows were computed
 * for another place or other minutes (repairing those is the place-change flow's job).
 */
export function planShabbatTopup(
  input: { profile: TopupProfile; existing: readonly ExistingAutoShabbat[]; now: Date },
  compute: typeof computeShabbatSeries = computeShabbatSeries,
): TopupPlan {
  try {
    const { profile, existing, now } = input;
    if (profile.observesShabbat !== true) return skip("not_observing");

    if (typeof profile.placeKey !== "string" || profile.placeKey === "") return skip("no_place");
    const place = getPlace(profile.placeKey);
    if (!place) return skip("unknown_place");

    // Not validateShabbatChoice: it turns a missing value into the place default, and for this job a
    // missing value on an observing profile is a corrupt profile.
    const minutes = profile.candleMinutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < RANGES.candleMinutes.min || minutes > RANGES.candleMinutes.max) {
      return skip("bad_minutes");
    }

    const nowMs = now.getTime();
    // A row in progress still covers its Shabbat, so it counts as future. Past rows are ignored.
    const future = existing.map(spanOf).filter((s): s is Span => s !== null && s.end > nowMs);

    if (future.some((s) => s.placeKey !== place.key || s.minutes !== minutes)) return skip("stale_rows");
    if (future.length >= SHABBAT_HORIZON_WEEKS) return { kind: "current" };

    const series = compute(
      {
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone,
        inIsrael: place.inIsrael,
        candleLightingMinutes: minutes,
        cityName: place.cityName,
      },
      now,
      SHABBAT_HORIZON_WEEKS,
    );
    if (series.length === 0) return skip("calc_failed");

    const built = buildShabbatRows(series, { place, candleMinutes: minutes, now }).map(
      (row): ShabbatPeriodRow => ({
        ...row,
        metadata: { ...row.metadata, started_before_onboarding: false, added_by: TOPUP_ADDED_BY },
      }),
    );

    const rows = built
      .filter((row) => {
        const start = new Date(row.start_at).getTime();
        const end = new Date(row.end_at).getTime();
        if (Number.isNaN(start) || Number.isNaN(end) || start <= nowMs) return false;
        // Instants, not dates: a candle-lighting time that moved a minute must not slip past the unique key.
        return !future.some((s) => s.start < end && start < s.end);
      })
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, SHABBAT_HORIZON_WEEKS);

    return rows.length === 0 ? { kind: "current" } : { kind: "add", rows };
  } catch {
    return skip("calc_failed");
  }
}
