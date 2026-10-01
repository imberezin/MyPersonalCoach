-- Personal Eating Coach, Phase 1: onboarding (screens A1-A12).
--
-- Rules
--   * Additive on top of 20261001000000_init.sql. The applied init file is never edited.
--   * No new table, so Row Level Security is unchanged: the "own rows" policy on profiles,
--     user_preferences, offline_periods and push_subscriptions already covers every new column.
--   * Every existing row (a NEW profile with defaults) satisfies every new CHECK.
--   * The function runs as the caller (SECURITY INVOKER), so RLS applies inside it. Real Supabase
--     grants EXECUTE on new functions to anon by default and PGlite cannot show that, so it is
--     revoked explicitly.
--   * Plain SQL only: no extensions, no CONCURRENTLY, no roles outside anon/authenticated/service_role.

-- ---------------------------------------------------------------------------
-- profiles: what onboarding stores
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- A2 is a multi-select; goal_type stays the single derived classification.
  add column goal_focus text[] not null default '{}'::text[],
  -- Last onboarding step completed or skipped. Lets the user resume exactly where they stopped.
  add column onboarding_step text,
  -- A9: null = not answered yet, false = said no, true = observes Shabbat.
  add column observes_shabbat boolean,
  -- A9 "other times": interest only. Custom periods are a later phase.
  add column wants_other_offline boolean not null default false,
  -- A9: key of the chosen place in the app's curated list. Null until chosen.
  add column place_key text;

alter table public.profiles
  add constraint profiles_goal_focus_valid
    check (goal_focus <@ array['lose_weight', 'feel_lighter', 'improve_eating', 'be_active', 'understand_overeating', 'not_sure']::text[]),
  add constraint profiles_goal_focus_not_sure_alone
    check (not ('not_sure' = any (goal_focus)) or cardinality(goal_focus) = 1),
  -- A numeric goal exists exactly when there is a goal weight, so a stale number never drives milestones.
  add constraint profiles_goal_type_matches_weight
    check ((goal_type = 'numeric') = (goal_weight_kg is not null)),
  add constraint profiles_onboarding_step_valid
    check (onboarding_step is null or onboarding_step in (
      'welcome', 'goals', 'weight', 'goal-weight', 'about-you', 'movement', 'food',
      'kashrut', 'offline', 'why', 'notifications', 'ready')),
  -- A user who observes Shabbat has a place, coordinates and confirmed minutes.
  add constraint profiles_shabbat_needs_place
    check (observes_shabbat is not true
           or (place_key is not null and candle_lighting_minutes is not null
               and latitude is not null and longitude is not null and in_israel is not null)),
  -- FIRST_WEEK and later only exist after onboarding finished.
  add constraint profiles_lifecycle_timestamps
    check (lifecycle_state in ('NEW', 'ONBOARDING')
           or (onboarding_completed_at is not null and first_week_started_at is not null)),
  add constraint profiles_motivation_length
    check (motivation is null or char_length(motivation) <= 2000),
  add constraint profiles_place_key_length
    check (place_key is null or char_length(place_key) <= 64),
  -- The three preference columns are bounded objects, never arrays or scalars.
  add constraint profiles_preferences_shape
    check (jsonb_typeof(kashrut) = 'object' and octet_length(kashrut::text) <= 8192
       and jsonb_typeof(food_preferences) = 'object' and octet_length(food_preferences::text) <= 8192
       and jsonb_typeof(activity_preferences) = 'object' and octet_length(activity_preferences::text) <= 8192),
  -- A6: the baseline answer is one of the five options when present.
  add constraint profiles_activity_baseline_valid
    check (activity_preferences ->> 'baseline' is null
           or activity_preferences ->> 'baseline' in ('almost_none', 'some_walking', 'active_part_of_week', 'active_most_of_week', 'varies'));

-- ---------------------------------------------------------------------------
-- user_preferences: PostgREST replaces a jsonb column wholesale, so keep all five keys.
-- coalesce(...) is required: a missing key gives NULL, and a NULL check result would pass.
-- ---------------------------------------------------------------------------

alter table public.user_preferences
  add constraint user_preferences_notifications_shape
    check (jsonb_typeof(notifications) = 'object'
       and coalesce(jsonb_typeof(notifications -> 'coach') = 'boolean', false)
       and coalesce(jsonb_typeof(notifications -> 'meal_reporting') = 'boolean', false)
       and coalesce(jsonb_typeof(notifications -> 'activity') = 'boolean', false)
       and coalesce(jsonb_typeof(notifications -> 'weekly_weigh_in') = 'boolean', false)
       and coalesce(jsonb_typeof(notifications -> 'weekly_summary') = 'boolean', false));

-- ---------------------------------------------------------------------------
-- push_subscriptions: the table accepted empty endpoints and keys. NOT VALID checks new rows only.
-- ---------------------------------------------------------------------------

alter table public.push_subscriptions
  add constraint push_subscriptions_shape
    check (endpoint ~ '^https://' and char_length(endpoint) <= 2048
       and char_length(p256dh) > 0 and char_length(auth) > 0) not valid;

-- ---------------------------------------------------------------------------
-- A9: replace the caller's upcoming automatic Shabbat periods in one transaction.
-- The unique key includes start_at, so changing the city or the candle-lighting minutes would
-- otherwise leave overlapping rows. Past periods and manual periods are never touched.
-- p_rows: [{"start_at": "...", "end_at": "...", "metadata": {...}}, ...]. An empty array clears.
-- ---------------------------------------------------------------------------

create function public.replace_future_auto_shabbat(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 60 then
    raise exception 'p_rows must be a json array of at most 60 items' using errcode = '22023';
  end if;

  delete from public.offline_periods
   where user_id = v_uid and type = 'SHABBAT' and source = 'auto' and end_at > now();

  insert into public.offline_periods (user_id, type, start_at, end_at, source, metadata)
  select v_uid, 'SHABBAT', r.start_at, r.end_at, 'auto', coalesce(r.metadata, '{}'::jsonb)
    from jsonb_to_recordset(p_rows) as r (start_at timestamptz, end_at timestamptz, metadata jsonb)
  on conflict (user_id, type, start_at) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.replace_future_auto_shabbat(jsonb) from public, anon;
grant execute on function public.replace_future_auto_shabbat(jsonb) to authenticated;
