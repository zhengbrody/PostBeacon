-- Read-only C.2.0 installation audit. Does not exercise runtime/concurrency or spend.
with checks as (
  select 'Agent tables and RLS' as check_name,
    (select count(*)=3 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('agent_runs','agent_daily_usage','agent_daily_totals')) as passed
  union all
  select 'Client writes closed', not exists (
    select 1 from unnest(array['agent_runs','agent_daily_usage','agent_daily_totals']) t,
      unnest(array['anon','authenticated']) r
    where to_regclass('public.'||t) is null or
      has_table_privilege(r,to_regclass('public.'||t),'INSERT,UPDATE,DELETE,TRUNCATE'))
  union all
  select 'Owner read policies only',
    (select count(*)=2 and bool_and(cmd='SELECT' and qual like '%auth.uid()%user_id%')
      from pg_policies where schemaname='public' and tablename in ('agent_runs','agent_daily_usage','agent_daily_totals'))
  union all
  select 'Composite project-owner cascade', exists (
    select 1 from pg_constraint where conrelid=to_regclass('public.agent_runs') and contype='f' and confdeltype='c'
      and confrelid=to_regclass('public.projects') and cardinality(conkey)=2)
  union all
  select 'Owner auth-user cascades', (select count(*)=2 from pg_constraint
    where conrelid in (to_regclass('public.agent_runs'),to_regclass('public.agent_daily_usage'))
      and confrelid=to_regclass('auth.users') and contype='f' and confdeltype='c')
  union all
  select 'Agent RPCs service-role only',
    (select count(*)=2 and bool_and(not p.prosecdef and
      not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and
      has_function_privilege('service_role',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('reserve_agent_run','transition_agent_run'))
  union all
  select 'Delete RPC covers Agent data', exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='delete_postbeacon_user_data' and p.prosrc like '%delete from public.agent_runs%'
      and p.prosrc like '%delete from public.agent_daily_usage%' and not p.prosecdef
      and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute'))
  union all
  select 'Export initialization marker installed', exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='entitlements'
      and column_name='agent_data_initialized' and data_type='boolean' and is_nullable='NO')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='reserve_agent_run' and p.prosrc like '%agent_data_initialized%')
)
select check_name, case when passed then 'PASS' else 'FAIL' end as status from checks;
