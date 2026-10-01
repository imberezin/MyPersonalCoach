export const locales = ["he", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "he";

/** Until the profile's own time zone is passed in, dates are formatted for Israel. */
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";

/** Name of the cookie that mirrors `profiles.language` for fast access. */
export const LOCALE_COOKIE = "locale";

export const localeDirection: Record<Locale, "rtl" | "ltr"> = {
  he: "rtl",
  en: "ltr",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
