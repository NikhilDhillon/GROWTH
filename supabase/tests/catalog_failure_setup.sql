\set ON_ERROR_STOP on

insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.workout_sessions (user_id, workout_date, notes)
values ('00000000-0000-0000-0000-000000000001', '2026-10-08', 'must survive catalog failure') returning id as session_id \gset
insert into public.workout_sets (user_id, session_id, exercise_id, set_number, reps, weight)
values ('00000000-0000-0000-0000-000000000001', :session_id, 1, 1, 5, 100);
insert into public.user_exercise_preferences (user_id, exercise_id, enabled)
values ('00000000-0000-0000-0000-000000000001', 1, 1);
insert into public.muscle_strength_config (user_id, muscle_group, exercise_id, weight_factor)
values ('00000000-0000-0000-0000-000000000001', 'Chest', 1, 2);
insert into public.body_weight_logs (user_id, logged_date, weight)
values ('00000000-0000-0000-0000-000000000001', '2026-09-01', 199);
insert into public.body_measurement_logs (user_id, logged_date, weight, measurements)
values ('00000000-0000-0000-0000-000000000001', '2026-10-08', 200, '{"waist":86}');

\if :missing_fk
alter table public.workout_sets drop constraint workout_sets_session_id_fkey;
\elif :legacy
alter table public.exercises add column user_id uuid;
update public.exercises set user_id = '00000000-0000-0000-0000-000000000001' where id = 1;
drop policy "standard exercises are readable by authenticated users" on public.exercises;
create policy "exercises are owned by their user" on public.exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
\else
drop index public.exercises_name_idx;
insert into public.exercises (name, primary_muscle)
select name, primary_muscle from public.exercises where id = 1;
\endif

create table public.phase1_catalog_expected as
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
) as snapshot;
