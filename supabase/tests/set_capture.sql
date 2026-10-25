\set ON_ERROR_STOP on
reset role;
select case when is_called then last_value else 0 end as capture_assertions_before from phase1_test.assertions \gset
insert into auth.users values ('00000000-0000-0000-0000-000000000021'), ('00000000-0000-0000-0000-000000000022');
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
set role authenticated;

-- A new recording stores capture metadata alongside, not inside, the observation.
select public.save_workout_session(1,'2026-10-24','',null,
  '[{"reps":12,"weight":70,"performedAt":"2026-10-24T18:02:00Z","evidence":"flow"},{"reps":10,"weight":70,"evidence":"typed"}]',
  null,'40000000-0000-0000-0000-000000000001','lb','manual') as captured \gset
select phase1_test.assert_true((select array_agg(evidence order by set_number)=array['flow','typed'] from public.workout_sets where session_id=:captured),'evidence is stored per set');
select phase1_test.assert_true((select performed_at='2026-10-24T18:02:00Z'::timestamptz from public.workout_sets where session_id=:captured and set_number=1),'capture time is stored');
select phase1_test.assert_true((select performed_at is null from public.workout_sets where session_id=:captured and set_number=2),'missing capture time stays unknown');

-- Metadata is outside the retry payload: the same attempt without it is the same entry.
select phase1_test.assert_true(public.save_workout_session(1,'2026-10-24','',null,'[{"reps":12,"weight":70},{"reps":10,"weight":70}]',
  null,'40000000-0000-0000-0000-000000000001','lb','manual')=:captured,'retry without capture metadata resolves the committed entry');
select phase1_test.assert_true((select count(*)=2 from public.workout_sets where session_id=:captured),'retry writes no further sets');

-- A history edit keeps evidence for unchanged values, marks changed values typed, and keeps timing by position.
select public.save_workout_session(1,'2026-10-24','edited',null,'[{"reps":12,"weight":70,"evidence":"typed"},{"reps":9,"weight":70,"evidence":"typed"},{"reps":8,"weight":70}]',:captured);
select phase1_test.assert_true((select array_agg(evidence order by set_number)=array['flow','typed','typed'] from public.workout_sets where session_id=:captured),'edit keeps unchanged evidence and marks corrections typed');
select phase1_test.assert_true((select performed_at='2026-10-24T18:02:00Z'::timestamptz from public.workout_sets where session_id=:captured and set_number=1),'edit keeps capture time');

-- Legacy rows stay unknown through an edit that leaves them unchanged.
select public.save_workout_session(1,'2026-10-23','',null,'[{"reps":8,"weight":100}]',null,null,'lb','manual') as legacy \gset
select public.save_workout_session(1,'2026-10-23','',null,'[{"reps":8,"weight":100,"evidence":"typed"}]',:legacy);
select phase1_test.assert_true((select evidence is null and performed_at is null from public.workout_sets where session_id=:legacy),'unchanged legacy history is not given invented evidence');

select phase1_test.expect_error('select public.save_workout_session(1,''2026-10-24'','''',null,''[{"reps":8,"weight":100,"evidence":"guessed"}]'',null,null,''lb'',''manual'')','capture method is invalid');
select phase1_test.expect_error('select public.save_workout_session(1,''2026-10-24'','''',null,''[{"reps":8,"weight":100,"performedAt":"not a time"}]'',null,null,''lb'',''manual'')','capture time is invalid');
select phase1_test.expect_error('select public.save_workout_session(1,''2026-10-24'','''',null,''[{"reps":8,"weight":100,"performedAt":5}]'',null,null,''lb'',''manual'')','capture time is invalid');
select phase1_test.expect_error('update public.workout_sets set evidence=''flow'' where session_id=' || :captured,'permission denied');
reset role;
select phase1_test.expect_error('update public.workout_sets set evidence=''guessed'' where session_id=' || :captured,'workout_sets_evidence_check');
set role authenticated;

-- Guided recording carries flow mode metadata from the atomic entry into the stored sets.
do $$
declare saved jsonb; result jsonb; sid bigint;
begin
  saved:=(public.save_active_workout('{"workoutId":"capture-guided","revision":0,"startedAt":"capture-start","workoutDate":"2026-10-24","todayDayKey":"sat","sourceDayKey":"sat","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"slots":[{"id":"slot-a","exerciseId":1}],"rest":null,"currentExercise":{"muscle":"Chest","exerciseId":1,"slotId":"slot-a","notes":"","machineProfileId":null,"requestId":"40000000-0000-0000-0000-000000000002","requestUnit":"lb","sets":[{"reps":"12","weight":"70","performedAt":"2026-10-24T18:10:00Z","evidence":"flow","capturedValues":"[\"12\",\"70\",false]","observationConfirmation":"[\"guided-observation-v1\",1,\"2026-10-24\",null,\"lb\",\"12\",\"70\",false]"}]}}'))->'activeWorkout';
  result:=public.record_workout_entry(jsonb_build_object('workoutId','capture-guided','requestId','40000000-0000-0000-0000-000000000002','exerciseId',1,'workoutDate','2026-10-24','notes','','machineProfileId',null,
    'inputUnit','lb','recordingOrigin','guided','sets',jsonb_build_array(jsonb_build_object('reps',12,'weight',70,'isWarmup',false,'performedAt','2026-10-24T18:10:00Z','evidence','flow')),'expectedActive',saved,'completedAt','2026-10-24T18:11:00Z'));
  sid:=(result->>'sessionId')::bigint;
  perform phase1_test.assert_true((select evidence='flow' and performed_at='2026-10-24T18:10:00Z'::timestamptz from public.workout_sets where session_id=sid),'guided recording stores pad capture metadata');
  perform phase1_test.assert_true(result->'activeWorkout'->'slots'=saved->'slots' and result->'activeWorkout'->'currentExercise'->>'exerciseId' is null,'guided commit keeps the planned slots and clears the finished exercise');
end;
$$;

reset role;
select format('%s set capture assertions passed', (select last_value from phase1_test.assertions) - :capture_assertions_before);
