import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIRST_WEEK_LIMITS, FIRST_WEEK_SNOOZE, experimentCardSnoozed } from "@/domain/firstWeekFlow";
import { HOME_FEATURES, resolveTimeZone, type ActiveExperimentFact } from "@/domain/home";
import { localDayOf } from "@/domain/time";
import { loadActiveExperiment } from "./repo";

/**
 * What Home needs for the active-experiment card, read as the signed-in user (RLS applies, no admin client). Nothing here writes
 * and nothing calls the AI. Never throws: any error, throw or malformed answer is `null` (unknown = no card; Home stays calm and
 * its `degraded` note is not set). The caller reads this only for the WEEKLY_CYCLE lifecycle.
 *
 *  0. the switch (HOME_FEATURES.activeExperimentCard, ON since the owner's decision of 2026-10-05): when off, this is null with ZERO queries.
 *  1. one `limit 1` read of the ACTIVE row (loadActiveExperiment). No active experiment, or an unreadable one, is null and the
 *     snooze is not even read: most people pay one query.
 *  2. one read of the "Thanks" events since the start of the person's LOCAL day, newest first, at most
 *     FIRST_WEEK_LIMITS.snoozeQuery (it shares the First Week's event name, and the pure rule keeps only this card's). A failed
 *     read is null too: this card is optional, so a card hidden by a failed read is better than one that comes back after "Thanks".
 */
export async function loadActiveExperimentCard(
  supabase: SupabaseClient,
  userId: string,
  a: { timeZone: string; now: Date },
): Promise<ActiveExperimentFact | null> {
  try {
    if (!HOME_FEATURES.activeExperimentCard) return null;
    const timeZone = resolveTimeZone(a.timeZone);
    // Formatted first: an invalid instant throws here, before any query is built.
    const dayStart = localDayOf(a.now, timeZone).start.toISOString();

    const open = await loadActiveExperiment(supabase, userId);
    if (open === null) return null;

    const { data, error } = await supabase
      .from("events")
      .select("payload, occurred_at")
      .eq("user_id", userId)
      .eq("name", FIRST_WEEK_SNOOZE.event)
      .gte("occurred_at", dayStart)
      .order("occurred_at", { ascending: false })
      .limit(FIRST_WEEK_LIMITS.snoozeQuery);
    if (error) {
      console.error("Experiments: loading the card's snooze failed", error.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(data)) return null;

    const events: { card: unknown; occurredAt: Date }[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) continue;
      const { payload, occurred_at } = row as Record<string, unknown>;
      const occurredAt = typeof occurred_at === "string" ? new Date(occurred_at) : null;
      if (occurredAt === null || Number.isNaN(occurredAt.getTime())) continue;
      const card = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[FIRST_WEEK_SNOOZE.field] : undefined;
      events.push({ card, occurredAt });
    }
    if (experimentCardSnoozed({ events, now: a.now, timeZone })) return null;

    return { key: open.key, variantId: open.variantId, wording: open.wording, locale: open.locale };
  } catch {
    console.error("Experiments: loading the Home card threw");
    return null;
  }
}
