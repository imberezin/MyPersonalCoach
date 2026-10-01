-- Personal Eating Coach, Phase 1: Report + Food (screens D1-D8).
--
-- Rules
--   * Additive on top of the applied files. They are never edited.
--   * No new table, so Row Level Security is unchanged: the "own rows" policies on meal_raw_inputs,
--     meal_understandings and meal_entries already cover every new column.
--   * Every existing row satisfies every new CHECK (the tables are empty for the hosted user, and the
--     RLS test inserts a meal_entries row with one item and no understanding, which still passes).
--   * The functions run as the caller (SECURITY INVOKER), so RLS applies inside them. Real Supabase
--     grants EXECUTE on new functions to anon by default and PGlite cannot show that, so it is
--     revoked explicitly.
--   * Plain SQL only: no extensions, no CONCURRENTLY, no roles outside anon/authenticated/service_role.
--   * There is deliberately no time-dependent CHECK (occurred_at <= now()): it breaks restores and
--     later edits. The app validates the time window.

-- ---------------------------------------------------------------------------
-- meal_raw_inputs: retry de-duplication and two privacy invariants
-- ---------------------------------------------------------------------------

alter table public.meal_raw_inputs
  -- Chosen by the browser; the same id for a retry of the same input, so a retry never makes a second report.
  add column client_request_id uuid,
  add constraint meal_raw_inputs_text_length
    check (text_content is null or char_length(text_content) <= 600),
  -- A single photo is never stored. Large Shabbat batches will use another kind.
  add constraint meal_raw_inputs_photo_not_stored
    check (kind <> 'photo' or photo_ref is null);

create unique index meal_raw_inputs_client_request
  on public.meal_raw_inputs (user_id, client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- meal_understandings: the proposal and the user's working copy
-- ---------------------------------------------------------------------------

alter table public.meal_understandings
  -- The meal type and time the app resolved from the AI's hints. The AI's own answer is never edited.
  add column proposed_meal_type text check (proposed_meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  add column proposed_occurred_at timestamptz,
  -- The user's edits until they confirm; cleared at confirm. Kept apart so the AI original survives
  -- for the correction-rate metric.
  add column draft jsonb,
  add constraint meal_understandings_items_size
    check (jsonb_array_length(items) <= 30 and octet_length(items::text) <= 16384),
  add constraint meal_understandings_unclear_size
    check (jsonb_array_length(unclear) <= 10 and octet_length(unclear::text) <= 4096),
  add constraint meal_understandings_draft_shape
    check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 16384));

-- ---------------------------------------------------------------------------
-- meal_entries: one entry per understanding, bounded items
-- ---------------------------------------------------------------------------

create unique index meal_entries_one_per_understanding
  on public.meal_entries (understanding_id) where understanding_id is not null;

alter table public.meal_entries
  add constraint meal_entries_items_size
    check (jsonb_array_length(items) between 1 and 30 and octet_length(items::text) <= 16384);

-- ---------------------------------------------------------------------------
-- create_meal_understanding: the raw input and its pending understanding, in one transaction.
-- Idempotent per p_request_id. Also removes the caller's own stale pending reports (older than
-- 24 hours) so an abandoned report does not linger: the stale rows are locked first with
-- SKIP LOCKED, so a report that is being confirmed right now holds its lock and survives.
-- ---------------------------------------------------------------------------

