import "server-only";
import { computeNextShabbat, type ShabbatInput, type ShabbatTimes } from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * The next `weeks` Shabbat periods, in order. `computeNextShabbat` returns one Shabbat per
 * call, so this walks forward: each search starts just after the previous Havdalah.
 *
 * A week with no result (a Shabbat that runs into Yom Tov is one) is skipped by moving the
 * search a week ahead, so one odd week never ends the whole series. The loop is bounded and
 * the function never throws on a null; it may return fewer items than asked for.
 */
export function computeShabbatSeries(
  input: Omit<ShabbatInput, "from">,
  from: Date,
  weeks: number,
  compute: (i: ShabbatInput) => ShabbatTimes | null = computeNextShabbat,
): ShabbatTimes[] {
  const series: ShabbatTimes[] = [];
  const seen = new Set<number>();
  const maxIterations = weeks * 2 + 4;
  let cursor = from;

  for (let i = 0; i < maxIterations && series.length < weeks; i++) {
    const times = compute({ ...input, from: cursor });
    if (times === null) {
      cursor = new Date(cursor.getTime() + 7 * DAY_MS);
      continue;
    }
    const key = times.candleLighting.getTime();
    if (!seen.has(key)) {
      seen.add(key);
      series.push(times);
    }
    // One minute past Havdalah, so the next search cannot return the same Shabbat.
    cursor = new Date(times.havdalah.getTime() + MINUTE_MS);
  }
  return series;
}
