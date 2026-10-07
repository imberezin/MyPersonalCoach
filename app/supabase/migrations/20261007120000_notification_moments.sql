-- Personal Eating Coach, the weekly summary push sender (proposal of 2026-10-07; applied to the hosted project only by the owner).
--
-- Rules
--   * Additive on top of the applied files. They are never edited.
--   * No table, no function, no trigger. Two nullable columns and four constraints on the existing notification_log
--     (init.sql), so nothing here fires when the auth service deletes an account and the SECURITY DEFINER rule of the
--     earlier trigger migrations does not apply. Row Level Security and grants are unchanged: the owner can read their own
--     rows, and only the service role can write them (init.sql, "Written by the server only").
--   * Every existing row satisfies every constraint below: the table is empty on the hosted project today, and a row written
--     before this file would have both new columns null, which the pair check allows and the unique constraint ignores
--     (NULLs are distinct in a unique constraint).
--   * Nothing in the table can hold the text of a notification: the columns are a channel, a kind, a moment key, a reason code
--     and two timestamps.
--   * Plain SQL only.
--
-- How the sender uses it (src/lib/notify): a push is CLAIMED before it is sent, by inserting one row for (user, kind, moment).
-- The unique constraint makes the claim atomic, so a cron tick that fires twice, or two ticks that overlap, cannot send twice:
-- the second insert fails with 23505 and the sender treats that as "already done". The row starts with suppressed_reason =
-- 'pending' and is updated to null (sent), 'send_failed' or 'subscription_gone'. There is no automatic retry (at-most-once, the
-- owner's decision of 2026-10-07), so a row that stays 'pending' after a crash is visible and can be deleted by hand to allow a
-- new attempt. Reasons for NOT sending (offline, quiet hours, ...) are counted in the route's answer and are not stored.

-- 1. The kind is one of the five notification keys of user_preferences.notifications (the same five as
--    user_preferences_notifications_shape in 20261001120000_onboarding.sql; tests/db/notification-log.test.ts pins the equality).
-- 2. The moment is "weekly:" plus the local Sunday of the week the push is about (equal to weekly_summaries.week_start).
--    Both columns are set together or not at all, and the key stays short.
-- 3. One row per (user, kind, moment): the claim.
alter table public.notification_log
  add column kind text,
  add column moment_key text,
  add constraint notification_log_kind_known
    check (kind is null or kind in ('coach', 'meal_reporting', 'activity', 'weekly_weigh_in', 'weekly_summary')),
  add constraint notification_log_moment_pair
    check ((kind is null) = (moment_key is null)),
  add constraint notification_log_moment_key_length
    check (moment_key is null or char_length(moment_key) between 1 and 80),
  add constraint notification_log_one_per_moment
    unique (user_id, kind, moment_key);
