-- PostBeacon schema. Run this in the Supabase SQL editor.
-- Persistent Agent tasks additionally require migrations/20261025_agent_runs.sql.
-- Daily research additionally requires migrations/20261026_agent_missions.sql.
-- Keep AGENT_RUNS_ENABLED off until that additive migration and its audit pass.

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

-- Migration for existing installs (safe to re-run). `create table if not
-- exists` does not add columns to an older table, so keep the complete project
-- save contract here rather than only the newest field.
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

-- Atomic usage RPCs. Keep synchronized with migrations/20261026_atomic_usage.sql.
-- These service-only operations never accept plan/count/date patches from clients.
create or replace function public.postbeacon_reserve_daily_call(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan text;
  v_calls integer;
  v_date date;
  v_today date;
  v_now timestamptz;
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'invalid_usage_request' using errcode = '22023';
  end if;
  insert into public.entitlements(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select plan, calls_today, calls_date into v_plan, v_calls, v_date
    from public.entitlements where user_id = p_user_id for update;
  if v_plan = 'pro' then return true; end if;
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'UTC')::date;
  if v_date is distinct from v_today then v_calls := 0; end if;
  if v_calls is null or v_calls < 0 then
    raise exception 'invalid_usage_state' using errcode = '22023';
  end if;
  if v_calls >= p_limit then return false; end if;
  update public.entitlements set calls_today = v_calls + 1,
    calls_date = v_today, updated_at = v_now where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.postbeacon_increment_launch(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if p_user_id is null then
    raise exception 'invalid_usage_request' using errcode = '22023';
  end if;
  insert into public.entitlements(user_id, launches_used)
    values (p_user_id, 1)
    on conflict (user_id) do update
      set launches_used = public.entitlements.launches_used + 1,
          updated_at = clock_timestamp()
    returning launches_used into v_count;
  return v_count;
end;
$$;

revoke all on function public.postbeacon_reserve_daily_call(uuid, integer) from public, anon, authenticated;
revoke all on function public.postbeacon_increment_launch(uuid) from public, anon, authenticated;
grant execute on function public.postbeacon_reserve_daily_call(uuid, integer) to service_role;
grant execute on function public.postbeacon_increment_launch(uuid) to service_role;

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
  verdict jsonb,
  recorded_at timestamptz not null default now()
);

-- M24.1 repair for installations that already created outcomes.
alter table public.outcomes
  add column if not exists verdict jsonb;

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

-- P1 parent ownership: same transactional block as migrations/20261026_workspace_ownership.sql.
begin;
set local lock_timeout = '5s';
lock table public.projects, public.campaigns, public.experiments, public.outcomes, public.tasks
  in share row exclusive mode;

do $workspace_ownership_preflight$
begin
  if exists (
    select 1 from public.campaigns c left join public.projects p on p.id=c.project_id
      where c.project_id is not null and (p.id is null or c.user_id is distinct from p.user_id)
    union all
    select 1 from public.experiments e left join public.campaigns c on c.id=e.campaign_id
      where e.campaign_id is not null and (c.id is null or e.user_id is distinct from c.user_id)
    union all
    select 1 from public.outcomes o left join public.experiments e on e.id=o.experiment_id
      where o.experiment_id is not null and (e.id is null or o.user_id is distinct from e.user_id)
    union all
    select 1 from public.tasks t left join public.campaigns c on c.id=t.campaign_id
      where t.campaign_id is not null and (c.id is null or t.user_id is distinct from c.user_id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'workspace_ownership_preflight_failed',
      hint = 'Run audit-workspace-ownership.sql and investigate existing data. No records were changed.';
  end if;
end
$workspace_ownership_preflight$;

create unique index if not exists projects_id_user_key on public.projects(id,user_id);
create unique index if not exists campaigns_id_user_key on public.campaigns(id,user_id);
create unique index if not exists experiments_id_user_key on public.experiments(id,user_id);

do $workspace_owner_constraints$
declare
  link record;
  child_id regclass;
  parent_id regclass;
  child_columns smallint[];
  parent_columns smallint[];
  existing pg_constraint;
begin
  for link in select * from (values
    ('campaigns','project_id','projects','campaigns_project_owner_fkey'),
    ('experiments','campaign_id','campaigns','experiments_campaign_owner_fkey'),
    ('outcomes','experiment_id','experiments','outcomes_experiment_owner_fkey'),
    ('tasks','campaign_id','campaigns','tasks_campaign_owner_fkey')
  ) as links(child_table,parent_column,parent_table,constraint_name)
  loop
    child_id := format('public.%I',link.child_table)::regclass;
    parent_id := format('public.%I',link.parent_table)::regclass;
    select array[
      (select attnum from pg_attribute where attrelid=child_id and attname=link.parent_column and not attisdropped),
      (select attnum from pg_attribute where attrelid=child_id and attname='user_id' and not attisdropped)
    ] into child_columns;
    select array[
      (select attnum from pg_attribute where attrelid=parent_id and attname='id' and not attisdropped),
      (select attnum from pg_attribute where attrelid=parent_id and attname='user_id' and not attisdropped)
    ] into parent_columns;
    select * into existing from pg_constraint
      where conrelid=child_id and conname=link.constraint_name;
    if found then
      if existing.contype <> 'f' or existing.confrelid <> parent_id
        or existing.conkey is distinct from child_columns
        or existing.confkey is distinct from parent_columns
        or existing.confdeltype <> 'c' or not existing.convalidated
        or existing.condeferrable then
        raise exception 'workspace_ownership_constraint_conflict';
      end if;
    else
      execute format(
        'alter table public.%I add constraint %I foreign key (%I,user_id) references public.%I(id,user_id) on delete cascade',
        link.child_table,link.constraint_name,link.parent_column,link.parent_table
      );
    end if;
  end loop;
end
$workspace_owner_constraints$;
notify pgrst, 'reload schema';
commit;

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

-- Account data deletion is one database transaction. Only the service_role
-- may call it; auth.users removal remains a separate GoTrue admin operation.
create or replace function public.delete_postbeacon_user_data(target_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Keep the same project-first lock order as Agent save/reserve/worker RPCs,
  -- including when this base schema is re-run after optional Agent migrations.
  perform 1 from public.projects where user_id = target_user_id order by id for update;
  -- Agent tables are optional until their separate migration is installed.
  -- Re-running this base schema must not remove their deletion coverage.
  if to_regclass('public.agent_runs') is not null then
    execute 'delete from public.agent_runs where user_id = $1' using target_user_id;
  end if;
  if to_regclass('public.agent_missions') is not null then
    execute 'delete from public.agent_missions where user_id = $1' using target_user_id;
  end if;
  if to_regclass('public.agent_daily_usage') is not null then
    execute 'delete from public.agent_daily_usage where user_id = $1' using target_user_id;
  end if;
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
