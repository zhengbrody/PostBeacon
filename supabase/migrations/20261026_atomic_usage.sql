-- Install before releasing the atomic usage client. Additive and safe to rerun.
-- No plan, entitlement, count or historical row is rewritten by installation.
begin;

create or replace function public.postbeacon_reserve_daily_call(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan text;
  v_calls integer;
  v_date date;
  v_today date;
  v_now timestamptz;
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'invalid_usage_request' using errcode = '22023';
  end if;
  insert into public.entitlements(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select plan, calls_today, calls_date into v_plan, v_calls, v_date
    from public.entitlements where user_id = p_user_id for update;
  -- Preserve the existing Pro exemption; this is not a dollar-spend cap.
  if v_plan = 'pro' then return true; end if;
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'UTC')::date;
  if v_date is distinct from v_today then v_calls := 0; end if;
  if v_calls is null or v_calls < 0 then
    raise exception 'invalid_usage_state' using errcode = '22023';
  end if;
  if v_calls >= p_limit then return false; end if;
  update public.entitlements set calls_today = v_calls + 1,
    calls_date = v_today, updated_at = v_now where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.postbeacon_increment_launch(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if p_user_id is null then
    raise exception 'invalid_usage_request' using errcode = '22023';
  end if;
  -- Count a successful generation atomically. This is not a pre-model free-plan
  -- reservation: paid billing remains gated until that separate lifecycle exists.
  insert into public.entitlements(user_id, launches_used)
    values (p_user_id, 1)
    on conflict (user_id) do update
      set launches_used = public.entitlements.launches_used + 1,
          updated_at = clock_timestamp()
    returning launches_used into v_count;
  return v_count;
end;
$$;

revoke all on function public.postbeacon_reserve_daily_call(uuid, integer) from public, anon, authenticated;
revoke all on function public.postbeacon_increment_launch(uuid) from public, anon, authenticated;
grant execute on function public.postbeacon_reserve_daily_call(uuid, integer) to service_role;
grant execute on function public.postbeacon_increment_launch(uuid) to service_role;

commit;
