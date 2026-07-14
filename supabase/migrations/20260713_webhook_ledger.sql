-- M17.2 follow-up: older production installs may predate the M12 Polar
-- idempotency ledger. The table contains webhook ids only, is server-written,
-- and has no client policies; RLS therefore denies anon/authenticated access.

begin;

create table if not exists public.webhook_events (
  id text primary key,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;

commit;
