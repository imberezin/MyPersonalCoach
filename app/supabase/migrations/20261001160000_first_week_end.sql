-- Personal Eating Coach, Phase 1: First Week ending (B6).
-- Rules: additive; the applied files are never edited; no table, no column, RLS unchanged.
-- Every existing row satisfies the CHECK (nothing ever set WEEKLY_CYCLE; the hosted account is FIRST_WEEK
-- with first_week_ended_at null). Plain SQL only.
alter table public.profiles
  add constraint profiles_weekly_cycle_has_end
    check (lifecycle_state <> 'WEEKLY_CYCLE' or first_week_ended_at is not null);
