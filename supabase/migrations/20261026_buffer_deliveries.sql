-- Requires reviewed Buffer connection migration first. Does not enable publishing.
begin;
create table if not exists public.buffer_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  connection_id uuid not null,
  connection_revision integer not null check(connection_revision>0),
  approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=20000),
  project_updated_at timestamptz not null,
  account_quota_key text not null check(account_quota_key ~ '^[a-f0-9]{64}$'),
  scheduled_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'awaiting-approval' check(status in ('awaiting-approval','sending','scheduled','published','failed','unknown','cancelled','expired')),
  attempted_at timestamptz,
  attempt_token uuid,
  provider_post_id text check(length(provider_post_id)<=200),
  message text check(length(message)<=600),
  observed_at timestamptz,
  actual_published_at timestamptz,
  read_token uuid,
  read_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,approval_hash),
  foreign key(project_id,user_id) references public.projects(id,user_id) on delete cascade,
  foreign key(connection_id,user_id) references public.buffer_connections(id,user_id) on delete cascade
);
create index if not exists buffer_deliveries_owner_project_idx on public.buffer_deliveries(user_id,project_id,created_at desc);
create table if not exists public.buffer_delivery_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  reserved_deliveries integer not null default 0,
  read_requests integer not null default 0,
  primary key(user_id,day)
);
create table if not exists public.buffer_delivery_daily_totals (
  day date primary key,
  reserved_deliveries integer not null default 0,
  read_requests integer not null default 0
);
-- Pseudonymous HMAC(account id) counter. Never raw credentials/account IDs;
-- survives account/connection deletion to prevent resetting shared-account caps.
create table if not exists public.buffer_delivery_account_daily_usage (
  account_quota_key text not null check(account_quota_key ~ '^[a-f0-9]{64}$'),
  day date not null,
  reserved_deliveries integer not null default 0,
  primary key(account_quota_key,day)
);
alter table public.buffer_deliveries enable row level security;
alter table public.buffer_delivery_daily_usage enable row level security;
alter table public.buffer_delivery_daily_totals enable row level security;
alter table public.buffer_delivery_account_daily_usage enable row level security;
revoke all on public.buffer_deliveries,public.buffer_delivery_daily_usage,public.buffer_delivery_daily_totals,public.buffer_delivery_account_daily_usage from public,anon,authenticated;
grant select on public.buffer_deliveries,public.buffer_delivery_daily_usage to authenticated;
grant all on public.buffer_deliveries,public.buffer_delivery_daily_usage,public.buffer_delivery_daily_totals,public.buffer_delivery_account_daily_usage to service_role;
drop policy if exists "read own buffer deliveries" on public.buffer_deliveries;
create policy "read own buffer deliveries" on public.buffer_deliveries for select to authenticated using(auth.uid()=user_id);
drop policy if exists "read own buffer delivery usage" on public.buffer_delivery_daily_usage;
create policy "read own buffer delivery usage" on public.buffer_delivery_daily_usage for select to authenticated using(auth.uid()=user_id);

