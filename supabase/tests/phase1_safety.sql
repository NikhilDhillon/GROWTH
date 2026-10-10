\set ON_ERROR_STOP on

create schema phase1_test;
create sequence phase1_test.assertions;
grant usage on schema phase1_test to anon, authenticated;
grant usage, select on sequence phase1_test.assertions to anon, authenticated;
create function phase1_test.assert_true(value boolean, label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'Assertion failed: %', label; end if;
  perform nextval('phase1_test.assertions');
end;
$$;
create function phase1_test.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then raise exception 'Expected error containing %, received %', expected, sqlerrm; end if;
    perform phase1_test.assert_true(true, expected);
    return;
  end;
  raise exception 'Expected failure but operation succeeded: %', statement;
end;
$$;

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004');
insert into public.profiles (id, name, email) values
  ('00000000-0000-0000-0000-000000000001', 'A', 'a@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'B', 'b@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'C', 'c@example.test');

-- Simulate failures after the first write succeeds, not input validation errors.
create function phase1_test.fail_second_set() returns trigger language plpgsql as $$
begin
  if new.weight = 777 then raise exception 'Simulated second-set persistence failure'; end if;
  return new;
end;
$$;
create trigger test_second_set_failure before insert on public.workout_sets
  for each row execute function phase1_test.fail_second_set();
create function phase1_test.fail_snapshot() returns trigger language plpgsql as $$
begin
  if new.best_score = 777 then raise exception 'Simulated snapshot persistence failure'; end if;
  return new;
end;
$$;
create trigger test_snapshot_failure before insert on public.leaderboard_score_snapshots
  for each row execute function phase1_test.fail_snapshot();
create function phase1_test.fail_finish_delete() returns trigger language plpgsql as $$
begin
  if old.key = 'active_workout' and old.value::jsonb->>'startedAt' = 'finish-fail' then
    raise exception 'Simulated active-workout deletion failure';
  end if;
  return old;
end;
$$;
create trigger test_finish_failure before delete on public.app_settings
  for each row execute function phase1_test.fail_finish_delete();

set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- Normal saves are atomic and stable across an ambiguous-success retry.
select public.save_workout_session(1, '2026-10-01', 'original', null,
  '[{"reps":5,"weight":100},{"reps":5,"weight":100}]', null, '10000000-0000-0000-0000-000000000001') as original_id \gset
select public.save_workout_session(1, '2026-10-01', 'original', null,
  '[{"reps":5,"weight":100},{"reps":5,"weight":100}]', null, '10000000-0000-0000-0000-000000000001') as retry_id \gset
select phase1_test.assert_true(:original_id = :retry_id, 'retry returns the original ID');
select public.save_workout_session(1, '2026-10-01', 'original', null,
  '[{"reps":5.0,"weight":100.00},{"reps":5,"weight":100}]', null, '10000000-0000-0000-0000-000000000001') as numeric_retry_id \gset
select phase1_test.assert_true(:original_id = :numeric_retry_id, 'equivalent numeric serialization preserves retry identity');
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions), 'retry records exactly one session');
select phase1_test.expect_error($test$
  insert into public.workout_sessions (workout_date, notes) values ('2026-10-08', 'legacy direct create')
$test$, 'permission denied');
select phase1_test.expect_error(format('update public.workout_sessions set notes = ''legacy destructive edit'' where id = %s', :original_id), 'permission denied');
select phase1_test.expect_error(format('delete from public.workout_sets where session_id = %s', :original_id), 'permission denied');
select public.update_workout_machine_profile(:original_id, 'test-machine');
select phase1_test.assert_true((select notes = 'original' and machine_profile_id = 'test-machine' from public.workout_sessions where id = :original_id), 'owned metadata update preserves other session values');
select phase1_test.assert_true((select count(*) = 2 and bool_and(weight = 100) from public.workout_sets where session_id = :original_id), 'metadata update preserves observed sets');
select phase1_test.expect_error($test$ select public.update_workout_machine_profile(-1, 'missing') $test$, 'unavailable');
select phase1_test.expect_error($test$
  select public.save_workout_session(1, '2026-10-01', 'changed', null,
    '[{"reps":5,"weight":101}]', null, '10000000-0000-0000-0000-000000000001')
$test$, 'different observations');
select phase1_test.expect_error(format($test$
  select public.save_workout_session(1, '2026-10-02', 'replacement', null,
    '[{"reps":6,"weight":110},{"reps":6,"weight":777}]', %s)
$test$, :original_id), 'Simulated second-set persistence failure');
select phase1_test.assert_true((select notes = 'original' and workout_date = '2026-10-01' and machine_profile_id = 'test-machine' from public.workout_sessions where id = :original_id), 'failed edit preserves original metadata');
select phase1_test.assert_true((select count(*) = 2 and bool_and(weight = 100) from public.workout_sets where session_id = :original_id), 'failed edit preserves all original sets');
select phase1_test.expect_error($test$
  select public.save_workout_session(1, '2026-10-02', 'new failure', null,
    '[{"reps":6,"weight":110},{"reps":6,"weight":777}]', null, '10000000-0000-0000-0000-000000000002')
$test$, 'Simulated second-set persistence failure');
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions), 'failed create leaves no partial session');
select phase1_test.assert_true(not has_table_privilege('authenticated', 'public.workout_write_requests', 'INSERT'), 'client cannot forge save receipts');

