\set ON_ERROR_STOP on
create schema phase6_test;
create sequence phase6_test.assertions;
grant usage on schema phase6_test to authenticated, anon;
grant usage, select on sequence phase6_test.assertions to authenticated, anon;
create function phase6_test.ok(value boolean, label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'Assertion failed: %', label; end if;
  perform nextval('phase6_test.assertions');
end;
$$;
create function phase6_test.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then raise exception 'Expected error containing %, received %', expected, sqlerrm; end if;
    perform phase6_test.ok(true, expected);
    return;
  end;
  raise exception 'Expected failure but operation succeeded: %', statement;
end;
$$;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000061'),
  ('00000000-0000-0000-0000-000000000062'),
  ('00000000-0000-0000-0000-000000000063'),
  ('00000000-0000-0000-0000-000000000064');
insert into public.profiles(id, name, email) values
  ('00000000-0000-0000-0000-000000000061', 'A', 'a@example.test'),
  ('00000000-0000-0000-0000-000000000062', 'B', 'b@example.test'),
  ('00000000-0000-0000-0000-000000000063', 'C', 'c@example.test'),
  ('00000000-0000-0000-0000-000000000064', 'D', 'd@example.test');
insert into public.friendships(requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000062', 'accepted'),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000063', 'accepted');

\set split_a '[{"key":"mon","label":"Mon","muscles":["Chest"]},{"key":"tue","label":"Tue","muscles":["Back"]},{"key":"wed","label":"Wed","muscles":["Legs"]},{"key":"thu","label":"Thu","muscles":[]},{"key":"fri","label":"Fri","muscles":["Chest","Triceps"]},{"key":"sat","label":"Sat","muscles":["Back","Biceps"]},{"key":"sun","label":"Sun","muscles":["Shoulders"]}]'
\set split_b '[{"key":"mon","label":"Mon","muscles":["Legs"]},{"key":"tue","label":"Tue","muscles":["Chest"]},{"key":"wed","label":"Wed","muscles":["Back"]},{"key":"thu","label":"Thu","muscles":[]},{"key":"fri","label":"Fri","muscles":["Legs"]},{"key":"sat","label":"Sat","muscles":["Biceps"]},{"key":"sun","label":"Sun","muscles":["Triceps"]}]'
\set split_c '[{"key":"mon","label":"Mon","muscles":["Shoulders"]},{"key":"tue","label":"Tue","muscles":["Legs"]},{"key":"wed","label":"Wed","muscles":["Chest"]},{"key":"thu","label":"Thu","muscles":[]},{"key":"fri","label":"Fri","muscles":["Back"]},{"key":"sat","label":"Sat","muscles":["Shoulders"]},{"key":"sun","label":"Sun","muscles":["Legs"]}]'
select jsonb_set(:'split_a'::jsonb, '{0,muscles}', '["Triceps"]'::jsonb) as split_a_updated \gset
select jsonb_set(:'split_b'::jsonb, '{0,muscles}', '["Chest"]'::jsonb) as split_b_updated \gset

set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select phase6_test.expect_error(format('select public.request_split_sync(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000062', :'split_a'::jsonb - 6), 'seven weekday keys');
select phase6_test.expect_error(format('select public.request_split_sync(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000062', jsonb_set(:'split_a'::jsonb, '{6,key}', '"sat"'::jsonb)), 'seven weekday keys');
select phase6_test.expect_error(format('select public.request_split_sync(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000062', jsonb_set(:'split_a'::jsonb, '{0,label}', '"Monday"'::jsonb)), 'seven weekday keys');
select phase6_test.expect_error(format('select public.request_split_sync(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000062', jsonb_set(:'split_a'::jsonb, '{0,muscles}', '["Chest","Core"]'::jsonb)), 'seven weekday keys');
select phase6_test.expect_error(format('select public.request_split_sync(%L, %L::jsonb)',
  '00000000-0000-0000-0000-000000000062', jsonb_set(:'split_a'::jsonb, '{0}', '{"key":"mon","label":"Mon","extra":true}'::jsonb)), 'seven weekday keys');
select phase6_test.ok(not exists(select 1 from public.split_sync_requests), 'invalid request creates no consent row');
select public.request_split_sync('00000000-0000-0000-0000-000000000062', :'split_a'::jsonb);
reset role;
select id as ab_request from public.split_sync_requests where requester_id='00000000-0000-0000-0000-000000000061' and addressee_id='00000000-0000-0000-0000-000000000062' \gset

set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000062';
select public.respond_split_sync(:'ab_request'::uuid, true);
select phase6_test.ok((public.get_split_sync_members() @> '[{"user_id":"00000000-0000-0000-0000-000000000061"},{"user_id":"00000000-0000-0000-0000-000000000062"}]'::jsonb)
  and jsonb_array_length(public.get_split_sync_members())=2, 'accepted pair exposes exactly the two direct members including self');
select public.request_split_sync('00000000-0000-0000-0000-000000000063', :'split_b'::jsonb);
reset role;
select id as bc_request from public.split_sync_requests where requester_id='00000000-0000-0000-0000-000000000062' and addressee_id='00000000-0000-0000-0000-000000000063' \gset

set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000063';
select public.respond_split_sync(:'bc_request'::uuid, true);
select phase6_test.ok(jsonb_array_length(public.get_split_sync_members())=2
  and public.get_split_sync_members() @> '[{"user_id":"00000000-0000-0000-0000-000000000062"}]'::jsonb,
  'B to C consent does not create an indirect A to C membership');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select phase6_test.ok(jsonb_array_length(public.get_split_sync_members())=2
  and not public.get_split_sync_members() @> '[{"user_id":"00000000-0000-0000-0000-000000000063"}]'::jsonb,
  'A membership includes B but excludes B second-degree friend C');

-- Prepare portable and private workout examples. Sensitive columns must never
-- leave the database through the social performance RPC.
reset role;
insert into public.exercises(name,primary_muscle,secondary_muscle,is_strength_exercise)
values('Unknown test lift','Chest',null,0) on conflict(name) do nothing;
insert into public.workout_sessions(id,user_id,workout_date,notes,machine_profile_id) values
  (601,'00000000-0000-0000-0000-000000000061','2026-10-01','private note A','private-machine-A'),
  (602,'00000000-0000-0000-0000-000000000062','2026-10-02','private note B','private-machine-B'),
  (603,'00000000-0000-0000-0000-000000000063','2026-10-03','private note C',null),
  (604,'00000000-0000-0000-0000-000000000061','2026-10-04','cable note','private-cable'),
  (605,'00000000-0000-0000-0000-000000000061','2026-10-05','unknown note',null),
  (606,'00000000-0000-0000-0000-000000000061','2026-10-06','mixed note','private-mixed');
insert into public.workout_sets(id,user_id,session_id,exercise_id,set_number,reps,weight,is_warmup) values
  (701,'00000000-0000-0000-0000-000000000061',601,(select id from public.exercises where name='Barbell Bench Press'),1,8,185,false),
  (702,'00000000-0000-0000-0000-000000000062',602,(select id from public.exercises where name='Dumbbell Bench Press'),1,8,75,false),
  (703,'00000000-0000-0000-0000-000000000063',603,(select id from public.exercises where name='Barbell Bench Press'),1,8,195,false),
  (704,'00000000-0000-0000-0000-000000000061',604,(select id from public.exercises where name='Cable Fly'),1,8,30,false),
  (705,'00000000-0000-0000-0000-000000000061',605,(select id from public.exercises where name='Unknown test lift'),1,8,30,false),
  (706,'00000000-0000-0000-0000-000000000061',606,(select id from public.exercises where name='Barbell Bench Press'),1,8,185,false),
  (707,'00000000-0000-0000-0000-000000000061',606,(select id from public.exercises where name='Cable Fly'),2,8,30,false);
insert into public.body_measurement_logs(user_id,weight,measurements,notes,logged_date)
values('00000000-0000-0000-0000-000000000061',180,'{"waist":90}'::jsonb,'private body note','2026-10-01');
insert into public.leaderboard_score_snapshots(user_id,exercise_id,exercise_name,best_score,best_sets,achieved_at) values
  ('00000000-0000-0000-0000-000000000061',(select id from public.exercises where name='Barbell Bench Press'),'Barbell Bench Press',250,'[{"weight":185,"reps":8}]','2026-10-01'),
  ('00000000-0000-0000-0000-000000000062',(select id from public.exercises where name='Barbell Bench Press'),'Barbell Bench Press',275,'[{"weight":205,"reps":8}]','2026-10-02');

set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select public.social_performance_records() as records \gset
select phase6_test.ok((:'records'::jsonb->'sessions' @> '[{"id":601,"user_id":"00000000-0000-0000-0000-000000000061","workout_date":"2026-10-01"},{"id":602,"user_id":"00000000-0000-0000-0000-000000000062","workout_date":"2026-10-02"}]'::jsonb)
  and not exists(select 1 from jsonb_array_elements(:'records'::jsonb->'sessions') item where item->>'id' in ('603','604','605','606')),
  'social performance returns owner and direct friend canonical freeweight sessions only');
select phase6_test.ok(jsonb_array_length(:'records'::jsonb->'sets')=2
  and not (:'records'::jsonb ? 'notes') and not (:'records'::jsonb ? 'machine_profile_id')
  and position('private note' in :'records')=0 and position('private-machine' in :'records')=0
  and position('private body' in :'records')=0,
  'social performance omits notes, machine tags and body observations');
select phase6_test.ok((select count(*)=0 from public.workout_sessions where user_id='00000000-0000-0000-0000-000000000062')
  and (select count(*)=0 from public.workout_sets where user_id='00000000-0000-0000-0000-000000000062'),
  'raw workout sessions and sets are owner-only');
select phase6_test.ok((select count(*)=0 from public.profiles where id='00000000-0000-0000-0000-000000000062')
  and (select count(*)=1 from public.profiles where id=auth.uid()),
  'raw profile rows including friend email remain owner-only');
select phase6_test.ok((select count(*)=0 from public.leaderboard_score_snapshots where user_id='00000000-0000-0000-0000-000000000062')
  and (select count(*)=1 from public.leaderboard_score_snapshots where user_id=auth.uid()),
  'leaderboard snapshots are also owner-only');
select public.social_profiles() as social_profiles \gset
select phase6_test.ok(:'social_profiles'::jsonb @> '[{"id":"00000000-0000-0000-0000-000000000061","name":"A"},{"id":"00000000-0000-0000-0000-000000000062","name":"B"}]'::jsonb
  and not :'social_profiles'::jsonb @> '[{"id":"00000000-0000-0000-0000-000000000063"}]'::jsonb
  and position('email' in :'social_profiles')=0,
  'social profile projection returns direct friend names without emails or transitive users');

-- A saves to A+B only. C remains unchanged despite B-C consent.
select public.save_shared_training_split(:'split_a_updated'::jsonb);
reset role;
select phase6_test.ok((select split_days=:'split_a_updated'::jsonb from public.shared_training_splits where user_id='00000000-0000-0000-0000-000000000062')
  and (select split_days=:'split_b'::jsonb from public.shared_training_splits where user_id='00000000-0000-0000-0000-000000000063'),
  'A save reaches its direct B recipient but never C');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select phase6_test.expect_error(format('select public.save_shared_training_split(%L::jsonb)', jsonb_set(:'split_a'::jsonb,'{0,muscles}','["Chest","Core"]'::jsonb)), 'seven weekday keys');
select phase6_test.ok((select split_days=:'split_a_updated'::jsonb from public.shared_training_splits where user_id='00000000-0000-0000-0000-000000000061'),
  'invalid shared save changes no existing rows');

-- Removing B-C immediately excludes C from both consent membership and later
-- writes; A-B remains independently accepted.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000062';
select public.remove_split_sync('00000000-0000-0000-0000-000000000063');
select phase6_test.ok(jsonb_array_length(public.get_split_sync_members())=2
  and not public.get_split_sync_members() @> '[{"user_id":"00000000-0000-0000-0000-000000000063"}]'::jsonb,
  'removing B-C consent removes C from B scope while preserving A-B');
select public.save_shared_training_split(:'split_b_updated'::jsonb);
reset role;
select phase6_test.ok((select split_days=:'split_b_updated'::jsonb from public.shared_training_splits where user_id='00000000-0000-0000-0000-000000000062')
  and (select split_days=:'split_b'::jsonb from public.shared_training_splits where user_id='00000000-0000-0000-0000-000000000063'),
  'post-disconnect B saves do not propagate to C');

-- No caller identity means no social data, and anonymous role cannot execute
-- the projection RPCs.
set role authenticated;
set request.jwt.claim.sub='';
select phase6_test.expect_error('select public.social_performance_records()', 'log in again');
reset role;
set role anon;
select phase6_test.expect_error('select public.social_performance_records()', 'permission denied');
select phase6_test.expect_error('select public.social_profiles()', 'permission denied');
select phase6_test.expect_error('select public.get_split_sync_members()', 'permission denied');
reset role;
select 'Phase 6 sharing: '||last_value||' assertions passed' from phase6_test.assertions;
