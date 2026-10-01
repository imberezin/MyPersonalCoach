-- Personal Eating Coach, Phase 1: default quiet hours 00:00-08:00 (decision of 2026-10-01).
--
-- Rules
--   * Additive on top of the earlier migrations, which are never edited.
--   * New users get the default through the sign-up trigger, which inserts a user_preferences row
--     with the column defaults.
--   * Existing rows that never had quiet hours (both columns null) get the default too. A row with
--     only one of the two columns set is left alone.
--   * The user can change or clear the values later; a NULL pair means "no quiet hours".
--   * src/domain/quietHours.ts holds the same values, and tests/db/quiet-hours.test.ts keeps them equal.

alter table public.user_preferences
  alter column quiet_hours_start set default time '00:00',
  alter column quiet_hours_end set default time '08:00';

update public.user_preferences
   set quiet_hours_start = time '00:00',
       quiet_hours_end = time '08:00'
 where quiet_hours_start is null
   and quiet_hours_end is null;
