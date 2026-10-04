-- Personal Eating Coach, Weekly Learning (week 2 and on).
--
-- Rules
--   * Additive on top of the applied files. They are never edited.
--   * No table, no column. Row Level Security and grants are unchanged (every table touched here already has the
--     "own rows" policy; init.sql grants select, insert, update, delete on all of them).
--   * Every existing row satisfies every constraint below (nothing wrote weekly_summaries before, and no DONE
--     experiment exists), and the triggers act only on future deletes and updates.
--   * The one function runs as the caller (SECURITY INVOKER) with an empty search_path; it returns `trigger`, so it
--     cannot be called directly and there is no execute grant to manage.
--   * It replaces no function of another item: it adds triggers that react to delete_meal_entry and
--     delete_weight_entry, it never touches them.
--   * Plain SQL only.
-- It needs the First Week's pattern_detection migration (experiments.variant, wording, the OFFERED status) only for
-- the history read of the app; nothing below refers to those columns.

-- 1. A weekly summary belongs to a LOCAL Sunday (a date has no zone). This catches a week computed in UTC or on the
--    wrong weekday at write time, in tests and in production, instead of as a quietly wrong week.
-- 2. `content` is a small object (the opening mode's version and at most one worded line), never a document.
alter table public.weekly_summaries
  add constraint weekly_summaries_week_start_is_sunday check (extract(dow from week_start) = 0),
  add constraint weekly_summaries_content_is_object check (jsonb_typeof(content) = 'object' and char_length(content::text) <= 2000);

-- 3. A finished experiment carries the person's answer, and "I did not get to try" (tried = NO) has no helpfulness
--    (not applicable), while every answer the person actually gave after trying has one (UNKNOWN included).
alter table public.experiments
  add constraint experiments_result_consistent
    check (status <> 'DONE' or (tried is not null and ((tried = 'NO') = (helpfulness is null))));

-- 4. ERASURE. weekly_summaries.opening_mode is derived from meals and weights (CELEBRATE means a landmark or the goal
--    was confirmed), so a row must not outlive the data it was derived from. When a meal or a weight of a local week is
--    deleted, or a weight's kilograms or time change, the row of that local week (in the profile's zone) is deleted in
--    the SAME transaction. This is the single erasure point every derived store joins.
--    SECURITY INVOKER: RLS applies (the caller owns the row) and the statement also filters on the owner's id. The week
--    is the LOCAL Sunday; a time zone the database does not know falls back to Asia/Jerusalem, exactly like the app's
--    resolveTimeZone, so a bad profile value can never make a delete fail.
create function public.erase_weekly_summary_of_changed_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_at timestamptz[];
  v_one timestamptz;
  v_local date;
begin
  select p.timezone into v_tz from public.profiles p where p.user_id = old.user_id;

  if tg_table_name = 'meal_entries' then
    v_at := array[old.occurred_at];
  elsif tg_op = 'DELETE' then
    v_at := array[old.measured_at];
  else
    v_at := array[old.measured_at, new.measured_at];      -- an edit may move a weigh-in to another week
  end if;

  foreach v_one in array v_at loop
    begin
      v_local := (v_one at time zone coalesce(v_tz, 'Asia/Jerusalem'))::date;
    exception when others then
      v_local := (v_one at time zone 'Asia/Jerusalem')::date;
    end;
    delete from public.weekly_summaries w
     where w.user_id = old.user_id
       and w.week_start = v_local - extract(dow from v_local)::int;      -- the local Sunday of that day
  end loop;

  return null;      -- AFTER trigger: the return value is ignored
end;
$$;

create trigger meal_entries_erase_weekly_summary
  after delete on public.meal_entries
  for each row execute function public.erase_weekly_summary_of_changed_source();

create trigger weight_entries_erase_weekly_summary_delete
  after delete on public.weight_entries
  for each row execute function public.erase_weekly_summary_of_changed_source();

-- A note edit does not fire it (the column list and the WHEN clause); a changed number or time does.
create trigger weight_entries_erase_weekly_summary_update
  after update of weight_kg, measured_at on public.weight_entries
  for each row when (old.weight_kg is distinct from new.weight_kg or old.measured_at is distinct from new.measured_at)
  execute function public.erase_weekly_summary_of_changed_source();
