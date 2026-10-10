\set ON_ERROR_STOP on
do $$
declare
  current_snapshot jsonb;
begin
  select jsonb_build_object(
    'exercises', (select jsonb_agg(to_jsonb(record) order by id) from public.exercises record),
    'sessions', (select jsonb_agg(to_jsonb(record) order by id) from public.workout_sessions record),
    'sets', (select jsonb_agg(to_jsonb(record) order by id) from public.workout_sets record),
    'preferences', (select jsonb_agg(to_jsonb(record) order by user_id, exercise_id) from public.user_exercise_preferences record),
    'configs', (select jsonb_agg(to_jsonb(record) order by id) from public.muscle_strength_config record),
    'legacyBody', (select jsonb_agg(to_jsonb(record) order by id) from public.body_weight_logs record),
    'modernBody', (select jsonb_agg(to_jsonb(record) order by id) from public.body_measurement_logs record),
    'settings', (select jsonb_agg(to_jsonb(record) order by user_id, key) from public.app_settings record),
    'policies', (select jsonb_agg(to_jsonb(record) order by tablename, policyname) from pg_policies record where schemaname = 'public')
  ) into current_snapshot;
  if current_snapshot <> (select snapshot from public.phase1_catalog_expected) then
    raise exception 'A refused catalog installation changed valuable existing data';
  end if;
end;
$$;
select 'Ambiguous migration rejection assertions passed';
