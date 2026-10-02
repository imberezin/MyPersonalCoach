-- Personal Eating Coach: weekly Shabbat top-up (insert-only).
--
-- Adds the missing upcoming automatic Shabbat periods for one user. It never updates or deletes a row,
-- never touches past periods, manual periods or other types, and does nothing for a user who no longer
-- observes Shabbat or whose profile place or candle-lighting minutes differ from the ones the caller
-- passes. (Whether the EXISTING rows were computed for that place is checked by the caller, not here.)
-- Called only by the server job with the service role (the caller passes the user id), so EXECUTE is
-- closed to anon and authenticated. Real Supabase grants EXECUTE on new functions to anon and
-- authenticated by default; PGlite cannot show that, so the revoke is explicit.

create function public.top_up_future_auto_shabbat(
  p_user_id uuid,
  p_place_key text,
  p_candle_minutes integer,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_locked uuid;
  v_inserted integer;
begin
  if p_user_id is null or p_place_key is null or p_candle_minutes is null then
    raise exception 'p_user_id, p_place_key and p_candle_minutes are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 12 then
    raise exception 'p_rows must be a json array of at most 12 items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  -- The row lock makes this atomic against onboarding: a concurrent change of the profile (the user stops
  -- observing Shabbat, or picks another place) waits for this transaction, and its clear/replace runs after it.
  select user_id into v_locked
    from public.profiles
   where user_id = p_user_id
     and observes_shabbat is true
     and place_key = p_place_key
     and candle_lighting_minutes = p_candle_minutes
     for share;
  if v_locked is null then
    return 0;
  end if;

  insert into public.offline_periods (user_id, type, start_at, end_at, source, metadata)
  select p_user_id, 'SHABBAT', r.start_at, r.end_at, 'auto',
         case when jsonb_typeof(r.metadata) = 'object' then r.metadata else '{}'::jsonb end
    from jsonb_to_recordset(p_rows) as r (start_at timestamptz, end_at timestamptz, metadata jsonb)
   where r.start_at is not null
     and r.end_at is not null
     and r.end_at > r.start_at
     and r.end_at - r.start_at <= interval '3 days'
     and r.start_at > now()
     and r.start_at < now() + interval '1 year'
     and not exists (
       select 1 from public.offline_periods o
        where o.user_id = p_user_id and o.type = 'SHABBAT'
          and o.start_at < r.end_at and o.end_at > r.start_at)
  on conflict (user_id, type, start_at) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.top_up_future_auto_shabbat(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.top_up_future_auto_shabbat(uuid, text, integer, jsonb) to service_role;
