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

-- Plan + usage meter. Written by the SERVER (service role) only; users read their own.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  launches_used int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.entitlements enable row level security;

-- Users may READ their own entitlement; writes go through the service role (bypasses RLS).
drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements
  for select
  using (auth.uid() = user_id);
