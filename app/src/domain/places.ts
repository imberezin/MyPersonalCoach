/**
 * Curated places for the Shabbat times (onboarding step A9).
 *
 * Provenance: written by hand for this project. Every coordinate is a city-centre value rounded
 * to two decimals, taken from public geographic knowledge (a city's well-known position and its
 * IANA time zone). Nothing here was copied, converted or generated from Hebcal's location data
 * (cities.json), which is GPL-2.0; this file must stay free of it. The values are a starting
 * point and are not surveyed: the candle-lighting minutes are what the user confirms, and a
 * city two decimals off moves sunset by well under a minute.
 *
 * Display names are not stored here; they live in the message catalog (onboarding.places.<key>).
 * `cityName` is the English name that is saved in profiles.city.
 */
import { RANGES } from "./onboarding/model";

export interface Place {
  /** Stable id, saved in profiles.place_key. */
  key: string;
  /** English name, saved in profiles.city. */
  cityName: string;
  latitude: number;
  longitude: number;
  /** IANA time zone. */
  timezone: string;
  inIsrael: boolean;
  /** Minutes before sunset to start with. The user confirms or changes it. */
  candleDefault: 18 | 20 | 30 | 40;
}

const ISRAEL_ZONE = "Asia/Jerusalem";

/** Jerusalem 40, Haifa and Zikhron Ya'akov 30, elsewhere in Israel 20, abroad 18. */
function candleDefaultFor(key: string, inIsrael: boolean): Place["candleDefault"] {
  if (!inIsrael) return 18;
  if (key === "jerusalem") return 40;
  if (key === "haifa" || key === "zikhron_yaakov") return 30;
  return 20;
}

function place(key: string, cityName: string, latitude: number, longitude: number, timezone: string): Place {
  const inIsrael = timezone === ISRAEL_ZONE;
  return { key, cityName, latitude, longitude, timezone, inIsrael, candleDefault: candleDefaultFor(key, inIsrael) };
}

