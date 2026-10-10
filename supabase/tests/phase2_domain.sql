\set ON_ERROR_STOP on
reset role;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;

select public.save_workout_session(1, '2026-10-08', 'phase2 explicit observation', null,
  '[{"reps":5,"weight":100}]', null, '90000000-0000-0000-0000-000000000001', 'kg', 'manual') as domain_id \gset
select phase1_test.assert_true((select input_unit = 'kg' and recording_origin = 'manual' from public.workout_sessions where id = :domain_id), 'new entry records explicit input-unit provenance');
select phase1_test.assert_true((select count(*) = 1 and bool_and(rir is null) from public.workout_sets where session_id = :domain_id), 'one observed set is valid and unobserved RIR stays null');
select public.save_workout_session(1, '2026-10-08', 'phase2 explicit observation', null,
  '[{"reps":5,"weight":100}]', null, '90000000-0000-0000-0000-000000000001', 'kg', 'manual') as domain_retry \gset
select phase1_test.assert_true(:domain_id = :domain_retry, 'new provenance-aware retries return one recorded identity');
select phase1_test.expect_error($test$
  select public.save_workout_session(1, '2026-10-08', 'phase2 explicit observation', null,
    '[{"reps":5,"weight":100}]', null, '90000000-0000-0000-0000-000000000001', 'lb', 'manual')
$test$, 'different observations');

select public.save_workout_session(1, '2026-10-08', 'legacy uncertain receipt', null,
  '[{"reps":5,"weight":100}]', null, '90000000-0000-0000-0000-000000000002') as legacy_id \gset
select public.save_workout_session(1, '2026-10-08', 'legacy uncertain receipt', null,
  '[{"reps":5,"weight":100}]', null, '90000000-0000-0000-0000-000000000002', 'kg', 'guided') as legacy_retry \gset
select phase1_test.assert_true(:legacy_id = :legacy_retry, 'a legacy ambiguous attempt remains retryable after upgrading');
select phase1_test.assert_true((select input_unit is null and recording_origin is null from public.workout_sessions where id = :legacy_id), 'a retried historical receipt does not manufacture provenance');

select phase1_test.expect_error(format($test$
  select public.save_workout_session(1, '2026-10-09', 'failed revision', null,
    '[{"reps":8,"weight":110},{"reps":8,"weight":777}]', %s, null, 'lb')
$test$, :domain_id), 'Simulated second-set persistence failure');
select phase1_test.assert_true((select input_unit = 'kg' and notes = 'phase2 explicit observation' from public.workout_sessions where id = :domain_id), 'failed edit preserves provenance and observations together');
select public.save_workout_session(1, '2026-10-09', 'revised', null, '[{"reps":8,"weight":110}]', :domain_id, null, 'lb');
select phase1_test.assert_true((select input_unit = 'lb' and recording_origin = 'manual' from public.workout_sessions where id = :domain_id), 'revision changes input unit but preserves capture origin');
select phase1_test.expect_error(format($test$
  select public.save_workout_session(1, '2026-10-09', 'forged origin', null, '[{"reps":8,"weight":110}]', %s, null, 'lb', 'import')
$test$, :domain_id), 'origin cannot be changed');
select phase1_test.expect_error($test$ select public.save_workout_session(1, '2026-02-30', '', null, '[{"reps":5,"weight":100}]') $test$, 'out of range');
select phase1_test.expect_error($test$ select public.save_workout_session(1, '2026-10-09', '', null, '[{"reps":5,"weight":100}]', null, null, 'unknown') $test$, 'Input units');
select public.save_workout_session(1, '2026-10-09', 'warmup only', null, '[{"reps":5,"weight":50,"isWarmup":true}]', null, null, 'lb', 'guided') as warmup_id \gset
select phase1_test.assert_true((select bool_and(is_warmup) from public.workout_sets where session_id = :warmup_id), 'performed warm-up remains an observation without working sets');

select public.import_training_data('[]', '[]', '[{"exerciseId":1,"workoutDate":"2026-10-09","notes":"imported warmup","inputUnit":"kg","fingerprint":"phase2:warmup-import","sets":[{"reps":8,"weight":50,"isWarmup":true}]}]', '{}');
select phase1_test.assert_true(exists (select 1 from public.workout_sessions session join public.workout_sets sets on sets.session_id = session.id
  where session.notes = 'imported warmup' and session.input_unit = 'kg' and session.recording_origin = 'import' and sets.is_warmup and sets.rir is null), 'import retains explicit provenance and performed warm-up status');

reset role;
-- Deliberately retain old raw evidence that cannot be reconstructed as observations.
update public.app_settings set value = (value::jsonb || '[{"oldUnitUnknown":true,"originalWeight":80}]'::jsonb)::text
  where user_id = '00000000-0000-0000-0000-000000000001' and key = 'completed_guided_workouts';
create temporary table domain_before as select * from public.workout_sessions;
create temporary table sets_before as select * from public.workout_sets;
\ir ../migrations/20261008000000_phase2_domain_contract.sql
select phase1_test.assert_true((select jsonb_agg(to_jsonb(row) order by id) from domain_before row) = (select jsonb_agg(to_jsonb(row) order by id) from public.workout_sessions row), 'repeat domain installation never rewrites historical sessions');
select phase1_test.assert_true((select jsonb_agg(to_jsonb(row) order by id) from sets_before row) = (select jsonb_agg(to_jsonb(row) order by id) from public.workout_sets row), 'repeat domain installation never rewrites observed sets');
set role authenticated;
select public.save_active_workout('{"startedAt":"phase2-history-finish"}');
select public.finalize_active_workout('phase2-history-finish', '[{"id":"phase2-history-finish","startedAt":"phase2-history-finish"}]', '{"startedAt":"phase2-history-finish"}');
select phase1_test.assert_true((select jsonb_array_length(value::jsonb) > 50 from public.app_settings where key = 'completed_guided_workouts'), 'completing a workout does not prune migration evidence');
select phase1_test.assert_true((select value::jsonb @> '[{"oldUnitUnknown":true,"originalWeight":80}]'::jsonb from public.app_settings where key = 'completed_guided_workouts'), 'unmatched original archive values are preserved without becoming observations');
reset role;
select 'Phase 2 domain/provenance assertions passed';
