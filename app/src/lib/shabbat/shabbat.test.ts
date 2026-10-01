import { describe, expect, it } from "vitest";
import { computeNextShabbat, defaultCandleLightingMinutes } from "./index";

// Jerusalem. Values were cross-checked against @hebcal/core and the local sunset.
const jerusalem = {
  latitude: 31.7683,
  longitude: 35.2137,
  timezone: "Asia/Jerusalem",
  inIsrael: true,
  candleLightingMinutes: 40,
  cityName: "Jerusalem",
};

describe("defaultCandleLightingMinutes", () => {
  it("follows the Hebcal defaults", () => {
    expect(defaultCandleLightingMinutes(true, "Jerusalem")).toBe(40);
    expect(defaultCandleLightingMinutes(true, "Haifa")).toBe(30);
    expect(defaultCandleLightingMinutes(true, "Tel Aviv")).toBe(20);
    expect(defaultCandleLightingMinutes(false, "New York")).toBe(18);
  });
});

describe("computeNextShabbat", () => {
  it("returns this week's Shabbat from a weekday", () => {
    const shabbat = computeNextShabbat({ ...jerusalem, from: new Date("2026-10-01T09:00:00Z") });
    expect(shabbat?.candleLighting.toISOString()).toBe("2026-10-02T14:43:00.000Z"); // 17:43 local
    expect(shabbat?.havdalah.toISOString()).toBe("2026-10-03T15:58:00.000Z"); // 18:58 local
  });

  it("returns the current Shabbat while it is in progress", () => {
    const shabbat = computeNextShabbat({ ...jerusalem, from: new Date("2026-10-03T10:00:00Z") });
    expect(shabbat?.candleLighting.toISOString()).toBe("2026-10-02T14:43:00.000Z");
  });

  it("moves to the next week once Havdalah has passed", () => {
    const shabbat = computeNextShabbat({ ...jerusalem, from: new Date("2026-10-03T17:00:00Z") });
    expect(shabbat).not.toBeNull();
    expect(shabbat!.candleLighting.getTime()).toBeGreaterThan(new Date("2026-10-08T00:00:00Z").getTime());
    expect(shabbat!.candleLighting.getTime()).toBeLessThan(new Date("2026-10-10T00:00:00Z").getTime());
  });

  it("covers a bit more than one day", () => {
    const shabbat = computeNextShabbat({ ...jerusalem, from: new Date("2026-10-01T09:00:00Z") })!;
    const hours = (shabbat.havdalah.getTime() - shabbat.candleLighting.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(24);
    expect(hours).toBeLessThan(28);
  });

  it("works outside Israel", () => {
    const shabbat = computeNextShabbat({
      latitude: 40.7128,
      longitude: -74.006,
      timezone: "America/New_York",
      inIsrael: false,
      candleLightingMinutes: 18,
      from: new Date("2026-10-01T09:00:00Z"),
      cityName: "New York",
    });
    expect(shabbat).not.toBeNull();
    expect(shabbat!.havdalah.getTime()).toBeGreaterThan(shabbat!.candleLighting.getTime());
  });
});

describe("candle-lighting minutes inside Israel", () => {
  const telAviv = {
    latitude: 32.08,
    longitude: 34.78,
    timezone: "Asia/Jerusalem",
    inIsrael: true,
    candleLightingMinutes: 20,
    cityName: "Tel Aviv",
    from: new Date("2026-10-01T09:00:00Z"),
  };
  const MINUTE_MS = 60_000;

  // Hebcal would replace an explicit 18 by its own city default for an Israeli Location.
  // The Location is built with il=false so the minutes the user confirmed are honoured.
  it("honours an explicit 18 minutes in Tel Aviv", () => {
    const at20 = computeNextShabbat(telAviv)!;
    const at18 = computeNextShabbat({ ...telAviv, candleLightingMinutes: 18 })!;
    expect(at18.candleLighting.getTime() - at20.candleLighting.getTime()).toBe(2 * MINUTE_MS);
  });

  it("honours an explicit 18 minutes in Jerusalem", () => {
    const from = new Date("2026-10-01T09:00:00Z");
    const at40 = computeNextShabbat({ ...jerusalem, from })!;
    const at18 = computeNextShabbat({ ...jerusalem, candleLightingMinutes: 18, from })!;
    expect(at18.candleLighting.getTime() - at40.candleLighting.getTime()).toBe(22 * MINUTE_MS);
  });

  it("does not move Havdalah when the candle-lighting minutes change", () => {
    const havdalahs = [18, 20, 40].map(
      (candleLightingMinutes) => computeNextShabbat({ ...telAviv, candleLightingMinutes })!.havdalah.toISOString(),
    );
    expect(new Set(havdalahs).size).toBe(1);
  });

  it("keeps the Jerusalem 40 minute result unchanged", () => {
    const shabbat = computeNextShabbat({ ...jerusalem, from: new Date("2026-10-01T09:00:00Z") });
    expect(shabbat?.candleLighting.toISOString()).toBe("2026-10-02T14:43:00.000Z");
  });
});
