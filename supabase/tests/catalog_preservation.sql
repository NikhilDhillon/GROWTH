\set ON_ERROR_STOP on

insert into public.exercises (name, primary_muscle, is_strength_exercise)
values ('Custom exercise to preserve', 'Chest', 1) returning id as custom_exercise_id \gset
insert into public.workout_sessions (user_id, workout_date, notes, machine_profile_id)
values ('00000000-0000-0000-0000-000000000001', '2026-10-08', 'catalog preserved workout', 'custom-machine')
returning id as custom_session_id \gset
insert into public.workout_sets (user_id, session_id, exercise_id, set_number, reps, weight)
values ('00000000-0000-0000-0000-000000000001', :custom_session_id, :custom_exercise_id, 1, 5, 100);
insert into public.user_exercise_preferences (user_id, exercise_id, enabled)
values ('00000000-0000-0000-0000-000000000001', :custom_exercise_id, 1);
insert into public.muscle_strength_config (user_id, muscle_group, exercise_id, weight_factor)
values ('00000000-0000-0000-0000-000000000001', 'Chest', :custom_exercise_id, 2);

-- A familiar catalog name can carry legitimate historical classification and
-- selection state. Installation must not rewrite those values or references.
select id as legacy_standard_id from public.exercises where name = 'Barbell Bench Press' \gset
update public.exercises set primary_muscle = 'Shoulders', secondary_muscle = 'Triceps', is_strength_exercise = 1
where id = :legacy_standard_id;
insert into public.muscle_strength_config (user_id, muscle_group, exercise_id, weight_factor)
values ('00000000-0000-0000-0000-000000000001', 'Shoulders', :legacy_standard_id, 0.5);

create temporary table original_exercises as select * from public.exercises;
create temporary table original_sessions as select * from public.workout_sessions;
create temporary table original_sets as select * from public.workout_sets;
create temporary table original_preferences as select * from public.user_exercise_preferences;
create temporary table original_configs as select * from public.muscle_strength_config;
\ir ../standard_exercise_catalog.sql
\ir ../standard_exercise_catalog.sql
\ir ../schema.sql
\ir ../schema.sql
select phase1_test.assert_true(not exists (
  select 1 from original_exercises original left join public.exercises current on current.id = original.id
  where current.id is null or to_jsonb(current) <> to_jsonb(original)
), 'catalog reruns preserve every existing exercise ID and value');
select phase1_test.assert_true(
  (select jsonb_agg(to_jsonb(original) order by id) from original_sessions original)
    = (select jsonb_agg(to_jsonb(current) order by id) from public.workout_sessions current),
  'catalog reruns preserve existing sessions and equipment context');
-- The current schema may add capture columns to an older table; existing rows
-- keep every original value and gain only unknown (null) capture metadata.
select phase1_test.assert_true(
  (select jsonb_agg(to_jsonb(original) - array['performed_at', 'evidence'] order by id) from original_sets original)
    = (select jsonb_agg(to_jsonb(current) - array['performed_at', 'evidence'] order by id) from public.workout_sets current)
    and not exists (select 1 from public.workout_sets current where current.performed_at is not null or current.evidence is not null),
  'catalog reruns preserve existing set observations');
select phase1_test.assert_true(
  (select jsonb_agg(to_jsonb(original) order by user_id, exercise_id) from original_preferences original)
    = (select jsonb_agg(to_jsonb(current) order by user_id, exercise_id) from public.user_exercise_preferences current),
  'catalog reruns preserve exercise selection');
select phase1_test.assert_true(
  (select jsonb_agg(to_jsonb(original) order by id) from original_configs original)
    = (select jsonb_agg(to_jsonb(current) order by id) from public.muscle_strength_config current),
  'catalog reruns preserve strength configuration');
select phase1_test.assert_true((select primary_muscle = 'Shoulders' and secondary_muscle = 'Triceps' and is_strength_exercise = 1
  from public.exercises where id = :legacy_standard_id and name = 'Barbell Bench Press'),
  'schema reruns retain nondefault historical classification and strength flag');
select phase1_test.assert_true(exists (select 1 from public.workout_sets where exercise_id = :legacy_standard_id)
  and exists (select 1 from public.user_exercise_preferences where exercise_id = :legacy_standard_id and enabled = 1)
  and exists (select 1 from public.muscle_strength_config where exercise_id = :legacy_standard_id and weight_factor = 0.5),
  'schema reruns retain existing standard-exercise observations and configuration references');
select 'Catalog/schema repeat-install preservation assertions passed: 7';