select public.replace_score_snapshots('[{"exercise_id":1,"exercise_name":"Bench","best_score":100,"best_sets":[{"reps":5,"weight":100}],"achieved_at":"2026-10-01"}]');
select phase1_test.expect_error($test$ delete from public.leaderboard_score_snapshots where user_id = auth.uid() $test$, 'permission denied');
select phase1_test.expect_error($test$
  select public.replace_score_snapshots('[{"exercise_id":1,"exercise_name":"Bench","best_score":110,"best_sets":[],"achieved_at":"2026-10-02"},{"exercise_id":2,"exercise_name":"Incline","best_score":777,"best_sets":[],"achieved_at":"2026-10-02"}]')
$test$, 'Simulated snapshot persistence failure');
select phase1_test.assert_true((select count(*) = 1 and bool_and(best_score = 100) from public.leaderboard_score_snapshots), 'failed replacement preserves prior snapshots');

-- Authority, consent, replay protection and revocation, including indirect paths.
select phase1_test.expect_error($test$
  insert into public.friendships (requester_id, addressee_id, status)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'accepted')
$test$, 'permission denied');
select phase1_test.assert_true(not has_table_privilege('authenticated', 'public.friendships', 'UPDATE'), 'one participant cannot manufacture acceptance by UPDATE');
select phase1_test.assert_true(not has_table_privilege('authenticated', 'public.friendships', 'TRUNCATE'), 'inherited broad grants cannot bypass row consent');
select phase1_test.assert_true(not has_table_privilege('authenticated', 'public.friend_invites', 'TRUNCATE'), 'used invitation receipts cannot be cleared through inherited grants');
insert into public.friend_invites (token, expires_at) values
  ('a-to-b', now() + interval '1 day'), ('a-to-c', now() + interval '1 day'),
  ('self', now() + interval '1 day'), ('expired', now() - interval '1 day');