create function public.create_meal_understanding(
  p_request_id uuid,
  p_kind text,
  p_text text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_items jsonb,
  p_unclear jsonb,
  p_overall numeric,
  p_meal_type text,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_stale uuid[];
  v_raw uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_kind is null or p_kind not in ('photo', 'text') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;

  -- A retry of a request that already produced a report returns that report.
  if p_request_id is not null then
    select u.id into v_id
      from public.meal_raw_inputs r
      join public.meal_understandings u on u.raw_input_id = r.id
     where r.user_id = v_uid and r.client_request_id = p_request_id
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Lazy cleanup, race-safe: lock the stale pending understandings first (FOR UPDATE cannot sit in
  -- the same query level as an aggregate, hence the inner select), then delete only the raw inputs
  -- whose understandings are ALL among the locked ones.
  select array_agg(s.id) into v_stale
    from (
      select u.id
        from public.meal_understandings u
       where u.user_id = v_uid and u.status = 'pending' and u.created_at < now() - interval '24 hours'
         for update skip locked
    ) s;

  if v_stale is not null then
    delete from public.meal_raw_inputs r
     where r.user_id = v_uid
       and exists (select 1 from public.meal_understandings u where u.raw_input_id = r.id)
       and not exists (select 1 from public.meal_understandings u where u.raw_input_id = r.id and not (u.id = any (v_stale)));
  end if;

  begin
    insert into public.meal_raw_inputs (user_id, kind, text_content, occurred_at, client_request_id)
    values (v_uid, p_kind, p_text, coalesce(p_occurred_at, now()), p_request_id)
    returning id into v_raw;
  exception when unique_violation then
    -- A concurrent twin with the same request id won: return its report.
    select u.id into v_id
      from public.meal_raw_inputs r
      join public.meal_understandings u on u.raw_input_id = r.id
     where r.user_id = v_uid and r.client_request_id = p_request_id
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
    raise;
  end;

  insert into public.meal_understandings (
    user_id, raw_input_id, provider, model, prompt_version, items, unclear, overall_confidence,
    proposed_meal_type, proposed_occurred_at
  )
  values (
    v_uid, v_raw, p_provider, p_model, p_prompt_version, coalesce(p_items, '[]'::jsonb), coalesce(p_unclear, '[]'::jsonb), p_overall,
    p_meal_type, p_occurred_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_meal_understanding: the only way an understanding becomes a meal entry. Atomic and
-- idempotent: a second call returns the same entry. The lock serialises it with a concurrent
-- discard (see discard_meal_understanding).
-- ---------------------------------------------------------------------------

create function public.confirm_meal_understanding(
  p_id uuid,
  p_occurred_at timestamptz,
  p_meal_type text,
  p_items jsonb,
  p_source text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_u public.meal_understandings%rowtype;
  v_entry uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_u
    from public.meal_understandings
   where id = p_id and user_id = v_uid
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Already confirmed: hand back the entry it made.
  if v_u.status in ('accepted', 'edited') then
    select e.id into v_entry from public.meal_entries e where e.understanding_id = v_u.id and e.user_id = v_uid limit 1;
    if v_entry is not null then
      return v_entry;
    end if;
  end if;
  if v_u.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  -- A manual list is always user_manual, and user_manual is only for a manual list.
  if p_source is null
     or p_source not in ('ai_unedited', 'ai_edited', 'user_manual')
     or ((v_u.provider = 'manual') <> (p_source = 'user_manual')) then
    raise exception 'bad_source' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'bad_items' using errcode = '22023';
  end if;

  insert into public.meal_entries (user_id, understanding_id, occurred_at, meal_type, items, source)
  values (v_uid, v_u.id, p_occurred_at, p_meal_type, p_items, p_source)
  returning id into v_entry;

  update public.meal_understandings
     set status = case when p_source = 'ai_edited' then 'edited' else 'accepted' end,
         draft = null
   where id = v_u.id;

  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- discard_meal_understanding: deletes a PENDING report and its raw text. Lock first, then delete.
-- Confirm locks the understanding with FOR UPDATE, so a concurrent confirm and discard serialise.
-- Discard first: confirm finds no row (not_found). Confirm first: discard waits, re-checks
-- status = 'pending' against the committed row, finds 'accepted' and returns false. Without the lock a
-- discard could delete the raw input while a confirm was committing, and the cascade would remove an
-- understanding that had just been accepted. Confirmed data is never touched.
-- ---------------------------------------------------------------------------

create function public.discard_meal_understanding(p_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select u.raw_input_id into v_raw
    from public.meal_understandings u
   where u.id = p_id and u.user_id = v_uid and u.status = 'pending'
     for update;
  if not found then
    return false;
  end if;

  delete from public.meal_raw_inputs where id = v_raw and user_id = v_uid;
  return true;
end;
$$;

revoke all on function public.create_meal_understanding(uuid, text, text, text, text, text, jsonb, jsonb, numeric, text, timestamptz) from public, anon;
grant execute on function public.create_meal_understanding(uuid, text, text, text, text, text, jsonb, jsonb, numeric, text, timestamptz) to authenticated;

revoke all on function public.confirm_meal_understanding(uuid, timestamptz, text, jsonb, text) from public, anon;
grant execute on function public.confirm_meal_understanding(uuid, timestamptz, text, jsonb, text) to authenticated;

revoke all on function public.discard_meal_understanding(uuid) from public, anon;
grant execute on function public.discard_meal_understanding(uuid) to authenticated;
