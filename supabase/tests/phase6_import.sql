\set ON_ERROR_STOP on
reset role;
create schema phase6_test;
create sequence phase6_test.assertions;
grant usage on schema phase6_test to authenticated, anon;
grant usage, select on sequence phase6_test.assertions to authenticated, anon;
create function phase6_test.assert_true(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Assertion failed: %', label; end if; perform nextval('phase6_test.assertions'); end;
$$;
create function phase6_test.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then raise exception 'Expected %, received %', expected, sqlerrm; end if;
    perform phase6_test.assert_true(true, expected); return;
  end;
  raise exception 'Expected failure: %', statement;
end;
$$;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000071'),
 ('00000000-0000-0000-0000-000000000072');
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000071';

select public.import_training_data_v6(
  auth.uid(),
  '[{"loggedDate":"2026-10-10","weight":180,"weightInputUnit":"lb","unit":"lb"}]',
  '[{"loggedDate":"2026-10-10","weight":null,"weightInputUnit":null,"circumferenceInputUnit":"cm","measurements":{"waist":80},"notes":"Tape"}]',
  '[{"workoutDate":"2026-10-10","notes":"Imported once","exerciseId":1,"exerciseName":"Bench Press","inputUnit":"kg","fingerprint":"external:phase6-import-1::2026-10-10","sets":[{"reps":5,"weight":100,"rir":2.5},{"reps":4,"weight":105,"isWarmup":true}]}]',
  array[1]::bigint[]
) as first_result \gset
select phase6_test.assert_true(:'first_result'::jsonb = '{"inserted":{"bodyCheckIns":1,"workouts":1,"sets":2},"skipped":{"bodyCheckIns":0,"workouts":0},"failed":0}'::jsonb,'committed counts reflect one combined body check-in and two sets');
select phase6_test.assert_true((select weight=180 and weight_input_unit='lb' and circumference_input_unit='cm' and measurements->>'waist'='80'
  from public.body_measurement_logs where user_id=auth.uid() and logged_date='2026-10-10'),'bodyweight and tape are combined with declared provenance');
select phase6_test.assert_true((select count(*)=2 and max(rir)=2.5 and bool_or(rir is null) and bool_or(is_warmup)
  from public.workout_sets sets join public.workout_sessions sessions on sessions.id=sets.session_id
  where sessions.user_id=auth.uid() and sessions.notes='Imported once'),'explicit RIR and warm-up survive import; unknown RIR stays null');
select public.import_training_data_v6(
  auth.uid(),
  '[{"loggedDate":"2026-10-10","weight":190,"weightInputUnit":"lb","unit":"lb"}]',
  '[{"loggedDate":"2026-10-10","measurements":{"waist":85},"circumferenceInputUnit":"cm"}]',
  '[{"workoutDate":"2026-10-10","notes":"Imported once","exerciseId":1,"inputUnit":"kg","fingerprint":"external:phase6-import-1::2026-10-10","sets":[{"reps":5,"weight":100,"rir":2.5},{"reps":4,"weight":105,"isWarmup":true}]}]',
  array[1]::bigint[]
) as duplicate_result \gset
select phase6_test.assert_true(:'duplicate_result'::jsonb = '{"inserted":{"bodyCheckIns":0,"workouts":0,"sets":0},"skipped":{"bodyCheckIns":1,"workouts":1},"failed":0}'::jsonb,'duplicate import reports committed skips');
select phase6_test.assert_true((select weight=180 and measurements->>'waist'='80' from public.body_measurement_logs where user_id=auth.uid() and logged_date='2026-10-10'),'occupied body date preserves all prior values');

select phase6_test.expect_error(format(
  'select public.import_training_data_v6(%L::uuid,''[]'',''[]'',''[]'',''{}'')',
  '00000000-0000-0000-0000-000000000072'
),'account that started');
select phase6_test.assert_true(not exists(select 1 from public.body_measurement_logs where user_id='00000000-0000-0000-0000-000000000072'),'account mismatch creates no foreign observations');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000072';
select public.import_training_data_v6(
  auth.uid(),
  '[{"loggedDate":"2026-10-10","weight":190,"weightInputUnit":"lb"}]',
  '[{"loggedDate":"2026-10-10","measurements":{"waist":85},"circumferenceInputUnit":"cm"}]',
  '[{"workoutDate":"2026-10-10","notes":"Friend copy","exerciseId":1,"inputUnit":"kg","fingerprint":"external:phase6-import-1::2026-10-10","sets":[{"reps":5,"weight":100,"rir":2.5}]}]',
  array[1]::bigint[]
) as friend_result \gset
select phase6_test.assert_true(:'friend_result'::jsonb = '{"inserted":{"bodyCheckIns":1,"workouts":1,"sets":1},"skipped":{"bodyCheckIns":0,"workouts":0},"failed":0}'::jsonb,'matching observations from another owner import independently');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000071';

-- Workout receipts remain deletion tombstones; body dates may be explicitly
-- filled again after their current observation is deleted.
reset role;
delete from public.workout_sessions where user_id='00000000-0000-0000-0000-000000000071' and notes='Imported once';
delete from public.body_measurement_logs where user_id='00000000-0000-0000-0000-000000000071' and logged_date='2026-10-10';
set role authenticated;
select public.import_training_data_v6(
  auth.uid(),
  '[{"loggedDate":"2026-10-10","weight":180,"weightInputUnit":"lb","unit":"lb"}]',
  '[{"loggedDate":"2026-10-10","measurements":{"waist":80},"circumferenceInputUnit":"cm"}]',
  '[{"workoutDate":"2026-10-10","notes":"Changed payload under same source ID","exerciseId":1,"inputUnit":"kg","fingerprint":"external:phase6-import-1::2026-10-10","sets":[{"reps":8,"weight":125,"rir":3}]}]',
  array[1]::bigint[]
) as reimport_result \gset
select phase6_test.assert_true(:'reimport_result'::jsonb = '{"inserted":{"bodyCheckIns":1,"workouts":0,"sets":0},"skipped":{"bodyCheckIns":0,"workouts":1},"failed":0}'::jsonb,'body date can be explicitly refilled while deleted workout receipt stays skipped');
select public.import_training_data_v6(
  auth.uid(), '[]', '[]',
  '[{"workoutDate":"2026-10-10","notes":"Restored deliberately","exerciseId":1,"inputUnit":"kg","fingerprint":"external:phase6-restored-id::2026-10-10","sets":[{"reps":8,"weight":125,"rir":3}]}]',
  array[1]::bigint[]
) as restore_result \gset
select phase6_test.assert_true(:'restore_result'::jsonb = '{"inserted":{"bodyCheckIns":0,"workouts":1,"sets":1},"skipped":{"bodyCheckIns":0,"workouts":0},"failed":0}'::jsonb,'a new explicit source ID deliberately restores deleted facts');

-- One external source workout carries one entry per exercise; every sibling
-- in the same file is imported, and the whole source is retired afterwards.
select public.import_training_data_v6(
  auth.uid(), '[]', '[]',
  '[{"workoutDate":"2026-10-12","notes":"Source workout","exerciseId":1,"inputUnit":"lb","fingerprint":"external:phase6-multi::2026-10-12::bench::Source workout::5x135","sets":[{"reps":5,"weight":135}]},{"workoutDate":"2026-10-12","notes":"Source workout","exerciseId":2,"inputUnit":"lb","fingerprint":"external:phase6-multi::2026-10-12::row::Source workout::8x95","sets":[{"reps":8,"weight":95}]}]',
  array[1,2]::bigint[]
) as multi_result \gset
select phase6_test.assert_true(:'multi_result'::jsonb = '{"inserted":{"bodyCheckIns":0,"workouts":2,"sets":2},"skipped":{"bodyCheckIns":0,"workouts":0},"failed":0}'::jsonb,'every exercise entry of one external source workout is imported');
select public.import_training_data_v6(
  auth.uid(), '[]', '[]',
  '[{"workoutDate":"2026-10-12","notes":"Source workout","exerciseId":1,"inputUnit":"lb","fingerprint":"external:phase6-multi::2026-10-12::bench::Source workout::6x135","sets":[{"reps":6,"weight":135}]},{"workoutDate":"2026-10-12","notes":"Source workout","exerciseId":2,"inputUnit":"lb","fingerprint":"external:phase6-multi::2026-10-12::row::Source workout::8x95","sets":[{"reps":8,"weight":95}]}]',
  array[1,2]::bigint[]
) as multi_retry_result \gset
select phase6_test.assert_true(:'multi_retry_result'::jsonb = '{"inserted":{"bodyCheckIns":0,"workouts":0,"sets":0},"skipped":{"bodyCheckIns":0,"workouts":2},"failed":0}'::jsonb,'a re-exported source workout stays retired even with edited sets');

select phase6_test.expect_error(format(
  'select public.import_training_data_v6(auth.uid(),%L::jsonb,''[]'',%L::jsonb,''{}'')',
  '[{"loggedDate":"2026-10-11","weight":181,"weightInputUnit":"lb"}]',
  '[{"workoutDate":"2026-10-11","notes":"Valid first","exerciseId":1,"fingerprint":"external:phase6-atomic-first::2026-10-11","sets":[{"reps":5,"weight":100}]},{"workoutDate":"2026-10-11","notes":"Invalid second","exerciseId":1,"fingerprint":"external:phase6-invalid::2026-10-11","sets":[{"reps":5,"weight":100,"rir":11}]}]'
),'RIR');
select phase6_test.assert_true(not exists(select 1 from public.body_measurement_logs where user_id=auth.uid() and logged_date='2026-10-11'),'invalid later workout rolls back earlier body insert');
select phase6_test.assert_true(not exists(select 1 from public.workout_sessions where user_id=auth.uid() and notes in ('Valid first','Invalid second')),'invalid second workout rolls back the first workout');
set role anon;
set request.jwt.claim.role='anon';
select phase6_test.expect_error('select public.import_training_data_v6(auth.uid(),''[]'',''[]'',''[]'',''{}'')','permission denied');
reset role;
select 'Phase 6 import: ' || last_value || ' assertions passed' from phase6_test.assertions;
create table phase6_test.race_results(result jsonb not null);
grant insert, select on phase6_test.race_results to authenticated;