select phase1_test.expect_error($test$ select public.accept_friend_invite('self') $test$, 'your own invite');
select phase1_test.expect_error($test$
  insert into public.friend_invites (token, expires_at, accepted_by)
  values ('forged-used-invite', now() + interval '1 day', '00000000-0000-0000-0000-000000000002')
$test$, 'row-level security');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.accept_friend_invite('a-to-b');
select public.accept_friend_invite('a-to-b');
select phase1_test.assert_true((select count(*) = 1 from public.friendships), 'double acceptance is idempotent');
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions where user_id = '00000000-0000-0000-0000-000000000001'), 'legitimate friend can read current shared workouts');
select phase1_test.expect_error(format($test$
  insert into public.workout_sets (session_id, exercise_id, set_number, reps, weight)
  values (%s, 1, 3, 5, 100)
$test$, :original_id), 'permission denied');
select phase1_test.expect_error(format('select public.update_workout_machine_profile(%s, ''foreign'')', :original_id), 'does not belong to you');
select phase1_test.expect_error(format($test$
  select public.save_workout_session(1, '2026-10-03', 'unauthorized edit', null,
    '[{"reps":1,"weight":1}]', %s)
$test$, :original_id), 'does not belong to you');
select phase1_test.expect_error($test$ select public.accept_friend_invite('expired') $test$, 'expired');
insert into public.friend_invites (token, expires_at) values ('b-to-c', now() + interval '1 day');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select phase1_test.expect_error($test$ select public.accept_friend_invite('a-to-b') $test$, 'already been used');
select public.accept_friend_invite('a-to-c');
select public.accept_friend_invite('b-to-c');
select public.remove_friend('00000000-0000-0000-0000-000000000004');
select phase1_test.assert_true((select count(*) = 2 from public.friendships), 'third party cannot revoke another pair');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select phase1_test.expect_error($test$ update public.friend_invites set accepted_by = null where token = 'a-to-b' $test$, 'permission denied');
delete from public.friend_invites where token = 'a-to-b';
select phase1_test.assert_true(exists (select 1 from public.friend_invites where token = 'a-to-b'), 'used invitation remains an immutable consent receipt');
select phase1_test.assert_true(not has_table_privilege('authenticated', 'public.split_sync_requests', 'INSERT'), 'split acceptance requires the authority RPC');
select public.request_split_sync('00000000-0000-0000-0000-000000000002', '[{"key":"mon","muscles":["Chest"]}]');
select id as ab_request from public.split_sync_requests where addressee_id = '00000000-0000-0000-0000-000000000002' \gset
select phase1_test.expect_error(format('select public.respond_split_sync(%L, true)', :'ab_request'), 'not available');
select public.request_split_sync('00000000-0000-0000-0000-000000000003', '[{"key":"mon","muscles":["Chest"]}]');
select id as ac_request from public.split_sync_requests where addressee_id = '00000000-0000-0000-0000-000000000003' \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.respond_split_sync(:'ab_request', true);
select public.request_split_sync('00000000-0000-0000-0000-000000000003', '[{"key":"mon","muscles":["Back"]}]');
select id as bc_request from public.split_sync_requests where addressee_id = '00000000-0000-0000-0000-000000000003' \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select public.respond_split_sync(:'ac_request', true);
select public.respond_split_sync(:'bc_request', true);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.remove_split_sync('00000000-0000-0000-0000-000000000002');
select public.remove_split_sync('00000000-0000-0000-0000-000000000002');
select phase1_test.assert_true((select status = 'declined' from public.split_sync_requests where id = :'ab_request'), 'unsync retains a durable opt-out');
select public.save_shared_training_split('[{"key":"mon","muscles":["Shoulders"]}]');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select phase1_test.assert_true((select split_days = '[{"key":"mon","muscles":["Chest"]}]'::jsonb from public.shared_training_splits), 'opt-out stops indirect incoming plan edits');
select public.save_shared_training_split('[{"key":"mon","muscles":["Traps"]}]');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select phase1_test.assert_true((select split_days = '[{"key":"mon","muscles":["Shoulders"]}]'::jsonb from public.shared_training_splits), 'opt-out stops indirect outgoing plan edits');
select public.request_split_sync('00000000-0000-0000-0000-000000000002', '[{"key":"mon","muscles":["Chest"]}]');
select public.save_shared_training_split('[{"key":"mon","muscles":["Back"]}]');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select phase1_test.assert_true((select split_days = '[{"key":"mon","muscles":["Traps"]}]'::jsonb from public.shared_training_splits), 'pending consent also prevents indirect edits');
select public.respond_split_sync(:'ab_request', true);
select phase1_test.assert_true((select split_days = '[{"key":"mon","muscles":["Back"]}]'::jsonb from public.shared_training_splits), 'fresh explicit consent restores plan sharing');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.save_shared_training_split('[{"key":"mon","muscles":["Chest"]}]');
select public.remove_friend('00000000-0000-0000-0000-000000000002');
select public.remove_friend('00000000-0000-0000-0000-000000000002');
select phase1_test.assert_true(not exists (select 1 from public.split_sync_requests where user_low = '00000000-0000-0000-0000-000000000001' and user_high = '00000000-0000-0000-0000-000000000002'), 'revocation severs direct split sync');
select phase1_test.assert_true(exists (select 1 from public.split_sync_requests where id = :'ac_request'), 'unrelated consenting sync survives');
select public.save_shared_training_split('[{"key":"mon","muscles":["Legs"]}]');
select phase1_test.expect_error($test$
  select public.request_split_sync('00000000-0000-0000-0000-000000000002', '[]')
$test$, 'accepted friend');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select phase1_test.assert_true((select count(*) = 0 from public.workout_sessions where user_id = '00000000-0000-0000-0000-000000000001'), 'revocation removes workout read access');
select phase1_test.assert_true((select count(*) = 0 from public.workout_sets where user_id = '00000000-0000-0000-0000-000000000001'), 'revocation removes set read access');
select phase1_test.assert_true((select count(*) = 0 from public.leaderboard_score_snapshots where user_id = '00000000-0000-0000-0000-000000000001'), 'revocation removes snapshot read access');
select phase1_test.assert_true((select count(*) = 0 from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'revocation removes profile read access');
select phase1_test.assert_true((select split_days = '[{"key":"mon","muscles":["Chest"]}]'::jsonb from public.shared_training_splits), 'alternate sync path cannot update former friend');
select phase1_test.expect_error($test$ select public.accept_friend_invite('a-to-b') $test$, 'already been used');

reset role;
delete from public.friendships where user_low = '00000000-0000-0000-0000-000000000002' and user_high = '00000000-0000-0000-0000-000000000003';
select phase1_test.assert_true(not exists (select 1 from public.split_sync_requests where id = :'bc_request'), 'admin revocation also cleans related sync');
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions), 'revocation preserves observed history');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- A successful create whose session was deliberately deleted cannot reappear
-- merely because an old browser retries the same request.
select public.save_workout_session(1, '2026-10-03', 'delete me', null, '[{"reps":5,"weight":50}]',
  null, '10000000-0000-0000-0000-000000000000') as deletion_id \gset
