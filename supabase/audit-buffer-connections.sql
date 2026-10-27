-- Read-only installation audit. No credentials, state hashes or identities returned.
with expected_tables(name) as (values('buffer_connections'),('buffer_connection_secrets'),('buffer_oauth_states')),
state as (select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
owner_fks as (
  select c.conrelid,c.confrelid,c.conkey,c.confkey from pg_constraint c
  where c.contype='f' and c.convalidated and c.confdeltype='c'
),
checks(ord,name,expected,actual) as (
  select 1,'Buffer tables installed with RLS',3,count(*)::int from expected_tables e join state s on s.relname=e.name and s.relrowsecurity
  union all
  select 2,'private vault and OAuth states closed to clients',0,count(*)::int from pg_policies
    where schemaname='public' and tablename in ('buffer_connection_secrets','buffer_oauth_states')
  union all
  select 3,'metadata owner SELECT policy',1,
    case when count(*)=1 and count(*) filter(where policyname='read own buffer connections' and cmd='SELECT' and regexp_replace(qual,'\s','','g')='(auth.uid()=user_id)')=1 then 1 else 0 end
    from pg_policies where schemaname='public' and tablename='buffer_connections'
  union all
  select 4,'auth-user cascading cleanup',3,count(distinct s.relname)::int from expected_tables e join state s on s.relname=e.name
    join owner_fks f on f.conrelid=s.oid and f.confrelid=to_regclass('auth.users')
  union all
  select 5,'vault and states bound to connection owner',2,count(distinct s.relname)::int
    from state s join owner_fks f on f.conrelid=s.oid and f.confrelid=to_regclass('public.buffer_connections')
    where s.relname in ('buffer_connection_secrets','buffer_oauth_states')
      and f.conkey=array[(select attnum from pg_attribute where attrelid=s.oid and attname='connection_id'),(select attnum from pg_attribute where attrelid=s.oid and attname='user_id')]
      and f.confkey=array[(select attnum from pg_attribute where attrelid=f.confrelid and attname='id'),(select attnum from pg_attribute where attrelid=f.confrelid and attname='user_id')]
  union all
  select 6,'private tables have no client grants',0,count(*)::int
    from state s cross join (values('anon'),('authenticated')) roles(name)
    where s.relname in ('buffer_connection_secrets','buffer_oauth_states')
      and has_table_privilege(roles.name,s.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE')
  union all
  select 7,'connection writes and transition RPC server-only',1,
    case when to_regprocedure('public.buffer_connection_transition(uuid,text,uuid,integer,jsonb)') is not null
      and has_function_privilege('service_role',to_regprocedure('public.buffer_connection_transition(uuid,text,uuid,integer,jsonb)'),'EXECUTE')
      and not has_function_privilege('authenticated',to_regprocedure('public.buffer_connection_transition(uuid,text,uuid,integer,jsonb)'),'EXECUTE')
      and not has_function_privilege('anon',to_regprocedure('public.buffer_connection_transition(uuid,text,uuid,integer,jsonb)'),'EXECUTE')
      and not exists(select 1 from state s cross join (values('anon'),('authenticated')) roles(name)
        where s.relname='buffer_connections' and has_table_privilege(roles.name,s.oid,'INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE'))
      and not coalesce(has_table_privilege('anon',to_regclass('public.buffer_connections'),'SELECT'),false) then 1 else 0 end
  union all
  select 8,'fail-closed installation marker',1,count(*)::int from information_schema.columns
    where table_schema='public' and table_name='entitlements' and column_name='buffer_data_initialized' and is_nullable='NO' and data_type='boolean'
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='buffer_connections' and column_name='control_started_at' and data_type='timestamp with time zone')
)
select name as check_name,expected,actual,case when expected=actual then 'PASS' else 'FAIL' end as status from checks order by ord;
