-- M24.1: persist each checkpoint's contemporaneous verdict. Existing rows
-- remain null: the application labels their experiment-level read as a
-- historical final verdict instead of fabricating a 24h/72h association.

begin;

alter table public.outcomes
  add column if not exists verdict jsonb;

comment on column public.outcomes.verdict is
  'Code-computed verdict for this exact checkpoint; null on legacy rows whose checkpoint verdict cannot be reconstructed.';

notify pgrst, 'reload schema';

commit;
