-- C.3: explicitly authorized, bounded daily public research.
-- Requires 20261025_agent_runs.sql. Additive installation; never execute at build time.
begin;
create table if not exists public.agent_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  enabled boolean not null default false,
  context_key text not null check (length(context_key) between 1 and 50000),
  settings jsonb not null check (octet_length(settings::text) <= 12000),
  consent_version text not null default 'daily-public-openai-v1' check (consent_version='daily-public-openai-v1'),
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 days'),
  last_run_at timestamptz,
  last_dispatch_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,user_id),
  unique(id,project_id,user_id),
  foreign key(project_id,user_id) references public.projects(id,user_id) on delete cascade,
  check (expires_at=authorized_at+interval '30 days'),
  check ((jsonb_typeof(settings)='object' and jsonb_typeof(settings->'enabled')='boolean'
    and (settings->>'enabled')::boolean=enabled and settings->'brief'->>'mode'='product-led'
    and settings->'brief'->'sources'='[]'::jsonb
    and jsonb_typeof(settings->'searchQueries')='array' and jsonb_array_length(settings->'searchQueries') between 1 and 3
    and jsonb_typeof(settings->'allowedDomains')='array' and jsonb_array_length(settings->'allowedDomains') between 1 and 5) is true)
);
create index if not exists agent_missions_due_idx on public.agent_missions(last_dispatch_at) where enabled;
alter table public.agent_missions enable row level security;
revoke all on public.agent_missions from public,anon,authenticated;
grant select on public.agent_missions to authenticated;
grant all on public.agent_missions to service_role;
drop policy if exists "read own agent missions" on public.agent_missions;
create policy "read own agent missions" on public.agent_missions for select using (auth.uid()=user_id);

alter table public.agent_runs add column if not exists mission_id uuid;
alter table public.agent_runs add column if not exists mission_revision integer;
alter table public.agent_runs add column if not exists mission_day date;
alter table public.agent_runs add column if not exists search_attempted boolean not null default false;
alter table public.agent_runs add column if not exists search_receipt jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='agent_runs_mission_owner_fkey' and conrelid='public.agent_runs'::regclass) then
    alter table public.agent_runs add constraint agent_runs_mission_owner_fkey foreign key(mission_id,project_id,user_id)
      references public.agent_missions(id,project_id,user_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='agent_runs_mission_fields_check' and conrelid='public.agent_runs'::regclass) then
    alter table public.agent_runs add constraint agent_runs_mission_fields_check check (
      (mission_id is null and mission_revision is null and mission_day is null and not search_attempted and search_receipt is null)
      or (mission_id is not null and mission_revision is not null and mission_revision>0 and mission_day is not null and provider='openai'));
  end if;
  if not exists(select 1 from pg_constraint where conname='agent_runs_search_receipt_size_check' and conrelid='public.agent_runs'::regclass) then
    alter table public.agent_runs add constraint agent_runs_search_receipt_size_check check (search_receipt is null or
      (jsonb_typeof(search_receipt)='object' and octet_length(search_receipt::text)<=5000));
  end if;
end $$;
create unique index if not exists agent_runs_mission_daily_key on public.agent_runs(mission_id,mission_revision,mission_day)
  where mission_id is not null;
alter table public.entitlements add column if not exists mission_data_initialized boolean not null default false;
insert into public.entitlements(user_id,mission_data_initialized) select user_id,true from public.agent_missions
  on conflict(user_id) do update set mission_data_initialized=true;

