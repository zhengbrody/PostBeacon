-- M17.2 production repair: install the M15 workspace mirror and the
-- transactional account-data deletion RPC. Safe to run once on an older
-- PostBeacon database; the entire migration commits or rolls back together.

begin;

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

create index if not exists experiments_campaign_idx
  on public.experiments (campaign_id, published_at desc);
create index if not exists outcomes_experiment_idx
  on public.outcomes (experiment_id, recorded_at desc);

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

create or replace function public.delete_postbeacon_user_data(target_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.outcomes where user_id = target_user_id;
  delete from public.tasks where user_id = target_user_id;
  delete from public.experiments where user_id = target_user_id;
  delete from public.campaigns where user_id = target_user_id;
  delete from public.projects where user_id = target_user_id;
  delete from public.entitlements where user_id = target_user_id;
end;
$$;

revoke all on function public.delete_postbeacon_user_data(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_postbeacon_user_data(uuid) to service_role;

commit;
