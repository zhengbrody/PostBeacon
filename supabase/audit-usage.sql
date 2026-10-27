-- Read-only audit. Does not reserve usage or change any entitlement.
with required(signature) as (
  values ('public.postbeacon_reserve_daily_call(uuid,integer)'),
         ('public.postbeacon_increment_launch(uuid)')
), functions as (
  select p.* from required r join pg_proc p on p.oid = to_regprocedure(r.signature)
), checks(sort_order, check_name, expected, actual) as (
  select 1, 'atomic usage RPCs installed', 2, count(*)::integer from functions
  union all
  select 2, 'usage RPCs executable by service role only', 2, count(*)::integer
    from functions p
    where has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
  union all
  select 3, 'usage RPCs security invoker and pinned search path', 2, count(*)::integer
    from functions p where not p.prosecdef and 'search_path=""' = any(p.proconfig)
  union all
  select 4, 'entitlements RLS enabled', 1, count(*)::integer
    from pg_class c where c.oid = to_regclass('public.entitlements') and c.relrowsecurity
)
select check_name, expected, actual,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from checks order by sort_order;
