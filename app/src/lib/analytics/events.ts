/**
 * Product events (no content). They feed the success metrics in the Technology Stack
 * document, Appendix B. Add a name here before using it.
 */
export const ANALYTICS_EVENTS = [
  "meal_report_started",
  "meal_saved",
  "meal_corrected",
  "meal_report_discarded",
  "meal_ai_fallback",
  "meal_deleted",
  "activity_reported",
  "weight_reported",
  "weight_edited",
  "weight_deleted",
  "milestone_acknowledged",
  "difficult_moment_started",
  "intervention_shown",
  "intervention_completed",
  "intervention_helped",
  "experiment_started",
  "experiment_completed",
  "weekly_summary_viewed",
  "shabbat_started",
  "shabbat_report_completed",
  "recovery_returned",
  "first_week_completed",
  "first_week_card_snoozed",
  "early_signal_answered",
  "experiment_offered",
  "experiment_skipped",
  "experiment_wording_fallback",
  "weekly_card_snoozed",
  "pattern_question_answered",
  "weekly_line_wording_fallback",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Primitive values only: ids, enums, counts, durations. Never food, weights or free text. */
export type EventPayload = Record<string, string | number | boolean | null>;

const MAX_STRING_LENGTH = 64;

/** Guard against accidentally logging user content: long strings are rejected. */
export function assertNoContent(payload: EventPayload): void {
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      throw new Error(`Analytics payload "${key}" looks like content (longer than ${MAX_STRING_LENGTH} chars)`);
    }
  }
}
