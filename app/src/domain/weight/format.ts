import { resolveTimeZone } from "../time";
import { measuredAtForDay } from "./entry";
import { parseDayKey } from "./trend";

/** Number and date formatting for the weight screens. Intl only; pure. Never throws: an unknown locale falls back to English. */

const FALLBACK_LOCALE = "en";

function safeLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale])[0] ?? FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

const isEnglish = (locale: string): boolean => locale.toLowerCase().split(/[-_]/)[0] === "en";

/** One decimal always ("118.0", "118.7"), grouping off, so a number never gains a separator inside a sentence. */
export function formatKg(kg: number, locale: string): string {
  return new Intl.NumberFormat(safeLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(kg);
}

function formatDate(instant: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  if (Number.isNaN(instant.getTime())) return "";
  const resolved = safeLocale(locale);
  if (!isEnglish(resolved)) return new Intl.DateTimeFormat(resolved, options).format(instant);

  // English is composed from its parts as "Friday, 3 October" (day before month), whichever English the runtime defaults to.
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const dayAndMonth = `${get("day")} ${get("month")}`;
  const withYear = options.year ? `${dayAndMonth} ${get("year")}` : dayAndMonth;
  return options.weekday ? `${get("weekday")}, ${withYear}` : withYear;
}

/** "יום שישי, 3 באוקטובר" / "Friday, 3 October"; the year only when asked. The day is the local day in `timeZone`. */
export function formatDayLabel(a: { instant: Date; locale: string; timeZone: string; includeYear: boolean }): string {
  return formatDate(a.instant, a.locale, {
    timeZone: resolveTimeZone(a.timeZone),
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(a.includeYear ? { year: "numeric" } : {}),
  });
}

/** The same label for a "YYYY-MM-DD" option: the key is read as that local calendar day. An invalid key gives "". */
export function formatDayKeyLabel(dayKey: string, locale: string, timeZone: string, includeYear: boolean): string {
  return formatDayLabel({ instant: measuredAtForDay(dayKey, timeZone), locale, timeZone, includeYear });
}

/** "5 באוק׳" / "5 Oct": the week's first day. The date key is read as a calendar date, with no zone shift. An invalid key gives "". */
export function formatWeekLabel(weekStart: string, locale: string): string {
  const parts = parseDayKey(weekStart);
  if (!parts) return "";
  // Noon UTC read in UTC: the same calendar date everywhere.
  const instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return formatDate(instant, locale, { timeZone: "UTC", day: "numeric", month: "short" });
}
