// Imported by the weight component tests only. They render with the REAL catalogs, because the point of these
// screens is their words: a missing key must fail a test, not reach a phone.
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";

export type TestLocale = "he" | "en";
export const LOCALES: readonly TestLocale[] = ["he", "en"];
export const catalogs = { he, en } as const;

/** Wraps an element in the intl provider the client components need, with the real catalog. */
export function renderWithIntl(element: ReactElement, locale: TestLocale = "he"): string {
  // `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
  const props = { locale, messages: catalogs[locale] as AbstractIntlMessages, timeZone: "UTC" } as ComponentProps<typeof IntlProvider>;
  return renderToStaticMarkup(createElement(IntlProvider, props, element));
}

/** How many times a pattern matches. */
export const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

/** The visible text of a markup string: tags removed, entities for the apostrophes and quotes decoded. */
export function textOf(html: string): string {
  return html
    // React appends a small script to server-rendered forms; it is not copy.
    .replace(/<script[^]*?<\/script>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A tag's opening markup by an attribute it carries, for example the input named "weight". */
export function tagWith(html: string, tag: string, attribute: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>`);
  return pattern.exec(html)?.[0] ?? "";
}
