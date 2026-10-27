-- Deliberate, additive Buffer OAuth installation. Never execute during deploy/build.
-- Provider tokens, one-time codes and PKCE verifiers are encrypted by the server.
begin;
create table if not exists public.buffer_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  revision integer not null default 1 check(revision>0),
  status text not null default 'disconnected' check(status in ('connected','reauth-required','disconnected')),
  account_label text not null default 'Buffer account' check(length(account_label) between 1 and 200),
  buffer_account_id text not null default '' check(length(buffer_account_id)<=200),
  channels jsonb not null default '[]'::jsonb check(jsonb_typeof(channels)='array' and jsonb_array_length(channels)<=100 and octet_length(channels::text)<=100000),
  control_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);
alter table public.buffer_connections add column if not exists control_started_at timestamptz;
alter table public.buffer_connections enable row level security;
revoke all on public.buffer_connections from public,anon,authenticated;
grant select on public.buffer_connections to authenticated;
grant all on public.buffer_connections to service_role;
drop policy if exists "read own buffer connections" on public.buffer_connections;
create policy "read own buffer connections" on public.buffer_connections for select using(auth.uid()=user_id);

create table if not exists public.buffer_connection_secrets (
  connection_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_ciphertext text not null check(length(access_ciphertext) between 1 and 50000),
  refresh_ciphertext text not null check(length(refresh_ciphertext) between 1 and 50000),
  expires_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  foreign key(connection_id,user_id) references public.buffer_connections(id,user_id) on delete cascade,
  check((lease_token is null)=(lease_until is null))
);
alter table public.buffer_connection_secrets enable row level security;
revoke all on public.buffer_connection_secrets from public,anon,authenticated;
grant all on public.buffer_connection_secrets to service_role;

create table if not exists public.buffer_oauth_states (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  connection_revision integer not null check(connection_revision>0),
  state_hash text not null unique check(state_hash ~ '^[0-9a-f]{64}$'),
  binding_hash text not null check(binding_hash ~ '^[0-9a-f]{64}$'),
  verifier_ciphertext text not null check(length(verifier_ciphertext) between 1 and 2000),
  code_ciphertext text check(length(code_ciphertext) between 1 and 50000),
  status text not null default 'pending' check(status in ('pending','staged','exchanging')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '10 minutes'),
  foreign key(connection_id,user_id) references public.buffer_connections(id,user_id) on delete cascade,
  check(expires_at=created_at+interval '10 minutes'),
  check((status='pending' and code_ciphertext is null) or (status in ('staged','exchanging') and code_ciphertext is not null))
);
create index if not exists buffer_oauth_states_expiry_idx on public.buffer_oauth_states(expires_at);
alter table public.buffer_oauth_states enable row level security;
revoke all on public.buffer_oauth_states from public,anon,authenticated;
grant all on public.buffer_oauth_states to service_role;
alter table public.entitlements add column if not exists buffer_data_initialized boolean not null default false;
insert into public.entitlements(user_id,buffer_data_initialized) select user_id,true from public.buffer_connections
  on conflict(user_id) do update set buffer_data_initialized=true;

