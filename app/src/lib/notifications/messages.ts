import { WEEKLY_PUSH } from "@/domain/notifications";
import { localeDirection } from "@/i18n/config";
import { standaloneTranslator } from "@/i18n/standalone";
import type { PushMessage } from "./types";

/** Where a tap on the weekly summary push lands. A closed constant: the sender never takes a path from a request or a row. */
export const WEEKLY_PUSH_URL = "/week";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The weekly summary push, in the language of the person it is for. The words are `notifications.weeklySummary.*` (approved by the
 * owner on 2026-10-07, no number, no weight, no food, no name), separate keys from the Home card so the push and the card can be
 * changed apart. The title is always set, so the service worker's own fallback title (English) can never show.
 */
export function buildWeeklySummaryPush(input: { language: unknown; weekStart: string }): PushMessage {
  const { locale, t } = standaloneTranslator(input.language, "notifications.weeklySummary");
  return {
    title: t("title"),
    body: t("body"),
    url: WEEKLY_PUSH_URL,
    // One notification per week: a second push for the same week would replace the first on the lock screen instead of stacking.
    tag: DAY_KEY.test(input.weekStart) ? `${WEEKLY_PUSH.kind}-${input.weekStart}` : WEEKLY_PUSH.kind,
    lang: locale,
    dir: localeDirection[locale],
  };
}