delete from public.workout_sessions where id = :deletion_id;
select phase1_test.expect_error($test$
  select public.save_workout_session(1, '2026-10-03', 'delete me', null, '[{"reps":5,"weight":50}]',
    null, '10000000-0000-0000-0000-000000000000')
$test$, 'was deleted');
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions), 'deleted save is not resurrected');

-- Body deletion removes the chosen observation while preserving the other.
insert into public.body_measurement_logs (weight, measurements, notes, logged_date)
values (200, '{"waist":90}', 'tape notes', '2026-10-01') returning id as body_id \gset
select public.delete_body_observation(:body_id, 'weight');
select phase1_test.assert_true((select weight is null and measurements = '{"waist":90}'::jsonb and notes = 'tape notes' from public.body_measurement_logs where id = :body_id), 'weight deletion preserves tape observations');
update public.body_measurement_logs set weight = 200 where id = :body_id;
select public.delete_body_observation(:body_id, 'measurements');
select phase1_test.assert_true((select weight = 200 and measurements = '{}'::jsonb from public.body_measurement_logs where id = :body_id), 'tape deletion preserves weight');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select phase1_test.expect_error(format('select public.delete_body_observation(%s, ''weight'')', :body_id), 'does not belong to you');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.delete_body_observation(:body_id, 'weight');
select public.delete_body_observation(:body_id, 'weight');
select phase1_test.assert_true(not exists (select 1 from public.body_measurement_logs where id = :body_id), 'final body observation deletion is idempotent');

-- Completing a workout is atomic, retains archives omitted by stale clients,
-- and cannot clear a different new workout on a late retry.
select phase1_test.expect_error($test$ select public.save_active_workout(null) $test$, 'identifier is required');
select phase1_test.expect_error($test$
  insert into public.app_settings (user_id, key, value)
  values ('00000000-0000-0000-0000-000000000001', 'active_workout', '{"startedAt":"bypass"}')
$test$, 'row-level security');
select phase1_test.assert_true(not has_table_privilege('authenticated', 'public.active_workout_retirements', 'INSERT'), 'client cannot forge draft retirement metadata');
reset role;
insert into public.app_settings (user_id, key, value)
values ('00000000-0000-0000-0000-000000000001', 'completed_guided_workouts',
  '[{"id":"legacy-current-id","startedAt":"finish-1"},{"id":"old","startedAt":"before"},{"id":"old","startedAt":"unrelated-legacy","notes":"preserve ambiguous identity"}]');
