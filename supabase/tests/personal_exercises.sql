\set ON_ERROR_STOP on
reset role;
select case when is_called then last_value else 0 end as personal_assertions_before from phase1_test.assertions \gset
-- 31 creates, 32 shares workouts with 31, 33 is a stranger, 34 is a friend who does not share workouts.
insert into auth.users values ('00000000-0000-0000-0000-000000000031'), ('00000000-0000-0000-0000-000000000032'),
  ('00000000-0000-0000-0000-000000000033'), ('00000000-0000-0000-0000-000000000034');
insert into public.friendships (requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032', 'accepted'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000034', 'accepted');
insert into public.split_sync_requests (requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032', 'accepted');
set request.jwt.claim.role='authenticated';

-- Creating: names are cleaned, retries return the same exercise, and catalog names are refused.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000031';
set role authenticated;
select (public.create_custom_exercise('  Landmine   Press ', 'Chest', 'external')->>'id')::bigint as landmine \gset
select phase1_test.assert_true((select display_name='Landmine Press' and name='personal:'||id and creator_id='00000000-0000-0000-0000-000000000031' and load_type='external' from public.exercises where id=:landmine),'a personal exercise is cleaned, owned, typed and keyed apart from catalog names');
select phase1_test.assert_true((public.create_custom_exercise('landmine press', 'Chest', 'external')->>'id')::bigint=:landmine,'a retried create returns the same exercise');
select phase1_test.expect_error($$select public.create_custom_exercise('Landmine Press', 'Back', 'external')$$,'You already have an exercise named Landmine Press');
select phase1_test.expect_error($$select public.create_custom_exercise('barbell bench press', 'Chest', 'external')$$,'Barbell Bench Press is already in the exercise list');
select phase1_test.expect_error($$select public.create_custom_exercise('X', 'Chest', 'external')$$,'Exercise names need 2 to 60 characters');
select phase1_test.expect_error($$select public.create_custom_exercise('Pec Deck', 'Glutes', 'external')$$,'Choose the main muscle');
select phase1_test.expect_error($$select public.create_custom_exercise('Pec Deck', 'Chest', 'kettlebell')$$,'Choose how this exercise is loaded');
select phase1_test.expect_error($$insert into public.exercises (name, primary_muscle) values ('Sneaky Press', 'Chest')$$,'row-level security');
select phase1_test.expect_error($$select * from public.custom_exercise_access$$,'permission denied');
select phase1_test.assert_true((select count(*) > 60 from public.exercises where creator_id is null),'the catalog stays readable');

-- Another account may use the same name for its own exercise.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
select (public.create_custom_exercise('Landmine Press', 'Shoulders', 'external')->>'id')::bigint as stranger_landmine \gset
select phase1_test.assert_true(:stranger_landmine <> :landmine,'names repeat across accounts as separate exercises');
select phase1_test.assert_true((select array_agg(id)=array[:stranger_landmine]::bigint[] from public.exercises where creator_id is not null),'a stranger sees only their own personal exercises');
select phase1_test.expect_error(format($$select public.save_workout_session(%s,'2026-10-24','',null,'[{"reps":8,"weight":60}]',null,null,'lb','manual')$$, :landmine),'That exercise is not shared with this account');
select phase1_test.expect_error(format($$insert into public.user_exercise_preferences (user_id, exercise_id, enabled) values (auth.uid(), %s, 1)$$, :landmine),'That exercise is not shared with this account');

-- A friend who does not share workouts cannot see it either.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000034';
select phase1_test.assert_true((select count(*)=0 from public.exercises where creator_id is not null),'friendship alone does not share personal exercises');

-- A split-sync friend sees it and can log it; logging keeps it readable after sharing ends.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000032';
select phase1_test.assert_true((select array_agg(id)=array[:landmine]::bigint[] from public.exercises where creator_id is not null),'a split-sync friend sees the exercise, and not strangers ones');
select public.save_workout_session(:landmine,'2026-10-24','',null,'[{"reps":10,"weight":50}]',null,null,'lb','manual') as friend_session \gset
select phase1_test.assert_true((select count(*)=1 from public.workout_sets where session_id=:friend_session and exercise_id=:landmine),'a split-sync friend can log the shared exercise');
reset role;
update public.split_sync_requests set status='declined' where requester_id='00000000-0000-0000-0000-000000000031';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000031';
set role authenticated;
select (public.create_custom_exercise('Pec Deck', 'Chest', 'machine_stack')->>'id')::bigint as pec_deck \gset
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000032';
select phase1_test.assert_true((select array_agg(id)=array[:landmine]::bigint[] from public.exercises where creator_id is not null),'a logged exercise stays readable after sharing ends, later ones do not');
select public.save_workout_session(:landmine,'2026-10-24','edited',null,'[{"reps":11,"weight":50}]',:friend_session);
select phase1_test.assert_true((select reps=11 from public.workout_sets where session_id=:friend_session),'history with a formerly shared exercise can still be edited');
select phase1_test.expect_error(format($$select public.save_workout_session(%s,'2026-10-24','',null,'[{"reps":8,"weight":60}]',null,null,'lb','manual')$$, :pec_deck),'That exercise is not shared with this account');

-- Leaderboards never rank personal exercises.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000031';
select public.save_workout_session(:landmine,'2026-10-24','',null,'[{"reps":8,"weight":95}]',null,null,'lb','manual') as owner_session \gset
select phase1_test.assert_true(not exists (
  select 1 from jsonb_array_elements(public.social_performance_records()->'sessions') item where (item->>'id')::bigint in (:owner_session, :friend_session)
),'personal exercises stay off leaderboards');

-- Catalog names stay unique among catalog rows.
reset role;
select phase1_test.expect_error($$insert into public.exercises (name, primary_muscle) values ('Barbell Bench Press', 'Chest')$$,'duplicate key');
select phase1_test.expect_error($$insert into public.exercises (name, display_name, primary_muscle, creator_id) values ('Loadless', 'Loadless', 'Chest', '00000000-0000-0000-0000-000000000031')$$,'exercises_personal_shape_check');

reset role;
select format('%s personal exercise assertions passed', (select last_value from phase1_test.assertions) - :personal_assertions_before);
