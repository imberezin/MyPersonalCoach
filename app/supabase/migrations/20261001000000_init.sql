-- Personal Eating Coach, Phase 1: initial schema.
--
-- Rules
--   * Every table has Row Level Security. A signed-in user (role "authenticated") sees only
--     rows where user_id = auth.uid(). The "anon" role has no access at all.
--   * Raw -> Understood -> Confirmed: meal_raw_inputs -> meal_understandings -> meal_entries.
--     Only meal_entries is ever counted in statistics.
--   * Tables written by the server (ai_requests, app_errors, notification_log, audit_log) give
--     the owner SELECT only. The server uses the service role, which bypasses RLS.
--   * Account deletion = delete the auth user. Every table cascades from auth.users.
--   * All timestamps are timestamptz (UTC). Rules run in the user's time zone (profiles.timezone).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile and preferences (one row per user, created automatically on sign-up)
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  age smallint check (age between 10 and 120),
  height_cm numeric(5, 1) check (height_cm between 80 and 250),
  goal_type text not null default 'none' check (goal_type in ('numeric', 'behavioral', 'none')),
  start_weight_kg numeric(5, 1) check (start_weight_kg between 20 and 500),
  goal_weight_kg numeric(5, 1) check (goal_weight_kg between 20 and 500),
  motivation text,
  language text not null default 'he' check (language in ('he', 'en')),
  timezone text not null default 'Asia/Jerusalem',
  city text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  in_israel boolean,
  -- Minutes before sunset. Confirmed by the user; the default depends on the place.
  candle_lighting_minutes smallint check (candle_lighting_minutes between 0 and 90),
  kashrut jsonb not null default '{}'::jsonb,
  food_preferences jsonb not null default '{}'::jsonb,
  activity_preferences jsonb not null default '{}'::jsonb,
  lifecycle_state text not null default 'NEW'
    check (lifecycle_state in ('NEW', 'ONBOARDING', 'FIRST_WEEK', 'WEEKLY_CYCLE')),
  onboarding_completed_at timestamptz,
  first_week_started_at timestamptz,
  first_week_ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- The system must not assume every notification type is wanted: all start off.
  notifications jsonb not null default
    '{"coach": false, "meal_reporting": false, "activity": false, "weekly_weigh_in": false, "weekly_summary": false}'::jsonb,
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Offline periods (Shabbat and, later, holidays and custom periods)
-- ---------------------------------------------------------------------------

create table public.offline_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('SHABBAT', 'HOLIDAY', 'USER_DEFINED', 'VACATION')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  -- Inputs used to compute the period (city, candle-lighting minutes), for transparency.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  unique (user_id, type, start_at)
);
create index offline_periods_user_start on public.offline_periods (user_id, start_at);

-- ---------------------------------------------------------------------------
-- Meals: raw input -> AI understanding -> confirmed entry
-- ---------------------------------------------------------------------------

create table public.meal_raw_inputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('photo', 'text', 'voice', 'shabbat_freeform')),
  text_content text,
  transcript text,
  -- Only set when a photo had to be stored temporarily (large batches). Single photos are never stored.
  photo_ref text,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index meal_raw_inputs_user_recorded on public.meal_raw_inputs (user_id, recorded_at desc);

create table public.meal_understandings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  raw_input_id uuid not null references public.meal_raw_inputs (id) on delete cascade,
  provider text not null,
  model text,
  prompt_version text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  -- Parts the AI could not understand. Shown as missing; never invented.
  unclear jsonb not null default '[]'::jsonb check (jsonb_typeof(unclear) = 'array'),
  overall_confidence numeric(3, 2) check (overall_confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'edited', 'rejected')),
  created_at timestamptz not null default now()
);
create index meal_understandings_raw on public.meal_understandings (raw_input_id);