set role authenticated;
select public.save_active_workout('{"startedAt":"finish-1"}');
select phase1_test.expect_error($test$ select public.save_active_workout('{"startedAt":"different"}') $test$, 'different workout');
update public.app_settings set value = '{"startedAt":"bypass"}' where key = 'active_workout';
delete from public.app_settings where key = 'active_workout';
select phase1_test.assert_true((select value::jsonb->>'startedAt' = 'finish-1' from public.app_settings where key = 'active_workout'), 'direct update/delete cannot bypass active draft guard');
select phase1_test.expect_error($test$
  insert into public.app_settings (user_id, key, value) values
  ('00000000-0000-0000-0000-000000000001', 'completed_guided_workouts', '[]')
  on conflict (user_id, key) do update set value = excluded.value
$test$, 'row-level security');
select phase1_test.expect_error($test$
  select public.finalize_active_workout('finish-1', '[{"id":"one","startedAt":"finish-1"}]')
$test$, 'snapshot is required');
select phase1_test.assert_true((select value::jsonb->>'startedAt' = 'finish-1' from public.app_settings where key = 'active_workout'), 'obsolete no-snapshot completion fails closed');
select public.finalize_active_workout('finish-1',
  '[{"id":"one","startedAt":"finish-1"},{"id":"stale-restore","startedAt":"unrelated-deleted"},{"id":"old","startedAt":"before","notes":"stale client rewrite"}]',
  '{"startedAt":"finish-1"}');
select phase1_test.assert_true(not exists (select 1 from public.app_settings where key = 'active_workout'), 'successful finish clears its active draft');
select phase1_test.assert_true((select jsonb_array_length(value::jsonb) = 3 from public.app_settings where key = 'completed_guided_workouts'), 'finish preserves unrelated legacy entries without guessing their identity');
select phase1_test.assert_true((select count(*) = 1 from public.app_settings settings, jsonb_array_elements(settings.value::jsonb) summary
  where settings.key = 'completed_guided_workouts' and summary->>'startedAt' = 'finish-1'), 'explicit same-startedAt legacy event is not duplicated');
select phase1_test.assert_true(not exists (select 1 from public.app_settings settings, jsonb_array_elements(settings.value::jsonb) summary
  where settings.key = 'completed_guided_workouts' and summary->>'startedAt' = 'unrelated-deleted'), 'stale client extras cannot restore unrelated archives');
