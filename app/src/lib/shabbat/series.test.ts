import { describe, expect, it } from "vitest";
import { computeNextShabbat, type ShabbatInput, type ShabbatTimes } from "./index";
import { computeShabbatSeries } from "./series";

const jerusalem = {
  latitude: 31.7683,
  longitude: 35.2137,
  timezone: "Asia/Jerusalem",
  inIsrael: true,
  candleLightingMinutes: 40,
  cityName: "Jerusalem",
};
const FROM = new Date("2026-10-01T09:00:00Z");
const HOUR_MS = 3_600_000;

describe("computeShabbatSeries", () => {
  it("returns eight consecutive Shabbat periods for Jerusalem", () => {
    const series = computeShabbatSeries(jerusalem, FROM, 8);
    expect(series).toHaveLength(8);
    series.forEach((s, i) => {
      const hours = (s.havdalah.getTime() - s.candleLighting.getTime()) / HOUR_MS;
      expect(hours).toBeGreaterThan(24);
      expect(hours).toBeLessThan(28);
      if (i > 0) {
        expect(s.candleLighting.getTime()).toBeGreaterThan(series[i - 1].candleLighting.getTime());
        expect(series[i - 1].havdalah.getTime()).toBeLessThan(s.candleLighting.getTime());
      }
    });
  });

  it("starts with the Shabbat that is under way", () => {
    const series = computeShabbatSeries(jerusalem, new Date("2026-10-03T10:00:00Z"), 2);
    expect(series[0].candleLighting.toISOString()).toBe("2026-10-02T14:43:00.000Z");
  });

  it("still returns the requested count when one week has no result", () => {
    let calls = 0;
    const flaky = (i: ShabbatInput): ShabbatTimes | null => {
      calls += 1;
      return calls === 2 ? null : computeNextShabbat(i);
    };
    expect(computeShabbatSeries(jerusalem, FROM, 4, flaky)).toHaveLength(4);
  });

  it("moves the search a week ahead after a week with no result", () => {
    const starts: Date[] = [];
    let nulledOnce = false;
    const flaky = (i: ShabbatInput): ShabbatTimes | null => {
      starts.push(i.from);
      if (!nulledOnce) {
        nulledOnce = true;
        return null;
      }
      return computeNextShabbat(i);
    };
    computeShabbatSeries(jerusalem, FROM, 2, flaky);
    expect(starts[1].getTime() - starts[0].getTime()).toBe(7 * 24 * HOUR_MS);
  });

  it("stops on a compute that never finds anything", () => {
    let calls = 0;
    const never = (): ShabbatTimes | null => {
      calls += 1;
      return null;
    };
    expect(computeShabbatSeries(jerusalem, FROM, 8, never)).toEqual([]);
    expect(calls).toBe(8 * 2 + 4);
  });

  it("returns nothing for zero weeks", () => {
    expect(computeShabbatSeries(jerusalem, FROM, 0)).toEqual([]);
  });

  it("does not repeat a Shabbat when the compute returns the same one twice", () => {
    const first = computeNextShabbat({ ...jerusalem, from: FROM })!;
    const stuck = () => first;
    expect(computeShabbatSeries(jerusalem, FROM, 3, stuck)).toHaveLength(1);
  });
});
