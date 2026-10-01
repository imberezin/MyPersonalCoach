-- Personal Eating Coach, Phase 1: delete a saved meal (My meals).
--
-- Rules
--   * Additive on top of the applied files. They are never edited.
--   * No new table, so Row Level Security is unchanged.
--   * delete_meal_entry runs as the caller (SECURITY INVOKER): RLS applies inside it, and every
--     statement also filters on the caller's id as a second lock.
--   * Plain SQL only.

-- ---------------------------------------------------------------------------
-- audit_changes: the trail says THAT a row changed or went, never WHAT it held.
-- The old version copied the whole row (for a meal: the food names in `items`) into audit_log, on
-- DELETE and on UPDATE, and the owner cannot delete audit rows, so a deleted meal was never really gone.
--   DELETE: id, table, action, time only.
--   UPDATE: the before/after SUMMARY: the row without `items`. (`items` is the only free-text column of
--           a meal; weight_entries has no such key, so removing it there changes nothing.) A meal can be
--           updated today without editing: ON DELETE SET NULL on offline_period_id fires when a future
--           automatic offline period is replaced.
-- CREATE OR REPLACE keeps the function's existing privileges (execute stays revoked).
-- ---------------------------------------------------------------------------

create or replace function public.audit_changes()
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
      insert into public.audit_log (user_id, table_name, row_id, action)
      values (old.user_id, tg_table_name, old.id::text, 'DELETE');
    end if;
    return old;
  end if;

  insert into public.audit_log (user_id, table_name, row_id, action, old_data, new_data)
  values (old.user_id, tg_table_name, old.id::text, 'UPDATE', to_jsonb(old) - 'items', to_jsonb(new) - 'items');
  return new;
end;
$$;

-- One-time scrub of what the old trigger already wrote (it is not retroactive by itself): deleted rows
-- keep their id, table, action and time; changed meals keep the summary without the food names.
update public.audit_log set old_data = null, new_data = null where action = 'DELETE';
update public.audit_log
   set old_data = old_data - 'items', new_data = new_data - 'items'
 where action = 'UPDATE' and table_name = 'meal_entries';

-- ---------------------------------------------------------------------------
-- delete_meal_entry: erases one confirmed meal and everything made from it, in one transaction.
-- Returns true when a meal was deleted, false when there was nothing to delete (already gone, or not
-- the caller's: the two look the same on purpose). Idempotent.
--
-- Order matters:
--   1. Purge the caller's STALE unfinished reports. A pending report keeps the typed text and the AI's
--      items, and once it is older than the 2 hour resume window (RESUME_WINDOW_MS in the app) the app
--      no longer shows it: Home does not offer it and the confirm and edit pages answer not found
--      (isStaleReport). So without this a test report left unsaved would stay stored for good. Same locking pattern as create_meal_understanding. This runs on every call,
--      including one that finds no meal. Fresh pending reports are never touched.
--   2. Lock the entry. A second delete of the same meal waits here and then finds nothing.
--   3. Evidence rows that point at the meal by plain id (no foreign key exists).
--   4. The entry FIRST. If the understanding went first, ON DELETE SET NULL would UPDATE the entry
--      and the audit trigger would see the update.
--   5. The understanding, then its raw input (the typed text) unless another understanding still
--      uses it. Deleting the raw input alone would cascade, but the entry must already be gone.
-- patterns are left alone: a pattern is not a meal, and its status is recomputed from the evidence
-- that remains by the engine that writes it (nothing writes patterns yet).
-- ---------------------------------------------------------------------------

create function public.delete_meal_entry(p_entry_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_stale uuid[];
  v_understanding uuid;
  v_raw uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select array_agg(s.id) into v_stale
    from (
      select u.id
        from public.meal_understandings u
       where u.user_id = v_uid and u.status = 'pending' and u.created_at < now() - interval '2 hours'
         for update skip locked
    ) s;

  if v_stale is not null then
    delete from public.meal_raw_inputs r
     where r.user_id = v_uid
       and exists (select 1 from public.meal_understandings u where u.raw_input_id = r.id)
       and not exists (select 1 from public.meal_understandings u where u.raw_input_id = r.id and not (u.id = any (v_stale)));
  end if;

  select e.understanding_id into v_understanding
    from public.meal_entries e
   where e.id = p_entry_id and e.user_id = v_uid
     for update;
  if not found then
    return false;
  end if;

  delete from public.pattern_evidence pe
   where pe.user_id = v_uid and pe.source_table = 'meal_entries' and pe.source_id = p_entry_id;

  delete from public.meal_entries where id = p_entry_id and user_id = v_uid;

  if v_understanding is not null then
    delete from public.meal_understandings
     where id = v_understanding and user_id = v_uid
    returning raw_input_id into v_raw;

    if v_raw is not null then
      delete from public.meal_raw_inputs r
       where r.id = v_raw and r.user_id = v_uid
         and not exists (select 1 from public.meal_understandings u where u.raw_input_id = r.id);
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.delete_meal_entry(uuid) from public, anon;
grant execute on function public.delete_meal_entry(uuid) to authenticated;
