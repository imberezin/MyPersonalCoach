import type { NotificationsJson } from "../onboarding/model";

/**
 * The five kinds of notification a person can switch on (user_preferences.notifications, always all five keys). The same
 * list is the CHECK on notification_log.kind in the migration that adds it; tests/db/notification-log.test.ts pins the equality.
 */
export const NOTIFICATION_KINDS = ["coach", "meal_reporting", "activity", "weekly_weigh_in", "weekly_summary"] as const satisfies readonly (keyof NotificationsJson)[];
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// A new key in NotificationsJson that is missing from NOTIFICATION_KINDS is a compile error here.
type MissingKinds = Exclude<keyof NotificationsJson, NotificationKind>;
const allKindsListed: [MissingKinds] extends [never] ? true : never = true;
void allKindsListed;

/** The weekly summary push: the only notification the sender knows so far (decisions of 2026-10-07, TODO.md section 4). */
export const WEEKLY_PUSH = {
  kind: "weekly_summary",
  /** Owner's decision: this push is NOT one of the daily proactive interventions, so it never uses (or blocks) that slot. */
  countsTowardDailyBudget: false,
  /** notification_log.moment_key is this prefix plus the week's local Sunday (equal to weekly_summaries.week_start). */
  momentPrefix: "weekly:",
} as const satisfies { kind: NotificationKind; countsTowardDailyBudget: boolean; momentPrefix: string };

/**
 * Why no push is sent. Fixed phrases: they are the keys of the counts the route answers with, so they never carry a user id,
 * an endpoint or any text. A TypeScript constant, not a database CHECK, so a new reason never needs a migration.
 */
export const WEEKLY_PUSH_SKIP_REASONS = [
  "invalid_input",
  "not_weekly_cycle",
  "preference_unknown",
  "preference_off",
  "no_moment",
  "card_closed",
  "offline_unknown",
  "offline",
  "already_claimed",
  "quiet_hours_unknown",
  "quiet_hours",
  "no_subscription",
] as const;
export type WeeklyPushSkipReason = (typeof WEEKLY_PUSH_SKIP_REASONS)[number];
