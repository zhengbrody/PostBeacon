-- Read-only parent/owner audit. Run after the base schema and ownership migration.
-- No identities or content are returned. Existing mismatches/orphans are counts only.
with
expected_links(child_table,parent_column,parent_table,constraint_name) as (values
  ('campaigns','project_id','projects','campaigns_project_owner_fkey'),
  ('experiments','campaign_id','campaigns','experiments_campaign_owner_fkey'),
  ('outcomes','experiment_id','experiments','outcomes_experiment_owner_fkey'),
  ('tasks','campaign_id','campaigns','tasks_campaign_owner_fkey')
),
matching_fks as (
  select l.child_table from expected_links l
  join pg_constraint c on c.conrelid=to_regclass('public.'||l.child_table)
    and c.conname=l.constraint_name
    and c.contype='f' and c.convalidated and c.confdeltype='c' and not c.condeferrable
    and c.confrelid=to_regclass('public.'||l.parent_table)
    and c.conkey=array[
      (select attnum from pg_attribute where attrelid=c.conrelid and attname=l.parent_column and not attisdropped),
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='user_id' and not attisdropped)
    ]
    and c.confkey=array[
      (select attnum from pg_attribute where attrelid=c.confrelid and attname='id' and not attisdropped),
      (select attnum from pg_attribute where attrelid=c.confrelid and attname='user_id' and not attisdropped)
    ]
),
expected_parents(table_name) as (values ('projects'),('campaigns'),('experiments')),
matching_unique_parents as (
  select distinct p.table_name from expected_parents p
  join pg_index i on i.indrelid=to_regclass('public.'||p.table_name)
    and i.indisunique and i.indisvalid and i.indisready
    and i.indpred is null and i.indexprs is null and i.indnkeyatts=2
    and i.indkey[0]=(select attnum from pg_attribute where attrelid=i.indrelid and attname='id' and not attisdropped)
    and i.indkey[1]=(select attnum from pg_attribute where attrelid=i.indrelid and attname='user_id' and not attisdropped)
),
expected_required(table_name,column_name) as (values
  ('projects','user_id'),('campaigns','user_id'),('experiments','user_id'),
  ('outcomes','user_id'),('tasks','user_id'),('campaigns','project_id'),
  ('experiments','campaign_id'),('outcomes','experiment_id'),('tasks','campaign_id')
),
checks(sort_order,check_name,expected,actual,detail) as (
  select 1,'parent owner composite uniqueness',3,count(*)::int,
    'projects, campaigns and experiments each have a valid unique (id,user_id) index'
    from matching_unique_parents
  union all
  select 2,'validated owner-bound cascading foreign keys',4,count(*)::int,
    'all four exact parent/user references are immediate, validated and ON DELETE CASCADE'
    from matching_fks
  union all
  select 3,'required owner and parent columns',9,count(*)::int,
    'required user_id and parent id columns cannot bypass composite checks through NULL'
    from expected_required e join information_schema.columns c
      on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
      and c.is_nullable='NO'
  union all
  select 4,'campaign project ownership violations',0,count(*)::int,
    'zero missing parents or owner mismatches; no data is automatically repaired'
    from public.campaigns c left join public.projects p on p.id=c.project_id
      where c.project_id is not null and (p.id is null or c.user_id is distinct from p.user_id)
  union all
  select 5,'experiment campaign ownership violations',0,count(*)::int,
    'zero missing parents or owner mismatches'
    from public.experiments e left join public.campaigns c on c.id=e.campaign_id
      where e.campaign_id is not null and (c.id is null or e.user_id is distinct from c.user_id)
  union all
  select 6,'outcome experiment ownership violations',0,count(*)::int,
    'zero missing parents or owner mismatches'
    from public.outcomes o left join public.experiments e on e.id=o.experiment_id
      where o.experiment_id is not null and (e.id is null or o.user_id is distinct from e.user_id)
  union all
  select 7,'task campaign ownership violations',0,count(*)::int,
    'zero missing parents or owner mismatches'
    from public.tasks t left join public.campaigns c on c.id=t.campaign_id
      where t.campaign_id is not null and (c.id is null or t.user_id is distinct from c.user_id)
)
select check_name,expected,actual,case when actual=expected then 'PASS' else 'FAIL' end as status,detail
from checks order by sort_order;