create or replace function public.save_agent_mission(
  p_user_id uuid,p_project_id uuid,p_context_key text,p_settings jsonb,p_expected_revision integer
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.agent_missions; t timestamptz:=now();
begin
  perform 1 from public.projects where id=p_project_id and user_id=p_user_id for update;
  if not found then raise exception 'project_not_found'; end if;
  select * into m from public.agent_missions where project_id=p_project_id and user_id=p_user_id for update;
  if found then
    if p_expected_revision is distinct from m.revision then raise exception 'revision_conflict'; end if;
    update public.agent_missions set revision=revision+1,enabled=(p_settings->>'enabled')::boolean,
      context_key=p_context_key,settings=p_settings,authorized_at=t,expires_at=t+interval '30 days',
      last_run_at=null,updated_at=t where id=m.id returning * into m;
  else
    if p_expected_revision is not null then raise exception 'revision_conflict'; end if;
    insert into public.agent_missions(user_id,project_id,enabled,context_key,settings,authorized_at,expires_at)
      values(p_user_id,p_project_id,(p_settings->>'enabled')::boolean,p_context_key,p_settings,t,t+interval '30 days') returning * into m;
  end if;
  update public.agent_runs set status='cancelled',lease_token=null,updated_at=t
    where mission_id=m.id and status in ('queued','running');
  update public.projects set updated_at=t where id=p_project_id and user_id=p_user_id;
  insert into public.entitlements(user_id,mission_data_initialized) values(p_user_id,true)
    on conflict(user_id) do update set mission_data_initialized=true;
  return to_jsonb(m);
end $$;

create or replace function public.pause_agent_mission(p_user_id uuid,p_project_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.agent_missions;
begin
  -- Same project -> mission -> runs lock order as save/reserve. Revocation needs no provider keys.
  perform 1 from public.projects where id=p_project_id and user_id=p_user_id for update;
  if not found then return null; end if;
  select * into m from public.agent_missions where project_id=p_project_id and user_id=p_user_id for update;
  if not found then return null; end if;
  if m.enabled then
    update public.agent_missions set enabled=false,settings=jsonb_set(settings,'{enabled}','false'::jsonb),
      revision=revision+1,updated_at=now() where id=m.id returning * into m;
  end if;
  update public.agent_runs set status='cancelled',lease_token=null,updated_at=now()
    where mission_id=m.id and status in ('queued','running');
  return to_jsonb(m);
end $$;

create or replace function public.reserve_agent_mission_run(
  p_user_id uuid,p_mission_id uuid,p_context_key text,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.agent_missions; r public.agent_runs; d date:=(now() at time zone 'UTC')::date;
  project_id_value uuid; prior_updated_at timestamptz; reserved jsonb;
begin
  select project_id into project_id_value from public.agent_missions where id=p_mission_id and user_id=p_user_id;
  if not found then raise exception 'project_not_found'; end if;
  -- Same lock order as reserve_agent_run: shared budget -> project -> mission.
  -- Otherwise a manual reservation and a background reservation could deadlock.
  insert into public.agent_daily_totals(day,reserved_runs) values(d,0) on conflict do nothing;
  perform 1 from public.agent_daily_totals where day=d for update;
  select updated_at into prior_updated_at from public.projects where id=project_id_value and user_id=p_user_id for update;
  if not found then raise exception 'project_not_found'; end if;
  select * into m from public.agent_missions where id=p_mission_id and user_id=p_user_id for update;
  if not found then raise exception 'project_not_found'; end if;
  if not m.enabled or m.expires_at<=now() then raise exception 'mission_paused'; end if;
  if m.revision is distinct from p_expected_revision then raise exception 'revision_conflict'; end if;
  if m.context_key is distinct from p_context_key then raise exception 'context_conflict'; end if;
  if p_payload->>'provider' is distinct from 'openai' or p_payload->'input' is distinct from m.settings->'brief' then raise exception 'context_conflict'; end if;
  select * into r from public.agent_runs where mission_id=m.id and mission_revision=m.revision and mission_day=d;
  if found then return to_jsonb(r); end if;
  -- Reuse the SAME atomic user/global budget as manual tasks. Entire operation rolls back on any failure.
  reserved:=public.reserve_agent_run(p_user_id,m.project_id,gen_random_uuid(),'openai',p_payload);
  update public.agent_runs set mission_id=m.id,mission_revision=m.revision,mission_day=d
    where id=(reserved->>'id')::uuid returning * into r;
  update public.agent_missions set last_run_at=now() where id=m.id;
  -- Background work must not make an inactive user's project immortal. Project row is locked throughout.
  update public.projects set updated_at=prior_updated_at where id=m.project_id and user_id=p_user_id;
  return to_jsonb(r);
end $$;

drop function if exists public.transition_agent_mission_run(uuid,uuid,text,uuid,jsonb);
create or replace function public.transition_agent_mission_run(
  p_user_id uuid,p_run_id uuid,p_action text,p_lease uuid default null,p_data jsonb default null,
  p_project_updated_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.agent_runs; m public.agent_missions; mission_id_value uuid; project_id_value uuid; actual_updated_at timestamptz;
begin
  select mission_id,project_id into mission_id_value,project_id_value from public.agent_runs where id=p_run_id and user_id=p_user_id;
  if mission_id_value is null then return null; end if;
  -- The server validated this exact project version immediately before the RPC.
  -- Holding the project lock closes an autosave -> paid request TOCTOU, not just
  -- a mission revision race. The stamp never leaves the server to a model.
  select updated_at into actual_updated_at from public.projects where id=project_id_value and user_id=p_user_id for update;
  if not found or p_project_updated_at is null or actual_updated_at is distinct from p_project_updated_at then return null; end if;
  -- Project -> mission -> run order matches authorization and account deletion.
  select * into m from public.agent_missions where id=mission_id_value and user_id=p_user_id for key share;
  if not found or not m.enabled or m.expires_at<=now() then return null; end if;
  select * into r from public.agent_runs where id=p_run_id and user_id=p_user_id for update;
  if not found or r.mission_revision<>m.revision or r.status<>'running' or
    r.lease_token is distinct from p_lease or r.lease_expires_at<=now() or r.deadline_at<=now() then return null; end if;
  if p_action='search' and not r.search_attempted and not r.model_attempted then
    update public.agent_runs set search_attempted=true,updated_at=now() where id=r.id returning * into r;
  elsif p_action='complete' and r.search_attempted and jsonb_typeof(p_data->'search')='object'
      and octet_length((p_data->'search')::text)<=5000 and
      (p_data->'research' is null or p_data->'research'='null'::jsonb or
        (jsonb_typeof(p_data->'research')='object' and octet_length((p_data->'research')::text)<=90000)) then
    update public.agent_runs set status='ready',phase='ready',research=nullif(p_data->'research','null'::jsonb),
      search_receipt=p_data->'search',lease_token=null,updated_at=now() where id=r.id returning * into r;
  elsif p_action in ('sources','model','fail') and r.search_attempted then
    return public.transition_agent_run(p_user_id,p_run_id,p_action,p_lease,p_data);
  else return null;
  end if;
  return to_jsonb(r);
end $$;

-- Preserve the manual API while fencing mission claims and ambiguous paid search.
-- A later search/model checkpoint takes the mission lock before releasing work.
create or replace function public.transition_agent_run(
  p_user_id uuid,p_run_id uuid,p_action text,p_lease uuid default null,p_data jsonb default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id=p_run_id and user_id=p_user_id for update;
  if not found then return null; end if;
  if p_action='cancel' then
    if r.status in ('queued','running') then
      update public.agent_runs set status='cancelled',lease_token=null,updated_at=now() where id=r.id returning * into r;
    end if;
    return to_jsonb(r);
  end if;
  if r.mission_id is not null and not exists(select 1 from public.agent_missions m
    where m.id=r.mission_id and m.user_id=p_user_id and m.enabled and m.revision=r.mission_revision and m.expires_at>now()) then return null; end if;
  if p_action='claim' then
    if r.deadline_at<=now() or r.attempts>=2 or r.model_attempted or (r.mission_id is not null and r.search_attempted) or
      not(r.status='queued' or (r.status='running' and r.lease_expires_at<=now())) then return null; end if;
    update public.agent_runs set status='running',phase='sources',attempts=attempts+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '55 seconds',updated_at=now() where id=r.id returning * into r;
    return to_jsonb(r);
  end if;
  if r.status<>'running' or r.lease_token is distinct from p_lease or r.lease_expires_at<=now() or r.deadline_at<=now() then return null; end if;
  if p_action='sources' and not r.model_attempted and jsonb_typeof(p_data)='array' and jsonb_array_length(p_data)<=3 then
    update public.agent_runs set sources=p_data,updated_at=now() where id=r.id returning * into r;
  elsif p_action='model' and not r.model_attempted then
    update public.agent_runs set model_attempted=true,phase='model',updated_at=now() where id=r.id returning * into r;
  elsif p_action='complete' and r.mission_id is null and jsonb_typeof(p_data)='object' and octet_length(p_data::text)<=90000 then
    update public.agent_runs set status='ready',phase='ready',research=p_data,lease_token=null,updated_at=now() where id=r.id returning * into r;
  elsif p_action='fail' then
    update public.agent_runs set status='failed',lease_token=null,
      failure_message=left(coalesce(p_data->>'message','Research did not complete. No automatic retry.'),400),updated_at=now() where id=r.id returning * into r;
  else return null;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.transition_agent_run(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.transition_agent_run(uuid,uuid,text,uuid,jsonb) to service_role;

revoke all on function public.save_agent_mission(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.pause_agent_mission(uuid,uuid) from public,anon,authenticated;
revoke all on function public.reserve_agent_mission_run(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.transition_agent_mission_run(uuid,uuid,text,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.save_agent_mission(uuid,uuid,text,jsonb,integer) to service_role;
grant execute on function public.pause_agent_mission(uuid,uuid) to service_role;
grant execute on function public.reserve_agent_mission_run(uuid,uuid,text,integer,jsonb) to service_role;
grant execute on function public.transition_agent_mission_run(uuid,uuid,text,uuid,jsonb,timestamptz) to service_role;

create or replace function public.delete_postbeacon_user_data(target_user_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
  -- Match worker/save/reserve lock order before removing children.
  perform 1 from public.projects where user_id=target_user_id order by id for update;
  delete from public.agent_runs where user_id=target_user_id;
  delete from public.agent_missions where user_id=target_user_id;
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
notify pgrst,'reload schema';
commit;
