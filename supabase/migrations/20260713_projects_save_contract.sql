-- M17.6 production repair: make every column used by the project upsert
-- present on databases created before M11, then refresh PostgREST's schema
-- cache. Safe to re-run; existing columns and data are preserved.

begin;

alter table public.projects
  add column if not exists name text not null default 'Untitled',
  add column if not exists url text,
  add column if not exists profile jsonb,
  add column if not exists strategy jsonb,
  add column if not exists result jsonb,
  add column if not exists posted jsonb default '{}'::jsonb,
  add column if not exists meta jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

commit;

-- Supabase Data API (PostgREST) must see newly added columns immediately.
notify pgrst, 'reload schema';
select pg_notification_queue_usage();
