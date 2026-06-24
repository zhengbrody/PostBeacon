-- PostBeacon schema. Run this in the Supabase SQL editor.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled',
  url text,
  profile jsonb,
  strategy jsonb,
  result jsonb,
  posted jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

-- Each user can only see and touch their own projects.
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
