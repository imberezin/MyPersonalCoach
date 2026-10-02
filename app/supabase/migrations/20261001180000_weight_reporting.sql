-- Personal Eating Coach, Phase 1: weight reporting.
-- Rules: additive on top of the applied files; every existing row satisfies every new rule (the only new
-- column is nullable and its CHECK allows null); no table is added, so Row Level Security is unchanged;
-- plain SQL only.

-- 1. An optional short note on a weigh-in (free text the person typed). One to 200 characters when present
--    (the app turns an empty note into null and counts code points, like the database counts characters).
alter table public.weight_entries
  add column note text,
  add constraint weight_entries_note_length check (note is null or char_length(note) between 1 and 200);

-- 2. audit_changes: the trail says THAT a weight changed or went, never WHAT it held.
--    The meals migration already made DELETE content-free for every table and removed `items` from UPDATE rows.
--    Here an UPDATE of weight_entries loses weight_kg and note too: the owner can read audit_log but cannot
--    delete from it, so an old value copied there would outlive "delete this weight". The meal branch is
--    byte-for-byte the previous behaviour. CREATE OR REPLACE keeps the function's privileges (execute
--    stays revoked from public, anon and authenticated; the triggers run it as its owner).
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
  values (
    old.user_id, tg_table_name, old.id::text, 'UPDATE',
    case tg_table_name when 'weight_entries' then to_jsonb(old) - 'weight_kg' - 'note' else to_jsonb(old) - 'items' end,
    case tg_table_name when 'weight_entries' then to_jsonb(new) - 'weight_kg' - 'note' else to_jsonb(new) - 'items' end
  );
  return new;
end;
$$;

-- One-time scrub of what the previous trigger already wrote for weights (it is not retroactive by itself).
-- Expected to touch zero rows on hosted; harmless when it does.
update public.audit_log
   set old_data = old_data - 'weight_kg' - 'note',
       new_data = new_data - 'weight_kg' - 'note'
 where table_name = 'weight_entries' and action = 'UPDATE';

-- 3. delete_weight_entry: erases one weigh-in. SECURITY INVOKER: RLS applies inside it, and every statement
--    also filters on the caller's id as a second lock. Returns true when a row was deleted, false when there
--    was nothing to delete (already gone, or not the caller's: the two look the same on purpose). Idempotent.
--    The row is locked first, so a delete and an edit of the same entry serialize. This is the ONE place that
--    erases a weight: any derived store of weights added later (a weekly summary snapshot, a cache) must be
--    erased or recomputed here, in the same transaction.
create function public.delete_weight_entry(p_entry_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select w.id into v_id
    from public.weight_entries w
   where w.id = p_entry_id and w.user_id = v_uid
     for update;
  if not found then
    return false;
  end if;

  delete from public.weight_entries where id = p_entry_id and user_id = v_uid;
  return true;
end;
$$;

revoke all on function public.delete_weight_entry(uuid) from public, anon;
grant execute on function public.delete_weight_entry(uuid) to authenticated;