select phase1_test.assert_true((select value::jsonb->1 = '{"id":"old","startedAt":"before"}'::jsonb from public.app_settings where key = 'completed_guided_workouts'), 'stale client extras cannot rewrite server history');
select public.finalize_active_workout('finish-1', '[{"id":"changed","startedAt":"finish-1"}]');
select phase1_test.assert_true((select value::jsonb->0->>'id' = 'one' from public.app_settings where key = 'completed_guided_workouts'), 'duplicate finish does not overwrite archive');
select phase1_test.expect_error($test$ select public.save_active_workout('{"startedAt":"finish-1"}') $test$, 'already finished or discarded');
select public.save_active_workout('{"startedAt":"finish-2"}');
select phase1_test.expect_error($test$ select public.finalize_active_workout('finish-1', '[{"id":"one","startedAt":"finish-1"}]') $test$, 'different workout');
select phase1_test.assert_true((select value::jsonb->>'startedAt' = 'finish-2' from public.app_settings where key = 'active_workout'), 'late finish leaves newer draft resumable');
select public.finalize_active_workout('finish-2', null, '{"startedAt":"finish-2"}');
select phase1_test.expect_error($test$ select public.save_active_workout('{"startedAt":"finish-2"}') $test$, 'already finished or discarded');
select public.finalize_active_workout('never-persisted-draft');
select phase1_test.expect_error($test$ select public.save_active_workout('{"startedAt":"never-persisted-draft"}') $test$, 'already finished or discarded');
reset role;
update public.app_settings set value = '[{"id":"old","startedAt":"before"}]' where key = 'completed_guided_workouts';
set role authenticated;
select public.save_active_workout('{"startedAt":"finish-fail"}');
select phase1_test.expect_error($test$
  select public.finalize_active_workout('finish-fail', '[{"id":"failed","startedAt":"finish-fail"}]', '{"startedAt":"finish-fail"}')
$test$, 'Simulated active-workout deletion failure');
select phase1_test.assert_true((select value::jsonb->>'startedAt' = 'finish-fail' from public.app_settings where key = 'active_workout'), 'failed finish retains resumable draft');
select phase1_test.assert_true((select value::jsonb = '[{"id":"old","startedAt":"before"}]'::jsonb from public.app_settings where key = 'completed_guided_workouts'), 'failed finish retains previous summaries');
select public.save_active_workout('{"startedAt":"finish-fail","notes":"still resumable"}');
select phase1_test.assert_true((select value::jsonb->>'notes' = 'still resumable' from public.app_settings where key = 'active_workout'), 'failed finish does not retire a valid draft');
reset role;
drop trigger test_finish_failure on public.app_settings;
set role authenticated;
select public.finalize_active_workout('finish-fail', null, '{"startedAt":"finish-fail","notes":"still resumable"}');
do $$
declare
  i integer;
  identifier text;
begin
  for i in 1..51 loop
    identifier := 'archive-cap-' || i::text;
    perform public.save_active_workout(jsonb_build_object('startedAt', identifier));
    perform public.finalize_active_workout(identifier, jsonb_build_array(jsonb_build_object('id', identifier, 'startedAt', identifier)),
      jsonb_build_object('startedAt', identifier));
  end loop;
end;
$$;
select phase1_test.assert_true((select jsonb_array_length(value::jsonb) = 52 from public.app_settings where key = 'completed_guided_workouts'), 'archive evidence is retained until its canonical migration is proven');
select phase1_test.assert_true(exists (select 1 from public.app_settings settings, jsonb_array_elements(settings.value::jsonb) summary
  where settings.key = 'completed_guided_workouts' and summary->>'startedAt' = 'archive-cap-1'), 'old archive metadata remains available for reconciliation');
select phase1_test.expect_error($test$ select public.save_active_workout('{"startedAt":"archive-cap-1"}') $test$, 'already finished or discarded');
select public.finalize_active_workout('archive-cap-1', '[{"id":"archive-cap-1","startedAt":"archive-cap-1"}]');
select public.save_active_workout('{"startedAt":"same-workout","notes":"original"}');
select public.save_active_workout('{"startedAt":"same-workout","notes":"newer observations"}');
select phase1_test.expect_error($test$
  select public.finalize_active_workout('same-workout', '[{"id":"same-workout","startedAt":"same-workout"}]',
    '{"startedAt":"same-workout","notes":"original"}')
$test$, 'active workout changed');
select phase1_test.assert_true((select value::jsonb->>'notes' = 'newer observations' from public.app_settings where key = 'active_workout'), 'stale completion cannot discard newer same-workout values');
select phase1_test.assert_true((select jsonb_array_length(value::jsonb) = 52 from public.app_settings where key = 'completed_guided_workouts'), 'stale completion leaves archives unchanged');
select public.save_active_workout('{"startedAt":"same-workout","notes":"newer observations"}');
select public.finalize_active_workout('same-workout', null, '{"startedAt":"same-workout","notes":"newer observations"}');
select phase1_test.assert_true(not exists (select 1 from public.app_settings where key = 'active_workout'), 'matching snapshot can deliberately discard current draft');

