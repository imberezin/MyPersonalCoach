import "server-only";
// @hebcal/core is GPL-2.0. It must only ever run on the server and must never be
// imported into a Client Component (`server-only` makes the build fail if it is).
// ESLint also restricts the import to this folder.
import { CandleLightingEvent, HavdalahEvent, Location, calendar } from "@hebcal/core";

export interface ShabbatInput {
  latitude: number;
  longitude: number;
  /** IANA time zone, for example "Asia/Jerusalem". */
  timezone: string;
  inIsrael: boolean;
  /** Minutes before sunset. Use `defaultCandleLightingMinutes` as the starting value. */
  candleLightingMinutes: number;
  /** The Shabbat returned is the first one whose Havdalah is after this instant. */
  from: Date;
  cityName?: string;
}

export interface ShabbatTimes {
  candleLighting: Date;
  havdalah: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Year, month (1-12) and day of an instant as seen in a time zone. */
function calendarDateInZone(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * Candle-lighting minutes before sunset by place, as in the Hebcal defaults:
 * Jerusalem 40, Haifa and Zikhron Ya'akov 30, elsewhere in Israel 20, outside Israel 18.
 * The user confirms the value; this is only the starting point.
 */
export function defaultCandleLightingMinutes(inIsrael: boolean, cityName?: string): number {
  if (!inIsrael) return 18;
  const city = (cityName ?? "").toLowerCase();
  if (city === "jerusalem") return 40;
  if (city === "haifa" || city.startsWith("zikhron")) return 30;
  return 20;
}

/** Candle lighting and Havdalah of the next (or current) Shabbat, or null if none is found. */
export function computeNextShabbat(input: ShabbatInput): ShabbatTimes | null {
  // The Location is built with il=false on purpose. Hebcal replaces an explicit 18 minutes by its
  // own city default when the Location itself is Israeli (calendar.js, overrideIsraelCandleMins),
  // which would silently ignore the minutes the user confirmed. The Israeli schedule is still
  // selected through `il` in the calendar() call below, and Havdalah does not depend on it.
  const location = new Location(input.latitude, input.longitude, false, input.timezone, input.cityName);

  // Hebcal reads calendar dates from local Date fields, so build local dates from the
  // calendar day the user is on, not from the UTC instant.
  const { y, m, d } = calendarDateInZone(input.from, input.timezone);
  const start = new Date(y, m - 1, d - 2);
  const end = new Date(y, m - 1, d + 10);

  const events = calendar({
    start,
    end,
    candlelighting: true,
    location,
    candleLightingMins: input.candleLightingMinutes,
    noHolidays: true,
    sedrot: false,
    il: input.inIsrael,
  });

  const fridayCandles = events.filter(
    (e): e is CandleLightingEvent => e instanceof CandleLightingEvent && e.getDate().greg().getDay() === 5,
  );
  const saturdayHavdalahs = events.filter(
    (e): e is HavdalahEvent => e instanceof HavdalahEvent && e.getDate().greg().getDay() === 6,
  );

  for (const candle of fridayCandles) {
    const havdalah = saturdayHavdalahs.find((h) => h.eventTime.getTime() > candle.eventTime.getTime());
    if (havdalah && havdalah.eventTime.getTime() > input.from.getTime()) {
      // Sanity: a Shabbat is a bit over a day long.
      if (havdalah.eventTime.getTime() - candle.eventTime.getTime() > 2 * DAY_MS) continue;
      return { candleLighting: candle.eventTime, havdalah: havdalah.eventTime };
    }
  }
  return null;
}
