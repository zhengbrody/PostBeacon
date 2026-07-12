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
  -- client-side plan state (channel selection, launch date) — not a server response
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Migration for existing installs (safe to re-run):
alter table public.projects
  add column if not exists meta jsonb default '{}'::jsonb;

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

-- Each user can only see and touch their own projects.
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Plan + usage meter. Written by the SERVER (service role) only; users read their own.
-- launches_used = lifetime (billing); calls_today/calls_date = daily abuse cap.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  launches_used int not null default 0,
  calls_today int not null default 0,
  calls_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Migration for existing installs (safe to re-run):
alter table public.entitlements
  add column if not exists calls_today int not null default 0,
  add column if not exists calls_date date;

alter table public.entitlements enable row level security;

-- Users may READ their own entitlement; writes go through the service role (bypasses RLS).
drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements
  for select
  using (auth.uid() = user_id);

-- Webhook idempotency ledger: one row per processed webhook-id, so a replayed
-- (or re-delivered) Polar event is acked without being processed twice.
-- Written by the service role only; RLS with no policies denies everyone else.
create table if not exists public.webhook_events (
  id text primary key,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- M15 Launch workspace: campaigns / experiments / outcomes / tasks.
-- Written by the app as a write-through mirror of projects.meta.workspace
-- (which stays the hydration source); these tables make outcomes queryable
-- and unlock future cross-campaign views. All additive — safe to re-run.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  goal text,
  stage text,
  launch_date date,
  weekly_minutes int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (project_id)
);

create table if not exists public.experiments (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform_id text not null,
  community text,
  angle text,
  variant text,
  hypothesis text,
  tracked_url text,
  status text not null default 'live' check (status in ('live', 'analyzed', 'stopped')),
  post_idx int not null default 0,
  published_at timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists public.outcomes (
  id uuid primary key,
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  checkpoint text not null check (checkpoint in ('24h', '72h', 'manual')),
  impressions int,
  replies int,
  clicks int,
  signups int,
  revenue numeric,
  qualitative_feedback text,
  recorded_at timestamptz not null default now()
);

create table if not exists public.tasks (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text,
  status text not null check (status in ('done', 'skipped')),
  est_minutes int,
  acted_at timestamptz not null default now(),
  primary key (campaign_id, id)
);

create index if not exists experiments_campaign_idx on public.experiments (campaign_id, published_at desc);
create index if not exists outcomes_experiment_idx on public.outcomes (experiment_id, recorded_at desc);

-- Owners only, on every workspace table (same posture as projects).
alter table public.campaigns enable row level security;
alter table public.experiments enable row level security;
alter table public.outcomes enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "own campaigns" on public.campaigns;
create policy "own campaigns" on public.campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own experiments" on public.experiments;
create policy "own experiments" on public.experiments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own outcomes" on public.outcomes;
create policy "own outcomes" on public.outcomes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
