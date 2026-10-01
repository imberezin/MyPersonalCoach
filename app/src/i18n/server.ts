import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { DEFAULT_TIME_ZONE, LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "./config";

// Internationalization without a route prefix: the app is private, so the language comes
// from the user's preference (mirrored in a cookie), not from the URL.
//
// Built on `use-intl` (ICU message format, plurals, number/date formatting). It is the
// framework-agnostic core of `next-intl`, without the Next.js plugin, which needs a native
// SWC addon at config time and does not load on locked-down Windows profiles.

export const getLocale = cache(async (): Promise<Locale> => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(stored) ? stored : defaultLocale;
});

export const getMessages = cache(async (): Promise<AbstractIntlMessages> => {
  const locale = await getLocale();
  return (await import(`./messages/${locale}.json`)).default;
});

export type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Translator for Server Components, Server Actions and metadata.
 * Keys are plain strings (no generated message types yet), so the signature is explicit.
 */
export async function getTranslations(namespace?: string): Promise<Translator> {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const t = createTranslator({ locale, messages, namespace, timeZone: DEFAULT_TIME_ZONE });
  return (key, values) => t(key as never, values as never);
}
