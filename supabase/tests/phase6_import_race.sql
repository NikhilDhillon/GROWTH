begin;
set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000071';
insert into phase6_test.race_results(result)
select public.import_training_data_v6(
  auth.uid(),
  '[{"loggedDate":"2026-10-12","weight":182,"weightInputUnit":"lb"}]',
  '[{"loggedDate":"2026-10-12","measurements":{"waist":81},"circumferenceInputUnit":"cm"}]',
  '[{"workoutDate":"2026-10-12","notes":"Concurrent import","exerciseId":1,"inputUnit":"lb","fingerprint":"external:phase6-concurrent::2026-10-12","sets":[{"reps":6,"weight":135,"rir":1}]}]',
  array[1]::bigint[]
);
select pg_sleep(0.1);
commit;
