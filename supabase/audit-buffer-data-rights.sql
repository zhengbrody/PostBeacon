-- Read-only structural audit; never emits owner ids, OAuth material or post text.
with fn as (
  select p.oid,p.prosrc from pg_proc p where p.oid=to_regprocedure('public.delete_postbeacon_user_data(uuid)')
), checks(ord,check_name,passed) as (
  select 1,'publishing data rights tables present',
    (select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('buffer_connections','buffer_connection_secrets','buffer_oauth_states','buffer_deliveries','buffer_delivery_daily_usage') and c.relrowsecurity)
  union all
  select 2,'delete RPC server-only',coalesce((select has_function_privilege('service_role',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') from fn),false)
  union all
  select 3,'delete RPC locks projects then connections before deleting children',coalesce((select
    position('public.projects where user_id' in prosrc)>0 and position('public.projects where user_id' in prosrc)<position('public.buffer_connections where user_id' in prosrc)
    and position('for update' in prosrc)>0 and position('public.buffer_connections where user_id' in prosrc)<position('delete from public.buffer_deliveries' in prosrc) from fn),false)
  union all
  select 4,'delete RPC explicitly covers grants states receipts and owner counters',coalesce((select prosrc like '%delete from public.buffer_connection_secrets%' and prosrc like '%delete from public.buffer_oauth_states%' and prosrc like '%delete from public.buffer_deliveries%' and prosrc like '%delete from public.buffer_connections%' and prosrc like '%delete from public.buffer_delivery_daily_usage%' from fn),false)
  union all
  select 5,'shared anti-abuse counts are not erased by account deletion',coalesce((select prosrc not like '%delete from public.buffer_delivery_daily_totals%' and prosrc not like '%delete from public.buffer_delivery_account_daily_usage%' from fn),false)
)
select check_name,case when passed then 'PASS' else 'FAIL' end as status from checks order by ord;
