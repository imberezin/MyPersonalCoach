"use client";

import type { ReactNode } from "react";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { DEFAULT_TIME_ZONE } from "./config";

/** Makes `useTranslations()` and `useFormatter()` available to Client Components. */
export function IntlClientProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={DEFAULT_TIME_ZONE}>
      {children}
    </IntlProvider>
  );
}
