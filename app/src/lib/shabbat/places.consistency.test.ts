import { Location, calendar } from "@hebcal/core";
import { describe, expect, it } from "vitest";
import { PLACES, getPlace } from "@/domain/places";
import { computeNextShabbat } from "./index";

// The place registry is authored by hand (src/domain/places.ts). This test is the check against
// Hebcal's own data for the eight Israeli cities both lists share. It lives in src/lib/shabbat
// because that is the only folder allowed to import the GPL @hebcal packages.
const HEBCAL_NAME: Record<string, string> = {
  jerusalem: "Jerusalem",
  tel_aviv: "Tel Aviv",
  haifa: "Haifa",
  beer_sheva: "Beer Sheva",
  eilat: "Eilat",
  tiberias: "Tiberias",
  petah_tikva: "Petach Tikvah",
  ashdod: "Ashdod",
};

const FROM = new Date("2026-10-01T09:00:00Z");
const TWO_MINUTES_MS = 2 * 60_000;

describe("place registry against Hebcal", () => {
  it.each(Object.entries(HEBCAL_NAME))("%s matches Hebcal's %s", (key, hebcalName) => {
    const place = getPlace(key);
    expect(place, `${key} is missing from PLACES`).toBeDefined();
    const location = Location.lookup(hebcalName);
    expect(location, `Hebcal has no ${hebcalName}`).toBeDefined();

    expect(place!.timezone).toBe(location!.getTzid());
    expect(place!.inIsrael).toBe(location!.getIsrael());

    // Hebcal's own Israeli default: asking for 18 gives the city's offset (Jerusalem 40, Haifa 30, else 20).
    const events = calendar({
      start: new Date(2026, 9, 1),
      end: new Date(2026, 9, 8),
      candlelighting: true,
      location,
      candleLightingMins: 18,
      noHolidays: true,
      sedrot: false,
      il: true,
    });
    const friday = events.find((e) => e.getDesc() === "Candle lighting" && e.getDate().greg().getDay() === 5);
    expect(friday, "Hebcal returned no Friday candle lighting").toBeDefined();
    const hebcalTime = (friday as unknown as { eventTime: Date }).eventTime.getTime();

    const ours = computeNextShabbat({
      latitude: place!.latitude,
      longitude: place!.longitude,
      timezone: place!.timezone,
      inIsrael: place!.inIsrael,
      candleLightingMinutes: place!.candleDefault,
      from: FROM,
      cityName: place!.cityName,
    });
    expect(ours).not.toBeNull();
    expect(Math.abs(ours!.candleLighting.getTime() - hebcalTime)).toBeLessThanOrEqual(TWO_MINUTES_MS);
  });

  it("covers every shared city", () => {
    for (const key of Object.keys(HEBCAL_NAME)) expect(PLACES.some((p) => p.key === key)).toBe(true);
  });
});
