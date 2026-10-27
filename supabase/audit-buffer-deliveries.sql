-- Read-only installation audit; runtime one-shot/budget behavior has separate tests.
with tables(name) as (values('buffer_deliveries'),('buffer_delivery_daily_usage'),('buffer_delivery_daily_totals'),('buffer_delivery_account_daily_usage')),
required(signature) as (values
 ('public.prepare_buffer_delivery(uuid,uuid,uuid,integer,timestamptz,text,text,jsonb)'),
 ('public.claim_buffer_delivery(uuid,uuid,text,timestamptz,integer)'),
 ('public.finish_buffer_delivery(uuid,uuid,uuid,text,text)'),
 ('public.cancel_buffer_delivery(uuid,uuid)'),
 ('public.claim_buffer_delivery_read(uuid,uuid)'),
 ('public.observe_buffer_delivery(uuid,uuid,uuid,text,timestamptz)')),
functions as(select p.* from required r join pg_proc p on p.oid=to_regprocedure(r.signature)),
checks(sort_order,check_name,expected,actual) as (
 select 1,'four delivery tables installed with RLS',4,count(*)::integer from tables t join pg_class c on c.oid=to_regclass('public.'||t.name) where c.relrowsecurity
 union all
 select 2,'six service-only delivery RPCs',6,count(*)::integer from functions p
 where has_function_privilege('service_role',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
 union all
 select 3,'RPCs invoker with pinned search path',6,count(*)::integer from functions p where not p.prosecdef and 'search_path=public, pg_temp'=any(p.proconfig)
 union all
 select 4,'exactly two owner read-only policies',2,case when (select count(*) from pg_policies where schemaname='public' and tablename in ('buffer_deliveries','buffer_delivery_daily_usage'))=2 then count(*)::integer else 0 end from pg_policies p where schemaname='public' and tablename in ('buffer_deliveries','buffer_delivery_daily_usage') and cmd='SELECT' and qual like '%auth.uid() = user_id%' and roles=array['authenticated']::name[]
 union all
 select 5,'client writes denied on all delivery tables',4,count(*)::integer from tables t where not has_table_privilege('authenticated','public.'||t.name,'INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.'||t.name,'INSERT,UPDATE,DELETE')
 union all
 select 6,'counter tables closed to clients',2,count(*)::integer from tables t where t.name in ('buffer_delivery_daily_totals','buffer_delivery_account_daily_usage') and not has_table_privilege('authenticated','public.'||t.name,'SELECT') and not has_table_privilege('anon','public.'||t.name,'SELECT') and not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.name)
 union all
 select 7,'exact validated immediate composite ownership FKs',2,count(*)::integer
 from (values('project_id','public.projects'),('connection_id','public.buffer_connections')) required(child_column,parent_table)
 join pg_constraint c on c.conrelid=to_regclass('public.buffer_deliveries') and c.confrelid=to_regclass(required.parent_table)
 where c.contype='f' and c.confdeltype='c' and c.convalidated and not c.condeferrable
   and c.conkey=array[(select attnum from pg_attribute where attrelid=to_regclass('public.buffer_deliveries') and attname=required.child_column),(select attnum from pg_attribute where attrelid=to_regclass('public.buffer_deliveries') and attname='user_id')]::smallint[]
   and c.confkey=array[(select attnum from pg_attribute where attrelid=to_regclass(required.parent_table) and attname='id'),(select attnum from pg_attribute where attrelid=to_regclass(required.parent_table) and attname='user_id')]::smallint[]
 union all
 select 8,'owner approval hash uniqueness',1,count(*)::integer from pg_constraint c where c.conrelid='public.buffer_deliveries'::regclass and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (user_id, approval_hash)'
)
select check_name,expected,actual,case when expected=actual then 'PASS' else 'FAIL' end as status from checks order by sort_order;