create or replace function public.prepare_buffer_delivery(p_user_id uuid,p_project_id uuid,p_connection_id uuid,p_connection_revision integer,p_project_updated_at timestamptz,p_approval_hash text,p_account_quota_key text,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_project public.projects%rowtype; v_connection public.buffer_connections%rowtype; v_delivery public.buffer_deliveries%rowtype; v_due timestamptz;
begin
  select * into v_project from public.projects where id=p_project_id and user_id=p_user_id for update;
  if not found or v_project.updated_at is distinct from p_project_updated_at then raise exception 'draft_conflict'; end if;
  select * into v_connection from public.buffer_connections where id=p_connection_id and user_id=p_user_id for update;
  if not found or v_connection.status<>'connected' or v_connection.revision<>p_connection_revision then raise exception 'connection_conflict'; end if;
  if p_approval_hash is null or p_account_quota_key is null or p_approval_hash !~ '^[a-f0-9]{64}$' or p_account_quota_key !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>20000 then raise exception 'invalid_delivery'; end if;
  if p_snapshot->>'projectId' is distinct from p_project_id::text or p_snapshot->>'connectionId' is distinct from p_connection_id::text or (p_snapshot->>'connectionRevision')::integer is distinct from p_connection_revision or p_snapshot->>'accountQuotaKey' is distinct from p_account_quota_key or coalesce(p_snapshot->>'platformId','') not in ('twitter','linkedin') or jsonb_typeof(p_snapshot->'body') is distinct from 'string' or length(p_snapshot->>'body') not between 1 and 4000 or jsonb_typeof(p_snapshot->'scheduledAt') is distinct from 'string' or coalesce(p_snapshot->>'timeZone','')='' or coalesce(p_snapshot->>'channelId','')='' or coalesce(p_snapshot->>'channelName','')='' then raise exception 'invalid_delivery'; end if;
  v_due:=(p_snapshot->>'scheduledAt')::timestamptz;
  if v_due<clock_timestamp()+interval '10 minutes' or v_due>clock_timestamp()+interval '30 days' then raise exception 'invalid_schedule'; end if;
  select * into v_delivery from public.buffer_deliveries where user_id=p_user_id and approval_hash=p_approval_hash;
  if found then return to_jsonb(v_delivery); end if;
  -- Autosaving can change a context hash without changing the proposed post.
  -- A new approval must not silently duplicate an active/uncertain external send.
  if exists(select 1 from public.buffer_deliveries where user_id=p_user_id
    and account_quota_key=p_account_quota_key and snapshot->>'channelId'=p_snapshot->>'channelId'
    and snapshot->>'body'=p_snapshot->>'body' and scheduled_at=v_due
    and (status in ('sending','scheduled','unknown','published') or (status='awaiting-approval' and attempted_at is null and expires_at>clock_timestamp()))) then
    raise exception 'duplicate_active_delivery';
  end if;
  if (select count(*) from public.buffer_deliveries where user_id=p_user_id and created_at>=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'))>=20 then raise exception 'delivery_budget_exhausted'; end if;
  insert into public.buffer_deliveries(user_id,project_id,connection_id,connection_revision,project_updated_at,approval_hash,account_quota_key,snapshot,scheduled_at,expires_at)
    values(p_user_id,p_project_id,p_connection_id,p_connection_revision,p_project_updated_at,p_approval_hash,p_account_quota_key,p_snapshot,v_due,least(clock_timestamp()+interval '15 minutes',v_due-interval '2 minutes')) returning * into v_delivery;
  return to_jsonb(v_delivery);
end; $$;

create or replace function public.claim_buffer_delivery(p_user_id uuid,p_delivery_id uuid,p_approval_hash text,p_project_updated_at timestamptz,p_connection_revision integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.buffer_deliveries%rowtype; p public.projects%rowtype; c public.buffer_connections%rowtype; v_day date:=(clock_timestamp() at time zone 'UTC')::date; v_global integer; v_owner integer; v_account integer;
begin
  if p_approval_hash is null then return null; end if;
  select * into d from public.buffer_deliveries where id=p_delivery_id and user_id=p_user_id;
  if not found then return null; end if;
  select * into p from public.projects where id=d.project_id and user_id=p_user_id for update;
  if not found then return null; end if;
  select * into c from public.buffer_connections where id=d.connection_id and user_id=p_user_id for update;
  if not found or c.status<>'connected' or c.revision<>d.connection_revision or c.revision<>p_connection_revision then raise exception 'connection_conflict'; end if;
  select * into d from public.buffer_deliveries where id=p_delivery_id and user_id=p_user_id for update;
  if d.status<>'awaiting-approval' or d.attempted_at is not null then return null; end if;
  if d.expires_at<=clock_timestamp() or d.scheduled_at<=clock_timestamp()+interval '2 minutes' then update public.buffer_deliveries set status='expired',updated_at=clock_timestamp() where id=d.id; return null; end if;
  if d.approval_hash<>p_approval_hash or p.updated_at is distinct from p_project_updated_at or d.project_updated_at is distinct from p_project_updated_at then raise exception 'draft_conflict'; end if;
  insert into public.buffer_delivery_daily_totals(day) values(v_day) on conflict do nothing;
  select reserved_deliveries into v_global from public.buffer_delivery_daily_totals where day=v_day for update;
  insert into public.buffer_delivery_account_daily_usage(account_quota_key,day) values(d.account_quota_key,v_day) on conflict do nothing;
  select reserved_deliveries into v_account from public.buffer_delivery_account_daily_usage where day=v_day and account_quota_key=d.account_quota_key for update;
  insert into public.buffer_delivery_daily_usage(user_id,day) values(p_user_id,v_day) on conflict do nothing;
  select reserved_deliveries into v_owner from public.buffer_delivery_daily_usage where day=v_day and user_id=p_user_id for update;
  if v_global>=100 or v_account>=5 or v_owner>=5 then raise exception 'delivery_budget_exhausted'; end if;
  update public.buffer_delivery_daily_totals set reserved_deliveries=reserved_deliveries+1 where day=v_day;
  update public.buffer_delivery_account_daily_usage set reserved_deliveries=reserved_deliveries+1 where day=v_day and account_quota_key=d.account_quota_key;
  update public.buffer_delivery_daily_usage set reserved_deliveries=reserved_deliveries+1 where day=v_day and user_id=p_user_id;
  update public.buffer_deliveries set status='sending',attempted_at=clock_timestamp(),attempt_token=gen_random_uuid(),updated_at=clock_timestamp() where id=d.id returning * into d;
  return to_jsonb(d);
end; $$;

create or replace function public.finish_buffer_delivery(p_user_id uuid,p_delivery_id uuid,p_attempt_token uuid,p_status text,p_provider_post_id text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.buffer_deliveries%rowtype;
begin
  if p_status not in ('scheduled','failed','unknown') or length(coalesce(p_provider_post_id,''))>200 then raise exception 'invalid_delivery'; end if;
  update public.buffer_deliveries set status=p_status,provider_post_id=p_provider_post_id,updated_at=clock_timestamp()
    where id=p_delivery_id and user_id=p_user_id and status='sending' and attempt_token=p_attempt_token returning * into d;
  if not found then return null; end if;
  return to_jsonb(d);
end; $$;

create or replace function public.cancel_buffer_delivery(p_user_id uuid,p_delivery_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.buffer_deliveries%rowtype;
begin
  update public.buffer_deliveries set status='cancelled',updated_at=clock_timestamp()
    where id=p_delivery_id and user_id=p_user_id and status='awaiting-approval' and attempted_at is null returning * into d;
  if not found then return null; end if;
  return to_jsonb(d);
end; $$;

create or replace function public.claim_buffer_delivery_read(p_user_id uuid,p_delivery_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.buffer_deliveries%rowtype; v_day date:=(clock_timestamp() at time zone 'UTC')::date; v_global integer; v_owner integer;
begin
  select * into d from public.buffer_deliveries where id=p_delivery_id and user_id=p_user_id for update;
  if not found or d.provider_post_id is null or d.status not in ('scheduled','published','failed','unknown') then return null; end if;
  if d.read_started_at>clock_timestamp()-interval '30 seconds' then raise exception 'delivery_read_limited'; end if;
  insert into public.buffer_delivery_daily_totals(day) values(v_day) on conflict do nothing;
  select read_requests into v_global from public.buffer_delivery_daily_totals where day=v_day for update;
  insert into public.buffer_delivery_daily_usage(user_id,day) values(p_user_id,v_day) on conflict do nothing;
  select read_requests into v_owner from public.buffer_delivery_daily_usage where day=v_day and user_id=p_user_id for update;
  if v_owner>=100 or v_global>=1000 then raise exception 'delivery_read_limited'; end if;
  update public.buffer_delivery_daily_totals set read_requests=read_requests+1 where day=v_day;
  update public.buffer_delivery_daily_usage set read_requests=read_requests+1 where day=v_day and user_id=p_user_id;
  update public.buffer_deliveries set read_token=gen_random_uuid(),read_started_at=clock_timestamp() where id=d.id returning * into d;
  return to_jsonb(d);
end; $$;

create or replace function public.observe_buffer_delivery(p_user_id uuid,p_delivery_id uuid,p_read_token uuid,p_status text,p_actual_published_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.buffer_deliveries%rowtype;
begin
  if p_status is null or p_status not in ('scheduled','published','failed','unknown') or (p_status='published' and p_actual_published_at is null) or (p_status<>'published' and p_actual_published_at is not null) then raise exception 'invalid_delivery'; end if;
  select * into d from public.buffer_deliveries where id=p_delivery_id and user_id=p_user_id for update;
  if not found or p_read_token is null or d.read_token is null or d.read_started_at is null or d.read_token is distinct from p_read_token or d.read_started_at<clock_timestamp()-interval '30 seconds' then return null; end if;
  if p_status='published' and (d.attempted_at is null or p_actual_published_at<d.attempted_at-interval '1 minute' or p_actual_published_at>clock_timestamp()+interval '1 minute') then raise exception 'invalid_delivery'; end if;
  update public.buffer_deliveries set status=case when d.status='published' then d.status else p_status end,
    observed_at=clock_timestamp(), actual_published_at=coalesce(d.actual_published_at,p_actual_published_at),read_token=null,updated_at=clock_timestamp()
    where id=d.id returning * into d;
  return to_jsonb(d);
end; $$;

revoke all on function public.prepare_buffer_delivery(uuid,uuid,uuid,integer,timestamptz,text,text,jsonb),public.claim_buffer_delivery(uuid,uuid,text,timestamptz,integer),public.finish_buffer_delivery(uuid,uuid,uuid,text,text),public.cancel_buffer_delivery(uuid,uuid),public.claim_buffer_delivery_read(uuid,uuid),public.observe_buffer_delivery(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.prepare_buffer_delivery(uuid,uuid,uuid,integer,timestamptz,text,text,jsonb),public.claim_buffer_delivery(uuid,uuid,text,timestamptz,integer),public.finish_buffer_delivery(uuid,uuid,uuid,text,text),public.cancel_buffer_delivery(uuid,uuid),public.claim_buffer_delivery_read(uuid,uuid),public.observe_buffer_delivery(uuid,uuid,uuid,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
