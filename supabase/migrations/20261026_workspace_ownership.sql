-- P1: parent ownership is a database invariant, not just a client-side check.
-- Additive repair. Run deliberately, then audit-workspace-ownership.sql.
-- Existing mismatches/orphans abort without deleting or reassigning any data.
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
