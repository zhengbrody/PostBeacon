-- Read-only production audit for PostBeacon's complete user-data boundary.
-- Run the WHOLE file in Supabase Dashboard > SQL Editor. It returns one
-- PASS/FAIL report: missing objects count as failures instead of disappearing.

with
expected_tables(table_name) as (
  values
    ('projects'),
    ('entitlements'),
    ('webhook_events'),
    ('campaigns'),
    ('experiments'),
    ('outcomes'),
    ('tasks')
),
table_state as (
  select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
expected_policies(table_name, policy_name, command, needs_check) as (
  values
    ('projects', 'own projects', 'ALL', true),
    ('entitlements', 'read own entitlement', 'SELECT', false),
    ('campaigns', 'own campaigns', 'ALL', true),
    ('experiments', 'own experiments', 'ALL', true),
    ('outcomes', 'own outcomes', 'ALL', true),
    ('tasks', 'own tasks', 'ALL', true)
),
matching_policies as (
  select ep.table_name
  from expected_policies ep
  join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = ep.table_name
   and p.policyname = ep.policy_name
   and p.cmd = ep.command
   and p.qual like '%auth.uid()%user_id%'
   and (not ep.needs_check or p.with_check like '%auth.uid()%user_id%')
),
expected_fks(child_schema, child_table, parent_schema, parent_table) as (
  values
    ('public', 'projects', 'auth', 'users'),
    ('public', 'entitlements', 'auth', 'users'),
    ('public', 'campaigns', 'auth', 'users'),
    ('public', 'experiments', 'auth', 'users'),
    ('public', 'outcomes', 'auth', 'users'),
    ('public', 'tasks', 'auth', 'users'),
    ('public', 'campaigns', 'public', 'projects'),
    ('public', 'experiments', 'public', 'campaigns'),
    ('public', 'outcomes', 'public', 'experiments'),
    ('public', 'tasks', 'public', 'campaigns')
),
cascade_fks as (
  select
    child_ns.nspname as child_schema,
    child.relname as child_table,
    parent_ns.nspname as parent_schema,
    parent.relname as parent_table
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  where con.contype = 'f' and con.confdeltype = 'c'
),
checks(sort_order, check_name, expected, actual, passed, detail) as (
  select 1, 'all tables installed', 7, count(*)::int, count(*) = 7,
    'projects, entitlements, webhook_events and four workspace tables'
  from expected_tables e join table_state t using (table_name)

  union all
  select 2, 'RLS enabled on every table', 7, count(*)::int, count(*) = 7,
    'no user-data table may run without row-level security'
  from expected_tables e join table_state t using (table_name)
  where t.rls_enabled

  union all
  select 3, 'owner policies exact', 6, count(*)::int, count(*) = 6,
    'five ALL owner policies plus SELECT-only entitlement access'
  from matching_policies

  union all
  select 4, 'webhook ledger closed to clients', 0, count(*)::int, count(*) = 0,
    'webhook_events has RLS and no anon/authenticated policy'
  from pg_policies
  where schemaname = 'public' and tablename = 'webhook_events'

  union all
  select 5, 'auth-user cascades', 6, count(*)::int, count(*) = 6,
    'every user-owned table cascades from auth.users'
  from expected_fks e join cascade_fks f using (child_schema, child_table, parent_schema, parent_table)
  where e.parent_schema = 'auth'

  union all
  select 6, 'workspace parent cascades', 4, count(*)::int, count(*) = 4,
    'project -> campaign -> experiment -> outcome/task chain'
  from expected_fks e join cascade_fks f using (child_schema, child_table, parent_schema, parent_table)
  where e.parent_schema = 'public'

  union all
  select 7, 'transactional delete RPC locked', 1,
    case
      when to_regprocedure('public.delete_postbeacon_user_data(uuid)') is not null
       and has_function_privilege('service_role', to_regprocedure('public.delete_postbeacon_user_data(uuid)'), 'EXECUTE')
       and not has_function_privilege('anon', to_regprocedure('public.delete_postbeacon_user_data(uuid)'), 'EXECUTE')
       and not has_function_privilege('authenticated', to_regprocedure('public.delete_postbeacon_user_data(uuid)'), 'EXECUTE')
      then 1 else 0
    end,
    case
      when to_regprocedure('public.delete_postbeacon_user_data(uuid)') is not null
       and has_function_privilege('service_role', to_regprocedure('public.delete_postbeacon_user_data(uuid)'), 'EXECUTE')
       and not has_function_privilege('anon', to_regprocedure('public.delete_postbeacon_user_data(uuid)'), 'EXECUTE')
       and not has_function_privilege('authenticated', to_regprocedure('public.delete_postbeacon_user_data(uuid)'), 'EXECUTE')
      then true else false
    end,
    'service_role only; its table deletes commit or roll back together'
)
select
  check_name,
  expected,
  actual,
  case when passed then 'PASS' else 'FAIL' end as status,
  detail
from checks
order by sort_order;