-- Import failure after weight/preferences/one workout wrote rolls all of them
-- back. The same import succeeds exactly once when retrying valid records.
insert into public.body_measurement_logs (weight, measurements, logged_date) values (200, '{"waist":90}', '2026-10-04');
select phase1_test.expect_error($test$
  select public.import_training_data('[{"loggedDate":"2026-10-04","weight":210}]', '[]',
    '[{"exerciseId":1,"workoutDate":"2026-10-04","notes":"import first","fingerprint":"external:first","sets":[{"reps":5,"weight":101}]},{"exerciseId":1,"workoutDate":"2026-10-04","notes":"import second","fingerprint":"external:second","sets":[{"reps":5,"weight":777}]}]', array[1]::bigint[])
$test$, 'Simulated second-set persistence failure');
select phase1_test.assert_true((select weight = 200 and measurements = '{"waist":90}'::jsonb from public.body_measurement_logs where logged_date = '2026-10-04'), 'failed import preserves body record');
select phase1_test.assert_true(not exists (select 1 from public.user_exercise_preferences), 'failed import leaves preferences unchanged');
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions), 'failed import leaves no imported sessions');
select phase1_test.assert_true(not exists (select 1 from public.app_settings where key = 'imported_workout_fingerprints'), 'failed import leaves receipts unchanged');
select public.import_training_data('[{"loggedDate":"2026-10-04","weight":210}]', '[]',
  '[{"exerciseId":1,"workoutDate":"2026-10-04","notes":"import first","fingerprint":"external:first","sets":[{"reps":5,"weight":101}]}]', array[1]::bigint[]);
select public.import_training_data('[{"loggedDate":"2026-10-04","weight":210}]', '[]',
  '[{"exerciseId":1,"workoutDate":"2026-10-04","notes":"import first","fingerprint":"external:first","sets":[{"reps":5,"weight":101}]}]', array[1]::bigint[]);
select phase1_test.assert_true((select count(*) = 2 from public.workout_sessions), 'valid import retry creates one workout');
select phase1_test.assert_true((select weight = 210 and measurements = '{"waist":90}'::jsonb from public.body_measurement_logs where logged_date = '2026-10-04'), 'weight import preserves existing tape');
update public.app_settings set value = 'ambiguous-invalid-json' where key = 'imported_workout_fingerprints';
select phase1_test.expect_error($test$
  select public.import_training_data('[{"loggedDate":"2026-10-04","weight":220}]', '[]', '[]', '{}'::bigint[])
$test$, 'receipts are invalid');
select phase1_test.assert_true((select weight = 210 from public.body_measurement_logs where logged_date = '2026-10-04'), 'invalid receipt fails without changing observations');
update public.app_settings set value = '["external:first"]' where key = 'imported_workout_fingerprints';

-- A friend's identical session must never suppress the importing user's data.
insert into public.friend_invites (token, expires_at) values ('a-to-b-again', now() + interval '1 day');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.accept_friend_invite('a-to-b-again');
select public.save_workout_session(1, '2026-10-05', 'identical', null, '[{"reps":5,"weight":123}]');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.import_training_data('[]', '[]', '[{"exerciseId":1,"workoutDate":"2026-10-05","notes":"identical","fingerprint":"content::2026-10-05::barbell bench press::identical::5x123","sets":[{"reps":5,"weight":123}]}]', '{}'::bigint[]);
select public.import_training_data('[]', '[]', '[{"exerciseId":1,"workoutDate":"2026-10-05","notes":"identical","fingerprint":"content::2026-10-05::barbell bench press::identical::5x123","sets":[{"reps":5,"weight":123}]}]', '{}'::bigint[]);
select phase1_test.assert_true((select count(*) = 1 from public.workout_sessions where user_id = auth.uid() and workout_date = '2026-10-05'), 'content dedupe applies only to own observations');

set request.jwt.claim.sub = '';
select phase1_test.expect_error($test$ select public.remove_friend('00000000-0000-0000-0000-000000000001') $test$, 'log in again');
reset role;
set role anon;
select phase1_test.expect_error($test$ select public.accept_friend_invite('anything') $test$, 'permission denied');
select phase1_test.expect_error($test$ select public.save_workout_session(1, '2026-10-01', '', null, '[{"reps":5,"weight":1}]') $test$, 'permission denied');
reset role;

select 'Phase 1 SQL safety assertions passed: ' || last_value from phase1_test.assertions;