/** Israel first, then abroad; the picker groups by `inIsrael` and sorts by the displayed name. */
export const PLACES: readonly Place[] = [
  place("jerusalem", "Jerusalem", 31.77, 35.21, ISRAEL_ZONE),
  place("tel_aviv", "Tel Aviv", 32.08, 34.78, ISRAEL_ZONE),
  place("haifa", "Haifa", 32.79, 34.99, ISRAEL_ZONE),
  place("beer_sheva", "Beer Sheva", 31.25, 34.79, ISRAEL_ZONE),
  place("eilat", "Eilat", 29.56, 34.95, ISRAEL_ZONE),
  place("tiberias", "Tiberias", 32.79, 35.53, ISRAEL_ZONE),
  place("petah_tikva", "Petah Tikva", 32.09, 34.89, ISRAEL_ZONE),
  place("ashdod", "Ashdod", 31.8, 34.65, ISRAEL_ZONE),
  place("zikhron_yaakov", "Zikhron Ya'akov", 32.57, 34.95, ISRAEL_ZONE),
  place("netanya", "Netanya", 32.33, 34.86, ISRAEL_ZONE),
  place("rishon_lezion", "Rishon LeZion", 31.97, 34.8, ISRAEL_ZONE),
  place("ashkelon", "Ashkelon", 31.67, 34.57, ISRAEL_ZONE),
  place("rehovot", "Rehovot", 31.89, 34.81, ISRAEL_ZONE),
  place("holon", "Holon", 32.01, 34.77, ISRAEL_ZONE),
  place("bat_yam", "Bat Yam", 32.02, 34.75, ISRAEL_ZONE),
  place("bnei_brak", "Bnei Brak", 32.08, 34.83, ISRAEL_ZONE),
  place("ramat_gan", "Ramat Gan", 32.07, 34.82, ISRAEL_ZONE),
  place("herzliya", "Herzliya", 32.16, 34.84, ISRAEL_ZONE),
  place("raanana", "Ra'anana", 32.18, 34.87, ISRAEL_ZONE),
  place("kfar_saba", "Kfar Saba", 32.18, 34.91, ISRAEL_ZONE),
  place("rosh_haayin", "Rosh HaAyin", 32.1, 34.96, ISRAEL_ZONE),
  place("hadera", "Hadera", 32.44, 34.92, ISRAEL_ZONE),
  place("lod", "Lod", 31.95, 34.89, ISRAEL_ZONE),
  place("ramla", "Ramla", 31.93, 34.87, ISRAEL_ZONE),
  place("modiin", "Modi'in", 31.9, 35.01, ISRAEL_ZONE),
  place("beit_shemesh", "Beit Shemesh", 31.75, 34.99, ISRAEL_ZONE),
  place("kiryat_gat", "Kiryat Gat", 31.61, 34.76, ISRAEL_ZONE),
  place("netivot", "Netivot", 31.42, 34.59, ISRAEL_ZONE),
  place("sderot", "Sderot", 31.52, 34.6, ISRAEL_ZONE),
  place("dimona", "Dimona", 31.07, 35.03, ISRAEL_ZONE),
  place("arad", "Arad", 31.26, 35.21, ISRAEL_ZONE),
  place("mitzpe_ramon", "Mitzpe Ramon", 30.61, 34.8, ISRAEL_ZONE),
  place("afula", "Afula", 32.61, 35.29, ISRAEL_ZONE),
  place("nazareth", "Nazareth", 32.7, 35.3, ISRAEL_ZONE),
  place("karmiel", "Karmiel", 32.92, 35.3, ISRAEL_ZONE),
  place("akko", "Akko", 32.93, 35.08, ISRAEL_ZONE),
  place("nahariya", "Nahariya", 33.01, 35.09, ISRAEL_ZONE),
  place("safed", "Safed", 32.96, 35.5, ISRAEL_ZONE),
  place("kiryat_shmona", "Kiryat Shmona", 33.21, 35.57, ISRAEL_ZONE),

  place("new_york", "New York", 40.71, -74.01, "America/New_York"),
  place("boston", "Boston", 42.36, -71.06, "America/New_York"),
  place("miami", "Miami", 25.76, -80.19, "America/New_York"),
  place("chicago", "Chicago", 41.88, -87.63, "America/Chicago"),
  place("los_angeles", "Los Angeles", 34.05, -118.24, "America/Los_Angeles"),
  place("toronto", "Toronto", 43.65, -79.38, "America/Toronto"),
  place("montreal", "Montreal", 45.5, -73.57, "America/Toronto"),
  place("buenos_aires", "Buenos Aires", -34.6, -58.38, "America/Argentina/Buenos_Aires"),
  place("sao_paulo", "Sao Paulo", -23.55, -46.63, "America/Sao_Paulo"),
  place("london", "London", 51.51, -0.13, "Europe/London"),
  place("manchester", "Manchester", 53.48, -2.24, "Europe/London"),
  place("paris", "Paris", 48.86, 2.35, "Europe/Paris"),
  place("antwerp", "Antwerp", 51.22, 4.4, "Europe/Brussels"),
  place("berlin", "Berlin", 52.52, 13.4, "Europe/Berlin"),
  place("moscow", "Moscow", 55.76, 37.62, "Europe/Moscow"),
  place("johannesburg", "Johannesburg", -26.2, 28.05, "Africa/Johannesburg"),
  place("sydney", "Sydney", -33.87, 151.21, "Australia/Sydney"),
  place("melbourne", "Melbourne", -37.81, 144.96, "Australia/Melbourne"),
];

// A Map, not an object lookup: a key such as "constructor" must not resolve to anything.
const BY_KEY: ReadonlyMap<string, Place> = new Map(PLACES.map((p) => [p.key, p]));

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function getPlace(key: string): Place | undefined {
  return BY_KEY.get(key);
}

export type ShabbatChoice =
  | { ok: true; place: Place; candleMinutes: number }
  | { ok: false; code: "place_required" | "unknown_place" | "out_of_range" };

/**
 * Checks the A9 answer: a place from the list and the confirmed minutes before sunset.
 * Missing minutes mean "use the place's default"; present minutes must be a whole number in range.
 */
export function validateShabbatChoice(placeKey: unknown, candleMinutes: number | null | undefined): ShabbatChoice {
  if (placeKey === undefined || placeKey === null || (typeof placeKey === "string" && placeKey.trim() === "")) {
    return { ok: false, code: "place_required" };
  }
  if (typeof placeKey !== "string" || !KEY_PATTERN.test(placeKey)) return { ok: false, code: "unknown_place" };

  const found = getPlace(placeKey);
  if (!found) return { ok: false, code: "unknown_place" };

  if (candleMinutes === null || candleMinutes === undefined) {
    return { ok: true, place: found, candleMinutes: found.candleDefault };
  }
  const { min, max } = RANGES.candleMinutes;
  if (!Number.isInteger(candleMinutes) || candleMinutes < min || candleMinutes > max) {
    return { ok: false, code: "out_of_range" };
  }
  return { ok: true, place: found, candleMinutes };
}
