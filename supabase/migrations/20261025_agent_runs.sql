-- C.2.0: bounded durable source research. Additive; apply deliberately, not at build time.
begin;
-- A job's owner must also own its project. Never trust an ID-only parent FK.
create unique index if not exists projects_id_user_key on public.projects(id, user_id);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  request_id uuid not null,
  provider text not null check (provider in ('openai', 'deepseek')),
  payload jsonb not null check (octet_length(payload::text) <= 90000),
  status text not null default 'queued' check (status in ('queued','running','ready','failed','cancelled')),
  phase text not null default 'queued' check (phase in ('queued','sources','model','ready')),
  sources jsonb not null default '[]'::jsonb,
  research jsonb,
  failure_message text check (length(failure_message) <= 400),
  model_attempted boolean not null default false,
  attempts int not null default 0 check (attempts between 0 and 2),
  lease_token uuid,
  lease_expires_at timestamptz,
  deadline_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, request_id),
  foreign key(project_id,user_id) references public.projects(id,user_id) on delete cascade
);
create index if not exists agent_runs_project_idx on public.agent_runs(user_id,project_id,created_at desc);
alter table public.agent_runs enable row level security;
revoke all on public.agent_runs from public, anon, authenticated;
grant select on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;
drop policy if exists "read own agent runs" on public.agent_runs;
create policy "read own agent runs" on public.agent_runs for select using (auth.uid() = user_id);

-- Reservations deliberately outlive project deletion/cancellation. These are counts,
-- not exact dollar accounting. Every plan, including Pro, uses the same hard caps.
create table if not exists public.agent_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  reserved_runs int not null check (reserved_runs between 0 and 10),
  primary key(user_id,day)
);
alter table public.agent_daily_usage enable row level security;
revoke all on public.agent_daily_usage from public, anon, authenticated;
grant select on public.agent_daily_usage to authenticated;
grant all on public.agent_daily_usage to service_role;
drop policy if exists "read own agent usage" on public.agent_daily_usage;
create policy "read own agent usage" on public.agent_daily_usage for select using (auth.uid() = user_id);

create table if not exists public.agent_daily_totals (
  day date primary key,
  reserved_runs int not null check (reserved_runs between 0 and 100)
);
alter table public.agent_daily_totals enable row level security;
revoke all on public.agent_daily_totals from public, anon, authenticated;
grant all on public.agent_daily_totals to service_role;

-- A server-written marker distinguishes pre-install accounts from unreadable
-- task data after a schema-cache failure. It never changes a billing plan.
alter table public.entitlements add column if not exists agent_data_initialized boolean not null default false;
insert into public.entitlements(user_id,agent_data_initialized)
  select user_id,true from public.agent_runs union select user_id,true from public.agent_daily_usage
  on conflict(user_id) do update set agent_data_initialized=true;

create or replace function public.reserve_agent_run(
  p_user_id uuid, p_project_id uuid, p_request_id uuid, p_provider text, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare r public.agent_runs; d date := (now() at time zone 'UTC')::date; n int;
begin
  -- Shared row lock serializes all budget reservations, including first use.
  insert into public.agent_daily_totals(day,reserved_runs) values(d,0) on conflict do nothing;
  perform 1 from public.agent_daily_totals where day=d for update;
  select * into r from public.agent_runs where user_id=p_user_id and request_id=p_request_id;
  if found then
    if r.project_id <> p_project_id or r.provider <> p_provider or r.payload <> p_payload then
      raise exception 'request_conflict';
    end if;
    return to_jsonb(r);
  end if;
  perform 1 from public.projects where id=p_project_id and user_id=p_user_id for key share;
  if not found then raise exception 'project_not_found'; end if;
  select reserved_runs into n from public.agent_daily_totals where day=d;
  if n >= 100 then raise exception 'budget_exhausted'; end if;
  insert into public.agent_daily_usage(user_id,day,reserved_runs) values(p_user_id,d,0) on conflict do nothing;
  select reserved_runs into n from public.agent_daily_usage where user_id=p_user_id and day=d for update;
  if n >= 10 then raise exception 'budget_exhausted'; end if;
  insert into public.agent_runs(user_id,project_id,request_id,provider,payload)
    values(p_user_id,p_project_id,p_request_id,p_provider,p_payload) returning * into r;
  update public.projects set updated_at=now() where id=p_project_id and user_id=p_user_id;
  update public.agent_daily_usage set reserved_runs=reserved_runs+1 where user_id=p_user_id and day=d;
  update public.agent_daily_totals set reserved_runs=reserved_runs+1 where day=d;
  insert into public.entitlements(user_id,agent_data_initialized) values(p_user_id,true)
    on conflict(user_id) do update set agent_data_initialized=true;
  return to_jsonb(r);
end $$;

create or replace function public.transition_agent_run(
  p_user_id uuid, p_run_id uuid, p_action text, p_lease uuid default null, p_data jsonb default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id=p_run_id and user_id=p_user_id for update;
  if not found then return null; end if;
  if p_action = 'cancel' then
    if r.status in ('queued','running') then
      update public.agent_runs set status='cancelled',lease_token=null,updated_at=now()
        where id=r.id returning * into r;
    end if;
    return to_jsonb(r);
  end if;
  if p_action = 'claim' then
    if r.deadline_at <= now() or r.attempts >= 2 or r.model_attempted or
      not (r.status='queued' or (r.status='running' and r.lease_expires_at <= now())) then return null; end if;
    update public.agent_runs set status='running',phase='sources',attempts=attempts+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '55 seconds',updated_at=now()
      where id=r.id returning * into r;
    return to_jsonb(r);
  end if;
  if r.status <> 'running' or r.lease_token is distinct from p_lease or
    r.lease_expires_at <= now() or r.deadline_at <= now() then return null; end if;
  if p_action = 'sources' and not r.model_attempted and jsonb_typeof(p_data)='array' and jsonb_array_length(p_data)<=3 then
    update public.agent_runs set sources=p_data,updated_at=now() where id=r.id returning * into r;
  elsif p_action = 'model' and not r.model_attempted then
    update public.agent_runs set model_attempted=true,phase='model',updated_at=now() where id=r.id returning * into r;
  elsif p_action = 'complete' and jsonb_typeof(p_data)='object' and octet_length(p_data::text)<=90000 then
    update public.agent_runs set status='ready',phase='ready',research=p_data,lease_token=null,updated_at=now()
      where id=r.id returning * into r;
  elsif p_action = 'fail' then
    update public.agent_runs set status='failed',lease_token=null,
      failure_message=left(coalesce(p_data->>'message','Research did not complete. No automatic retry.'),400),
      updated_at=now() where id=r.id returning * into r;
  else return null;
  end if;
  return to_jsonb(r);
end $$;

revoke all on function public.reserve_agent_run(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_agent_run(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.transition_agent_run(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.transition_agent_run(uuid,uuid,text,uuid,jsonb) to service_role;

-- Replace the deletion RPC in the SAME transaction as installing new owned data.
create or replace function public.delete_postbeacon_user_data(target_user_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.agent_runs where user_id=target_user_id;
  delete from public.agent_daily_usage where user_id=target_user_id;
  delete from public.outcomes where user_id=target_user_id;
  delete from public.tasks where user_id=target_user_id;
  delete from public.experiments where user_id=target_user_id;
  delete from public.campaigns where user_id=target_user_id;
  delete from public.projects where user_id=target_user_id;
  delete from public.entitlements where user_id=target_user_id;
end $$;
revoke all on function public.delete_postbeacon_user_data(uuid) from public,anon,authenticated;
grant execute on function public.delete_postbeacon_user_data(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
