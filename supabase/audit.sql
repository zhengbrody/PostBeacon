-- Read-only production audit for PostBeacon's user-data boundary.
-- Run in Supabase Dashboard > SQL Editor. This changes no data or schema.

-- 1) All seven tables should return rls_enabled = true.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'projects',
    'entitlements',
    'webhook_events',
    'campaigns',
    'experiments',
    'outcomes',
    'tasks'
  )
order by c.relname;

-- 2) projects + workspace tables should have owner policies; entitlements
-- should expose SELECT only; webhook_events should have no client policy.
select
  tablename as table_name,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'projects',
    'entitlements',
    'webhook_events',
    'campaigns',
    'experiments',
    'outcomes',
    'tasks'
  )
order by tablename, policyname;

-- 3) Every returned relationship should say ON DELETE CASCADE. This includes
-- each user table -> auth.users and the project/workspace parent chain.
select
  child_ns.nspname || '.' || child.relname as child_table,
  parent_ns.nspname || '.' || parent.relname as parent_table,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class child on child.oid = con.conrelid
join pg_namespace child_ns on child_ns.oid = child.relnamespace
join pg_class parent on parent.oid = con.confrelid
join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
where con.contype = 'f'
  and child_ns.nspname = 'public'
  and child.relname in (
    'projects',
    'entitlements',
    'campaigns',
    'experiments',
    'outcomes',
    'tasks'
  )
order by child.relname, parent.relname;