-- Confirmed data only. This is the single source for every statistic.
create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  understanding_id uuid references public.meal_understandings (id) on delete set null,
  occurred_at timestamptz not null,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  -- Who made it true: the AI result accepted as is, the AI result after the user edited it, or typed by hand.
  source text not null check (source in ('ai_unedited', 'ai_edited', 'user_manual')),
  -- True for meals reconstructed from an aggregated report (Motzei Shabbat).
  aggregated boolean not null default false,
  offline_period_id uuid references public.offline_periods (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_entries_user_occurred on public.meal_entries (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Other manual reports
-- ---------------------------------------------------------------------------

create table public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weight_kg numeric(5, 2) not null check (weight_kg > 20 and weight_kg < 500),
  measured_at timestamptz not null default now(),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create index weight_entries_user_measured on public.weight_entries (user_id, measured_at desc);

create table public.activity_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  activity_type text not null check (activity_type in ('walking', 'workout', 'other')),
  duration_min integer not null check (duration_min > 0 and duration_min <= 1440),
  occurred_at timestamptz not null default now(),
  -- 'manual' in Phase 1. Apple Health / Health Connect are future sources.
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create index activity_entries_user_occurred on public.activity_entries (user_id, occurred_at desc);

create table public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  night_date date not null,
  hours numeric(3, 1) check (hours >= 0 and hours <= 24),
  quality smallint check (quality between 1 and 4),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (user_id, night_date)
);

create table public.stress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  level smallint not null check (level between 1 and 5),
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index stress_entries_user_occurred on public.stress_entries (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Events: product analytics and Behavior Engine input. No content, only ids/enums/counts.
-- ---------------------------------------------------------------------------

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index events_user_occurred on public.events (user_id, occurred_at desc);
create index events_user_name on public.events (user_id, name);

-- ---------------------------------------------------------------------------
-- Learning: patterns, interventions, experiments, weekly summaries
-- ---------------------------------------------------------------------------

create table public.patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  -- An observation is not a pattern: status moves up only with evidence (see domain/patternLifecycle).
  status text not null default 'OBSERVATION' check (status in ('OBSERVATION', 'CANDIDATE', 'VALIDATED', 'REJECTED')),
  user_feedback text check (user_feedback in ('confirm', 'unsure', 'reject')),
  first_seen_at timestamptz not null default now(),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table public.pattern_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pattern_id uuid not null references public.patterns (id) on delete cascade,
  observed_at timestamptz not null,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now()
);
create index pattern_evidence_pattern on public.pattern_evidence (pattern_id, observed_at);

create table public.intervention_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intervention_key text not null,
  variant text not null,
  level smallint not null check (level between 1 and 3),
  context text check (context in ('TRUE_HUNGER', 'STRESS', 'FATIGUE', 'CRAVING', 'SOCIAL', 'ENVIRONMENT', 'HABIT', 'UNCLEAR')),
  eating_phase text check (eating_phase in ('BEFORE_EATING', 'DURING_EATING', 'ANY')),
  -- Only proactive interventions count against the daily budget.
  proactive boolean not null,
  shown_at timestamptz not null default now(),
  -- Two separate fields: eating after an intervention is not a failure.
  helpfulness text check (helpfulness in ('HELPFUL', 'SOMEWHAT', 'NOT_REALLY', 'UNKNOWN')),
  continued_eating text check (continued_eating in ('YES', 'NO', 'UNKNOWN')),
  outcome_at timestamptz,
  created_at timestamptz not null default now()
);
create index intervention_instances_user_shown on public.intervention_instances (user_id, shown_at desc);

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_pattern_id uuid references public.patterns (id) on delete set null,
  intervention_key text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DONE', 'SKIPPED')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  helpfulness text check (helpfulness in ('HELPFUL', 'SOMEWHAT', 'NOT_REALLY', 'UNKNOWN')),
  tried text check (tried in ('YES', 'NO')),
  created_at timestamptz not null default now()
);
-- At most one active experiment per user.
create unique index experiments_one_active on public.experiments (user_id) where status = 'ACTIVE';

create table public.weekly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start date not null,
  opening_mode text not null check (opening_mode in ('CELEBRATE', 'LEARN', 'RECOVER', 'RESET')),
  content jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  viewed_at timestamptz,
  unique (user_id, week_start)
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Written by the server only (owner can read)
-- ---------------------------------------------------------------------------

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null check (channel in ('web_push', 'home_card')),
  intervention_instance_id uuid references public.intervention_instances (id) on delete set null,
  sent_at timestamptz not null default now(),
  -- Why nothing was sent (offline, budget, quiet hours, ...). Null when it was sent.
  suppressed_reason text
);
create index notification_log_user_sent on public.notification_log (user_id, sent_at desc);

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null,
  provider text not null,
  model text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  outcome text not null check (outcome in ('ok', 'invalid_output', 'error', 'timeout')),
  created_at timestamptz not null default now()
);
create index ai_requests_user_created on public.ai_requests (user_id, created_at desc);

create table public.app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  area text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default now()
);
create index audit_log_user_at on public.audit_log (user_id, at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meal_entries
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.patterns
  for each row execute function public.set_updated_at();

-- A profile and a preferences row are created for every new auth user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Audit trail for edits and deletions of confirmed data.
create function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- When the whole account is being deleted the auth row is already gone: log nothing,
    -- so deleting an account leaves no trace behind.
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      insert into public.audit_log (user_id, table_name, row_id, action, old_data)
      values (old.user_id, tg_table_name, old.id::text, 'DELETE', to_jsonb(old));
    end if;
    return old;
  end if;

  insert into public.audit_log (user_id, table_name, row_id, action, old_data, new_data)
  values (old.user_id, tg_table_name, old.id::text, 'UPDATE', to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

create trigger audit_meal_entries after update or delete on public.meal_entries
  for each row execute function public.audit_changes();
create trigger audit_weight_entries after update or delete on public.weight_entries
  for each row execute function public.audit_changes();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.audit_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

-- Owner reads and writes their own rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'offline_periods',
    'meal_raw_inputs', 'meal_understandings', 'meal_entries',
    'weight_entries', 'activity_entries', 'sleep_entries', 'stress_entries',
    'patterns', 'pattern_evidence', 'intervention_instances', 'experiments',
    'weekly_summaries', 'push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Events are append-only for the owner.
alter table public.events enable row level security;
create policy "own rows read" on public.events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows insert" on public.events for insert to authenticated
  with check (user_id = (select auth.uid()));
grant select, insert on public.events to authenticated;

-- Written by the server only: the owner can read, nobody but the service role can write.
do $$
declare
  t text;
begin
  foreach t in array array['notification_log', 'ai_requests', 'app_errors', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows read" on public.%I for select to authenticated '
      'using (user_id = (select auth.uid()))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- The service role bypasses RLS; it still needs table privileges.
grant all on all tables in schema public to service_role;
