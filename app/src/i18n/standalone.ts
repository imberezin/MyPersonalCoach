import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { DEFAULT_TIME_ZONE, defaultLocale, isLocale, type Locale } from "./config";
import en from "./messages/en.json";
import he from "./messages/he.json";
import type { Translator } from "./server";

/**
 * A translator that needs no request: it takes the language as an argument. `getTranslations` in ./server.ts reads the locale
 * cookie through `next/headers`, so outside a request (the cron route that sends a push, a script) it can only ever answer in
 * the default language. This one answers in the language of the person it is for, and never touches cookies or headers.
 * An unknown language is Hebrew, the same fallback as everywhere else.
 */
// Typed loosely on purpose, like getMessages in ./server.ts: the keys are plain strings (no generated message types).
const CATALOGS: Record<Locale, AbstractIntlMessages> = { he, en };

export function standaloneTranslator(language: unknown, namespace?: string): { locale: Locale; t: Translator } {
  const locale = isLocale(language) ? language : defaultLocale;
  const translate = createTranslator({ locale, messages: CATALOGS[locale], namespace, timeZone: DEFAULT_TIME_ZONE });
  return { locale, t: (key, values) => translate(key as never, values as never) };
}