create or replace function public.buffer_connection_transition(
  p_user_id uuid,p_action text,p_connection_id uuid default null,p_revision integer default null,p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.buffer_connections; s public.buffer_oauth_states; v public.buffer_connection_secrets; lease uuid;
begin
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>150000 then raise exception 'buffer_invalid_input'; end if;
  if p_action='begin' then
    insert into public.buffer_connections(id,user_id) values(p_connection_id,p_user_id) on conflict(user_id) do nothing;
    select * into c from public.buffer_connections where user_id=p_user_id for update;
    if not found then return null; end if;
    if c.control_started_at>clock_timestamp()-interval '30 seconds' then raise exception 'buffer_rate_limited'; end if;
    update public.buffer_connections set control_started_at=clock_timestamp() where id=c.id returning * into c;
    -- A fresh OAuth round trip fences every older exchange, refresh and prepared
    -- delivery. Never let an old failure erase a newly started authorization.
    delete from public.buffer_connection_secrets where connection_id=c.id and user_id=p_user_id;
    delete from public.buffer_oauth_states where user_id=p_user_id;
    update public.buffer_connections set revision=revision+1,status='reauth-required',channels='[]',updated_at=now() where id=c.id returning * into c;
    insert into public.buffer_oauth_states(id,user_id,connection_id,connection_revision,state_hash,binding_hash,verifier_ciphertext)
      values((p_data->>'state_id')::uuid,p_user_id,c.id,c.revision,p_data->>'state_hash',p_data->>'binding_hash',p_data->>'verifier_ciphertext') returning * into s;
    insert into public.entitlements(user_id,buffer_data_initialized) values(p_user_id,true)
      on conflict(user_id) do update set buffer_data_initialized=true;
    return jsonb_build_object('connection',to_jsonb(c),'state',to_jsonb(s));
  end if;
  select * into c from public.buffer_connections where id=p_connection_id and user_id=p_user_id for update;
  if not found then return null; end if;
  if p_action='disconnect' then
    delete from public.buffer_connection_secrets where connection_id=c.id and user_id=p_user_id;
    delete from public.buffer_oauth_states where user_id=p_user_id;
    update public.buffer_connections set revision=revision+1,status='disconnected',channels='[]',buffer_account_id='',account_label='Buffer account',updated_at=now()
      where id=c.id returning * into c;
    return to_jsonb(c);
  end if;
  if c.revision is distinct from p_revision then return null; end if;
  if p_action in ('stage-code','claim-code','check-code','complete-code') then
    select * into s from public.buffer_oauth_states where id=(p_data->>'state_id')::uuid and user_id=p_user_id and connection_id=c.id for update;
    if not found or s.connection_revision<>c.revision or s.expires_at<=now() or s.binding_hash is distinct from p_data->>'binding_hash' then return null; end if;
    if p_action='stage-code' then
      if s.status<>'pending' or s.state_hash is distinct from p_data->>'state_hash' then return null; end if;
      update public.buffer_oauth_states set status='staged',code_ciphertext=p_data->>'code_ciphertext' where id=s.id returning * into s;
      return to_jsonb(s);
    elsif p_action='claim-code' then
      if s.status<>'staged' then return null; end if;
      update public.buffer_oauth_states set status='exchanging' where id=s.id returning * into s;
      return to_jsonb(s);
    elsif p_action='check-code' then
      if s.status<>'exchanging' then return null; end if;
      return to_jsonb(s);
    else
      if s.status<>'exchanging' then return null; end if;
      insert into public.buffer_connection_secrets(connection_id,user_id,access_ciphertext,refresh_ciphertext,expires_at)
        values(c.id,p_user_id,p_data->>'access_ciphertext',p_data->>'refresh_ciphertext',(p_data->>'expires_at')::timestamptz)
        on conflict(connection_id) do update set access_ciphertext=excluded.access_ciphertext,refresh_ciphertext=excluded.refresh_ciphertext,expires_at=excluded.expires_at,lease_token=null,lease_until=null;
      update public.buffer_connections set revision=revision+1,status='connected',buffer_account_id=p_data->>'account_id',account_label=p_data->>'account_label',channels=p_data->'channels',updated_at=now()
        where id=c.id returning * into c;
      delete from public.buffer_oauth_states where user_id=p_user_id;
      return to_jsonb(c);
    end if;
  end if;
  if p_action='reauth' then
    if p_data ? 'lease_token' then
      select * into v from public.buffer_connection_secrets where connection_id=c.id and user_id=p_user_id for update;
      if not found or v.lease_token is distinct from (p_data->>'lease_token')::uuid then return null; end if;
    end if;
    delete from public.buffer_connection_secrets where connection_id=c.id and user_id=p_user_id;
    delete from public.buffer_oauth_states where user_id=p_user_id;
    update public.buffer_connections set revision=revision+1,status='reauth-required',channels='[]',updated_at=now() where id=c.id returning * into c;
    return to_jsonb(c);
  end if;
  if c.status<>'connected' then return null; end if;
  if p_action='claim-channels' then
    if c.control_started_at>clock_timestamp()-interval '30 seconds' then raise exception 'buffer_rate_limited'; end if;
    update public.buffer_connections set control_started_at=clock_timestamp() where id=c.id returning * into c;
    return to_jsonb(c);
  end if;
  if p_action='check' then return to_jsonb(c); end if;
  select * into v from public.buffer_connection_secrets where connection_id=c.id and user_id=p_user_id for update;
  if not found then return null; end if;
  if p_action='claim-refresh' then
    if v.lease_token is not null then return jsonb_build_object('busy',true,'expired',v.lease_until<=now(),'lease_token',v.lease_token); end if;
    if v.expires_at>now()+interval '60 seconds' then return jsonb_build_object('fresh',true); end if;
    lease:=gen_random_uuid();
    update public.buffer_connection_secrets set lease_token=lease,lease_until=now()+interval '60 seconds' where connection_id=c.id returning * into v;
    return to_jsonb(v);
  elsif p_action='complete-refresh' then
    if v.lease_token is null or v.lease_token is distinct from (p_data->>'lease_token')::uuid or v.lease_until<=now() then return null; end if;
    update public.buffer_connection_secrets set access_ciphertext=p_data->>'access_ciphertext',refresh_ciphertext=p_data->>'refresh_ciphertext',expires_at=(p_data->>'expires_at')::timestamptz,lease_token=null,lease_until=null where connection_id=c.id;
    return to_jsonb(c);
  elsif p_action='channels' then
    if v.lease_token is not null or c.buffer_account_id is distinct from p_data->>'account_id' then return null; end if;
    update public.buffer_connections set revision=revision+case when channels is distinct from p_data->'channels' or account_label is distinct from p_data->>'account_label' then 1 else 0 end,
      account_label=p_data->>'account_label',channels=p_data->'channels',updated_at=now() where id=c.id returning * into c;
    return to_jsonb(c);
  end if;
  raise exception 'buffer_invalid_action';
end $$;
revoke all on function public.buffer_connection_transition(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.buffer_connection_transition(uuid,text,uuid,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
