-- Personal Eating Coach, Phase 2: pattern detection, Early Signal, first experiment.
-- Rules: additive; no applied file is edited, no table is dropped, and no existing row can violate any new rule
-- (nothing wrote patterns, pattern_evidence or experiments before this). RLS is unchanged because no table is
-- added; the new function is security invoker. Plain SQL only.

-- 1. Evidence is one row per (pattern, source). Makes the sync idempotent.
alter table public.pattern_evidence
  add constraint pattern_evidence_unique_source unique (pattern_id, source_table, source_id);

-- 2. When the person answered the Early Signal card (the cooldown clock). Both or neither.
alter table public.patterns
  add column user_feedback_at timestamptz,
  add constraint patterns_feedback_has_time check ((user_feedback is null) = (user_feedback_at is null));

-- 3. A proposed experiment waits as OFFERED until the person says "I'll try" or "Not this time".
--    The text the person saw is kept (library text or AI wording), with where it came from.
alter table public.experiments drop constraint if exists experiments_status_check;
alter table public.experiments
  add constraint experiments_status_check check (status in ('OFFERED', 'ACTIVE', 'DONE', 'SKIPPED')),
  add column variant text,
  add column wording text,
  add column wording_source text,
  add column wording_locale text,
  add constraint experiments_wording_source_check check (wording_source in ('library', 'ai')),
  add constraint experiments_wording_locale_check check (wording_locale in ('he', 'en')),
  add constraint experiments_wording_length check (wording is null or char_length(wording) between 1 and 400),
  add constraint experiments_wording_all_or_none
    check ((wording is null) = (wording_source is null) and (wording is null) = (wording_locale is null));
-- An OFFERED or SKIPPED-from-OFFERED row never started: started_at is set only when it becomes ACTIVE.
alter table public.experiments
  alter column started_at drop not null,
  alter column started_at drop default,
  add constraint experiments_started_when_active check (status not in ('ACTIVE', 'DONE') or started_at is not null);
-- At most ONE open experiment per person: an OFFERED or an ACTIVE row, never both, never two.
create unique index experiments_one_open on public.experiments (user_id) where status in ('OFFERED', 'ACTIVE');
-- experiments_one_active (init.sql) stays; it is now implied by this index.

-- 4. THE evidence writer. The TypeScript side computes the live occurrences and the status; this function
--    makes the stored mirror equal them, atomically. It has no notion of "a deleted meal": it applies set
--    equality, so a meal that no longer exists simply is not in the set. The exists-check below takes a
--    FOR SHARE lock on the meal row, so a sync that overlaps an in-flight delete_meal_entry (which holds the row
--    FOR UPDATE) waits for it, then finds the meal gone and inserts nothing; a sync that locks first makes the
--    delete wait, and the delete's own evidence clean-up then sees the committed row. Either order leaves no
--    evidence for a deleted meal.
--      p_kind        the pattern kind ('late_evening_meals'), 1 to 64 characters
--      p_status      OBSERVATION | CANDIDATE | VALIDATED (REJECTED is never written here)
--      p_occurrences [{ "meal_id": uuid, "observed_at": timestamptz }, ...] at most 200
--    Creates the pattern row if missing (this is the moment the person first engages with the signal).
--    A REJECTED row is left exactly as it is: the person said "not related", so nothing is tracked.
--    (The "not related" answer first syncs with an EMPTY set, which creates the row if needed and removes
--    any stored evidence, and only then marks the row REJECTED, so a rejected pattern holds no evidence.)
--    A no-op leaves updated_at alone (the UPDATE has a WHERE that matches only a real change).
--    validated_at uses the database clock (now()); no decision reads it.
create function public.sync_pattern_evidence(p_kind text, p_status text, p_occurrences jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_current text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_kind is null or char_length(p_kind) not between 1 and 64 then
    raise exception 'bad_kind' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('OBSERVATION', 'CANDIDATE', 'VALIDATED') then
    raise exception 'bad_status' using errcode = '22023';
  end if;
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' or jsonb_array_length(p_occurrences) > 200 then
    raise exception 'bad_occurrences' using errcode = '22023';
  end if;

  insert into public.patterns (user_id, kind, status) values (v_uid, p_kind, p_status)
  on conflict (user_id, kind) do nothing;

  -- Serialises two syncs of the same pattern (a save and a delete in two tabs).
  select id, status into v_id, v_current
    from public.patterns where user_id = v_uid and kind = p_kind for update;

  if v_current = 'REJECTED' then
    return v_id;
  end if;

  update public.patterns
     set status = p_status,
         validated_at = case when p_status = 'VALIDATED' then coalesce(validated_at, now()) else null end
   where id = v_id and (status is distinct from p_status or (p_status = 'VALIDATED') is distinct from (validated_at is not null));

  delete from public.pattern_evidence pe
   where pe.pattern_id = v_id and pe.user_id = v_uid
     and not exists (
       select 1 from jsonb_array_elements(p_occurrences) o
        where pe.source_table = 'meal_entries' and pe.source_id = (o ->> 'meal_id')::uuid);

  insert into public.pattern_evidence (user_id, pattern_id, observed_at, source_table, source_id)
  select v_uid, v_id, (o ->> 'observed_at')::timestamptz, 'meal_entries', (o ->> 'meal_id')::uuid
    from jsonb_array_elements(p_occurrences) o
   where exists (select 1 from public.meal_entries e where e.id = (o ->> 'meal_id')::uuid and e.user_id = v_uid for share)
  on conflict (pattern_id, source_table, source_id) do update set observed_at = excluded.observed_at;

  return v_id;
end;
$$;

revoke all on function public.sync_pattern_evidence(text, text, jsonb) from public, anon;
grant execute on function public.sync_pattern_evidence(text, text, jsonb) to authenticated;
