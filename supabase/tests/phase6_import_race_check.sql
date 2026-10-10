select phase6_test.assert_true((select count(*)=1 from phase6_test.race_results
  where result->'inserted'->>'bodyCheckIns'='1' and result->'inserted'->>'workouts'='1' and result->'inserted'->>'sets'='1'),
  'one concurrent importer reports committed insertions');
select phase6_test.assert_true((select count(*)=1 from phase6_test.race_results
  where result->'skipped'->>'bodyCheckIns'='1' and result->'skipped'->>'workouts'='1'),
  'the competing importer reports duplicate skips');
select phase6_test.assert_true((select count(*)=1 from public.body_measurement_logs where user_id='00000000-0000-0000-0000-000000000071' and logged_date='2026-10-12'),
  'concurrent imports create one whole body observation');
select phase6_test.assert_true((select count(*)=1 from public.workout_sessions where user_id='00000000-0000-0000-0000-000000000071' and notes='Concurrent import'),
  'concurrent imports create one workout');
select 'Phase 6 import race: 4 assertions passed';
