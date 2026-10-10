\set ON_ERROR_STOP on
do $$
begin
  if not exists (
    select 1 from public.shared_training_splits
    where user_id='00000000-0000-0000-0000-000000000069'
      and split_days='[{"key":"mon","label":"Monday","muscles":["Retired Muscle"]}]'::jsonb
      and updated_by='00000000-0000-0000-0000-000000000069'
      and updated_by_name='Legacy'
  ) then raise exception 'Phase 6 migration changed malformed legacy split evidence'; end if;
end;
$$;
