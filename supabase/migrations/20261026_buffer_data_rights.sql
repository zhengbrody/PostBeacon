-- Install AFTER both Buffer migrations. Does not enable publishing or cancel
-- external queued posts. Pseudonymous shared-account counters expire by retention.
begin;
do $$ begin
  if to_regclass('public.buffer_connections') is null or to_regclass('public.buffer_deliveries') is null then
    raise exception 'buffer_migrations_required';
  end if;
end $$;
create or replace function public.delete_postbeacon_user_data(target_user_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform 1 from public.projects where user_id=target_user_id order by id for update;
  perform 1 from public.buffer_connections where user_id=target_user_id order by id for update;
  delete from public.buffer_deliveries where user_id=target_user_id;
  delete from public.buffer_oauth_states where user_id=target_user_id;
  delete from public.buffer_connection_secrets where user_id=target_user_id;
  delete from public.buffer_connections where user_id=target_user_id;
  delete from public.buffer_delivery_daily_usage where user_id=target_user_id;
  if to_regclass('public.agent_runs') is not null then
    execute 'delete from public.agent_runs where user_id=$1' using target_user_id;
  end if;
  if to_regclass('public.agent_missions') is not null then
    execute 'delete from public.agent_missions where user_id=$1' using target_user_id;
  end if;
  if to_regclass('public.agent_daily_usage') is not null then
    execute 'delete from public.agent_daily_usage where user_id=$1' using target_user_id;
  end if;
  delete from public.outcomes where user_id=target_user_id;
  delete from public.tasks where user_id=target_user_id;
  delete from public.experiments where user_id=target_user_id;
  delete from public.campaigns where user_id=target_user_id;
  delete from public.projects where user_id=target_user_id;
  delete from public.entitlements where user_id=target_user_id;
end $$;
revoke all on function public.delete_postbeacon_user_data(uuid) from public,anon,authenticated;
grant execute on function public.delete_postbeacon_user_data(uuid) to service_role;
notify pgrst,'reload schema';
commit;
