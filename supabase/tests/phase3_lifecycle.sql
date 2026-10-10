\set ON_ERROR_STOP on
reset role;
select case when is_called then last_value else 0 end as phase3_assertions_before from phase1_test.assertions \gset
insert into auth.users values
 ('00000000-0000-0000-0000-000000000005'),
 ('00000000-0000-0000-0000-000000000006'),
 ('00000000-0000-0000-0000-000000000007');
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';

-- Seed actual historical rows/evidence before invoking the explicit migration.
select public.phase2_save_workout_session(1,'2026-10-09','historical confirmed',null,'[{"reps":8,"weight":100}]') as legacy_link \gset
select public.phase2_save_workout_session(1,'2026-10-09','ambiguous archive',null,'[{"reps":8,"weight":120}]') as ambiguous_link \gset
select public.phase2_save_workout_session(1,'2026-10-09','active observed',null,'[{"reps":5,"weight":90}]') as active_link \gset
select public.phase2_save_workout_session(1,'2026-10-09','old request',null,'[{"reps":5,"weight":95}]',null,'30000000-0000-0000-0000-000000000001') as old_request_link \gset
insert into public.app_settings(user_id,key,value) values
 ('00000000-0000-0000-0000-000000000005','active_workout',jsonb_build_object('startedAt','legacy-active','workoutDate','2026-10-09',
   'todayDayKey','fri','sourceDayKey','fri','plannedMuscles',jsonb_build_array('Chest'),'completedExercises',jsonb_build_array(jsonb_build_object('sessionId',:active_link,'exerciseId',1,'sets',jsonb_build_array(jsonb_build_object('weight','999')))),
   'currentExercise',public.empty_workout_exercise(),'scheduleChanges','[]'::jsonb,'unknownHistoricalField',jsonb_build_object('keep',true))::text),
 ('00000000-0000-0000-0000-000000000005','completed_guided_workouts',jsonb_build_array(
   jsonb_build_object('id','legacy-guided','startedAt','legacy-guided','finishedAt','2026-10-09T10:00:00Z','workoutDate','2026-10-09','todayDayKey','fri','sourceDayKey','fri','plannedMuscles',jsonb_build_array('Chest'),
     'completedExercises',jsonb_build_array(jsonb_build_object('sessionId',:legacy_link,'exerciseId',1,'sets',jsonb_build_array(jsonb_build_object('weight','999'))))),
   jsonb_build_object('id','ambiguous-one','startedAt','ambiguous-one','completedExercises',jsonb_build_array(jsonb_build_object('sessionId',:ambiguous_link,'exerciseId',1))),
   jsonb_build_object('id','ambiguous-two','startedAt','ambiguous-two','completedExercises',jsonb_build_array(jsonb_build_object('sessionId',:ambiguous_link,'exerciseId',1))),
   jsonb_build_object('unownedCopyOnly',true,'weight',70))::text);
create temporary table migration_evidence as select key,value from public.app_settings where user_id='00000000-0000-0000-0000-000000000005';
grant select on migration_evidence to authenticated;
select value::jsonb as migration_active from migration_evidence where key='active_workout' \gset
select value::jsonb as migration_archive from migration_evidence where key='completed_guided_workouts' \gset
select jsonb_build_array(
 jsonb_build_object('id','durable-history','legacyId','legacy-guided','kind','guided','status','completed','startedAt','legacy-guided','finishedAt','2026-10-09T10:00:00Z','plannedMuscles',jsonb_build_array('Chest')),
 jsonb_build_object('id','durable-active','legacyId','legacy-active','kind','guided','status','active','startedAt','legacy-active','plannedMuscles',jsonb_build_array('Chest')),
 jsonb_build_object('id','durable-ambiguous','kind','standalone','status','completed'),
 jsonb_build_object('id','durable-old-receipt','kind','standalone','status','completed')) as migration_records \gset
select jsonb_build_array(jsonb_build_object('workoutId','durable-history','sessionId',:legacy_link),jsonb_build_object('workoutId','durable-active','sessionId',:active_link),
 jsonb_build_object('workoutId','durable-ambiguous','sessionId',:ambiguous_link),jsonb_build_object('workoutId','durable-old-receipt','sessionId',:old_request_link)) as migration_references \gset
set role authenticated;
select phase1_test.expect_error(format('select public.initialize_workout_records(%L,%L,null,%L,null)',:'migration_records',:'migration_references',:'migration_archive'),'evidence changed');
select phase1_test.assert_true((select count(*)=0 from public.workout_records),'snapshot mismatch creates no metadata');
select public.initialize_workout_records(:'migration_records',:'migration_references',:'migration_active',:'migration_archive',(:'migration_active')::jsonb || '{"workoutId":"durable-active","revision":0}');
select phase1_test.assert_true((select count(*)=4 from public.workout_entry_references),'only explicit owned references migrate');
select phase1_test.assert_true((select value::jsonb = :'migration_archive'::jsonb from public.app_settings where key='completed_guided_workouts'),'all raw legacy archive evidence retained exactly');
select phase1_test.assert_true((select value::jsonb - 'workoutId' - 'revision' = :'migration_active'::jsonb from public.app_settings where key='active_workout'),'migration changes only active identity/revision');
select phase1_test.assert_true((select value::jsonb = :'migration_active'::jsonb from public.app_settings where key='workout_reference_legacy_active_evidence_v1'),'original active evidence retained outside mutable draft authority');
update public.app_settings set value='{}' where key='workout_reference_legacy_active_evidence_v1';
select phase1_test.assert_true((select value::jsonb = :'migration_active'::jsonb from public.app_settings where key='workout_reference_legacy_active_evidence_v1'),'client cannot rewrite retained migration evidence');
select phase1_test.assert_true((select value->>'kind'='standalone' from public.workout_records where id='durable-ambiguous'),'conflicting copies do not group observations');
select public.initialize_workout_records('[]','[]',null,'[]',null);
select phase1_test.assert_true((select count(*)=4 from public.workout_entry_references),'completed migration does not relink on another initialization');
delete from public.workout_sessions where id=:legacy_link;
select public.initialize_workout_records(:'migration_records',:'migration_references',:'migration_active',:'migration_archive',(:'migration_active')::jsonb || '{"workoutId":"durable-active","revision":0}');
select phase1_test.assert_true(not exists(select 1 from public.workout_sessions where id=:legacy_link),'deleted migrated observations never resurrect');
select phase1_test.assert_true(not exists(select 1 from public.workout_entry_references where session_id=:legacy_link),'deletion cascades canonical reference');
select phase1_test.expect_error('select public.phase2_save_workout_session(1,''2026-10-09'','''',null,''[{"reps":8,"weight":100}]'')','permission denied');
select phase1_test.expect_error('select public.save_workout_session(1,''2026-10-09'','''',null,''[{"reps":8,"weight":100}]'',null,null,''lb'',''guided'')','confirmed atomic');
select phase1_test.expect_error('select public.save_active_workout(''{"startedAt":"legacy-client"}'')','expected revision');
select phase1_test.expect_error('insert into public.workout_records(id,user_id,value) values(''forged'',auth.uid(),''{}'')','permission denied');
select phase1_test.expect_error('insert into public.app_settings(user_id,key,value) values(auth.uid(),''recovered_workout_drafts'',''[]'')','row-level security');

-- A second owner cannot read or attach another owner's metadata/observations.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select phase1_test.assert_true((select count(*)=0 from public.workout_records),'workout metadata is private to owner');
select phase1_test.assert_true((select count(*)=0 from public.workout_entry_references),'workout references are private to owner');
select phase1_test.expect_error(format('select public.initialize_workout_records(''[{"id":"foreign-parent","kind":"standalone","status":"completed"}]'',''[{"workoutId":"foreign-parent","sessionId":%s}]'',null,''[]'',null)',:active_link),'must belong to you');
select phase1_test.assert_true((select count(*)=0 from public.workout_records),'foreign-reference failure rolls back parent insert');

-- All draft conflicts recover entered work and return normally so recovery
-- commits, including a browser attempting to resume an already closed workout.
do $test$
declare initial jsonb; saved jsonb; changed jsonb; stale jsonb; result jsonb; request jsonb; committed jsonb; sid bigint; before_count bigint; newer jsonb;
begin
 initial:='{"workoutId":"new-guided","revision":0,"startedAt":"new-guided-start","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"currentExercise":{"muscle":"Chest","exerciseId":1,"notes":"","machineProfileId":null,"requestId":"30000000-0000-0000-0000-000000000002","requestUnit":"lb","sets":[{"reps":"8","weight":"100"}]}}';
 result:=public.save_active_workout(initial); saved:=result->'activeWorkout';
 perform phase1_test.assert_true(saved->>'revision'='1','first save advances expected revision');
 result:=public.save_active_workout(initial);
 perform phase1_test.assert_true(result->'activeWorkout'=saved,'same-content initial retry preserves revision');
 changed:=jsonb_set(saved,'{currentExercise,sets,0,reps}','"9"');
 result:=public.save_active_workout(changed); changed:=result->'activeWorkout';
 stale:=jsonb_set(saved,'{currentExercise,sets,0,weight}','"120"');
 result:=public.save_active_workout(stale);
 perform phase1_test.assert_true(result->>'conflict'='true' and result->'current'=changed,'different stale draft is rejected');
 perform phase1_test.assert_true(exists(select 1 from public.app_settings settings cross join lateral jsonb_array_elements(settings.value::jsonb) recovery
   where settings.user_id=auth.uid() and settings.key='recovered_workout_drafts' and recovery->'draft'=stale),'conflict candidate is durably recovered');
 perform public.save_active_workout(stale);
 perform phase1_test.assert_true((select jsonb_array_length(value::jsonb)=1 from public.app_settings where user_id=auth.uid() and key='recovered_workout_drafts'),'identical conflict recovery is idempotent');
 request:=jsonb_build_object('workoutId','new-guided','requestId','30000000-0000-0000-0000-000000000002','exerciseId',1,'workoutDate','2026-10-09','notes','','machineProfileId',null,
   'inputUnit','lb','recordingOrigin','guided','sets',jsonb_build_array(jsonb_build_object('reps',9,'weight',100,'isWarmup',false)),'expectedActive',changed,'completedAt','2026-10-09T12:00:00Z');
 before_count:=(select count(*) from public.workout_sessions);
 perform phase1_test.expect_error(format('select public.record_workout_entry(%L)',request),'explicit performed confirmation');
 perform phase1_test.assert_true((select count(*)=before_count from public.workout_sessions),'unconfirmed prescription creates no observations');
 changed:=jsonb_set(changed,'{currentExercise,sets,0,observationConfirmation}',to_jsonb('["guided-observation-v1",1,"2026-10-09",null,"lb","9","100",false]'::text));
 changed:=changed || jsonb_build_object('currentExercise',(changed->'currentExercise') || jsonb_build_object('prescription',jsonb_build_object('exerciseId',1,'sets',jsonb_build_array(jsonb_build_object('targetLoadLb',100)))));
 result:=public.save_active_workout(changed); changed:=result->'activeWorkout';
 request:=request || jsonb_build_object('expectedActive',changed);
 result:=public.record_workout_entry(request); sid:=(result->>'sessionId')::bigint; committed:=result->'activeWorkout';
 perform phase1_test.assert_true((committed->>'revision')::bigint=(changed->>'revision')::bigint+1,'guided commit advances draft revision');
 perform phase1_test.assert_true(jsonb_array_length(committed->'completedExercises')=1 and committed->'completedExercises'->0->'sets'='[]'::jsonb,'committed draft references completed entry without copied facts');
 perform phase1_test.assert_true(exists(select 1 from public.workout_entry_references where session_id=sid and workout_id='new-guided' and prescription->>'exerciseId'='1'),'observations and prescription reference commit together');
 perform phase1_test.assert_true((select sum(reps)=9 and sum(weight)=100 from public.workout_sets where session_id=sid),'only confirmed values become observations');
 newer:=jsonb_set(committed,'{currentExercise,sets,0,reps}','"7"');
 result:=public.save_active_workout(newer); newer:=result->'activeWorkout';
 result:=public.record_workout_entry(request);
 perform phase1_test.assert_true((result->>'sessionId')::bigint=sid and result->'activeWorkout'=newer,'receipt retry returns original ID without resetting newer draft');
 perform phase1_test.expect_error(format('select public.record_workout_entry(%L)',request || '{"workoutId":"another-parent"}'),'cannot be moved');
 result:=public.record_workout_entry(request || jsonb_build_object('requestId','30000000-0000-0000-0000-000000000003','expectedActive',changed));
 perform phase1_test.assert_true(result->>'conflict'='true','stale new guided attempt reports conflict');
 perform phase1_test.assert_true((select count(*)=1 from public.workout_sessions),'stale new attempt writes no observed entry');
 perform public.finalize_active_workout('new-guided-start',jsonb_build_array(newer || jsonb_build_object('id','new-summary','finishedAt','2026-10-09T13:00:00Z','completedExercises',jsonb_build_array(jsonb_build_object('exerciseId',1,'sets',jsonb_build_array(jsonb_build_object('weight','999')))))),newer);
 perform phase1_test.assert_true((select value->>'status'='completed' and not(value ? 'completedExercises') from public.workout_records where id='new-guided'),'finished aggregate closes lifecycle without storing observations');
 perform phase1_test.assert_true((select value::jsonb->0->'completedExercises'->0->'sets'='[]'::jsonb from public.app_settings where user_id=auth.uid() and key='completed_guided_workouts'),'summary completion derives references rather than accepting copied observations');
 result:=public.save_active_workout(newer);
 perform phase1_test.assert_true(result->>'conflict'='true' and result->'current'='null'::jsonb,'retired draft cannot resume');
 perform phase1_test.assert_true(exists(select 1 from public.app_settings settings cross join lateral jsonb_array_elements(settings.value::jsonb) recovery where settings.user_id=auth.uid() and settings.key='recovered_workout_drafts' and recovery->'draft'=newer),'retired conflict retains entered work for recovery');
 result:=public.record_workout_entry(request);
 perform phase1_test.assert_true((result->>'sessionId')::bigint=sid and result->'activeWorkout'='null'::jsonb,'receipt retry after finishing does not reopen draft');
end;
$test$;

-- Both facts and draft advancement roll back if the final persistence step
-- fails. Earlier observations and the exact existing draft remain valid.
reset role;
create function phase1_test.fail_phase3_advance() returns trigger language plpgsql as $$ begin
 if new.key='active_workout' and new.value::jsonb->>'startedAt'='atomic-failure-start' and jsonb_array_length(new.value::jsonb->'completedExercises')>0 then
   raise exception 'Simulated draft advancement failure';
 end if; return new; end; $$;
create trigger test_phase3_advance_failure before update on public.app_settings for each row execute function phase1_test.fail_phase3_advance();
create function phase1_test.fail_phase3_finish() returns trigger language plpgsql as $$ begin
 if old.key='active_workout' and old.value::jsonb->>'startedAt'='phase3-finish-fail' then raise exception 'Simulated phase3 active deletion failure'; end if;
 return old; end; $$;
create trigger test_phase3_finish_failure before delete on public.app_settings for each row execute function phase1_test.fail_phase3_finish();
set role authenticated;
do $test$
declare draft jsonb; input jsonb; before_count bigint; result jsonb;
begin
 draft:='{"workoutId":"atomic-failure","revision":0,"startedAt":"atomic-failure-start","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"currentExercise":{"muscle":"Chest","exerciseId":1,"notes":"","machineProfileId":null,"requestId":"30000000-0000-0000-0000-000000000004","requestUnit":"lb","sets":[{"reps":"8","weight":"100","observationConfirmation":"[\"guided-observation-v1\",1,\"2026-10-09\",null,\"lb\",\"8\",\"100\",false]"}]}}';
 result:=public.save_active_workout(draft); draft:=result->'activeWorkout';
 input:=jsonb_build_object('workoutId','atomic-failure','requestId','30000000-0000-0000-0000-000000000004','exerciseId',1,'workoutDate','2026-10-09','notes','','machineProfileId',null,
   'inputUnit','lb','recordingOrigin','guided','sets','[{"reps":8,"weight":100}]'::jsonb,'expectedActive',draft,'completedAt','2026-10-09T14:00:00Z');
 before_count:=(select count(*) from public.workout_sessions);
 perform phase1_test.expect_error(format('select public.record_workout_entry(%L)',input),'draft advancement failure');
 perform phase1_test.assert_true((select count(*)=before_count from public.workout_sessions),'last-step failure rolls back newly inserted observations');
 perform phase1_test.assert_true(not exists(select 1 from public.workout_entry_references where workout_id='atomic-failure'),'last-step failure rolls back newly inserted reference');
 perform phase1_test.assert_true((select value::jsonb=draft from public.app_settings where user_id=auth.uid() and key='active_workout'),'last-step failure preserves exact original draft');
 perform public.finalize_active_workout('atomic-failure-start',null,draft);
 perform phase1_test.assert_true((select value->>'status'='completed' and value->'finishedAt'='null'::jsonb from public.workout_records where id='atomic-failure'),'discard closes lifecycle and preserves unknown completion time');
 perform phase1_test.expect_error('select public.record_workout_entry(''{"workoutId":"manual-fail","requestId":"30000000-0000-0000-0000-000000000005","exerciseId":1,"workoutDate":"2026-10-09","notes":"","inputUnit":"lb","recordingOrigin":"manual","sets":[{"reps":8,"weight":100},{"reps":8,"weight":777}]}'' )','second-set persistence failure');
 perform phase1_test.assert_true(not exists(select 1 from public.workout_records where id='manual-fail'),'manual failure rolls back standalone parent');
 draft:='{"workoutId":"failed-close","revision":0,"startedAt":"phase3-finish-fail","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"currentExercise":{}}';
 result:=public.save_active_workout(draft); draft:=result->'activeWorkout';
 perform phase1_test.expect_error(format('select public.finalize_active_workout(''phase3-finish-fail'',%L,%L)',jsonb_build_array(draft || '{"id":"failed-close-summary","finishedAt":"2026-10-09T16:00:00Z"}'),draft),'phase3 active deletion failure');
 perform phase1_test.assert_true((select value->>'status'='active' from public.workout_records where id='failed-close'),'last-step finishing failure restores active lifecycle');
 perform phase1_test.assert_true((select value::jsonb=draft from public.app_settings where user_id=auth.uid() and key='active_workout'),'last-step finishing failure preserves draft');
 perform phase1_test.assert_true(not exists(select 1 from public.app_settings settings cross join lateral jsonb_array_elements(settings.value::jsonb) summary where settings.user_id=auth.uid() and settings.key='completed_guided_workouts' and summary->>'id'='failed-close-summary'),'last-step finishing failure does not publish archive summary');
end;
$test$;

-- Legacy receipts retry without assigning grouping that was never recorded.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
reset role;
delete from public.workout_entry_references where session_id=:old_request_link;
set role authenticated;
select public.record_workout_entry('{"workoutId":"never-inferred","requestId":"30000000-0000-0000-0000-000000000001","exerciseId":1,"workoutDate":"2026-10-09","notes":"old request","inputUnit":"lb","recordingOrigin":"guided","sets":[{"reps":5,"weight":95}]}') as legacy_result \gset
select phase1_test.assert_true((:'legacy_result'::jsonb->>'sessionId')::bigint=:old_request_link,'old ambiguous receipt remains retryable');
select phase1_test.assert_true(not exists(select 1 from public.workout_entry_references where session_id=:old_request_link),'old receipt retry never manufactures a grouping');

-- Import adds references only to newly created observations and remains atomic.
select public.import_training_data('[]','[]','[{"exerciseId":1,"workoutDate":"2026-10-09","notes":"phase3 import","inputUnit":"kg","fingerprint":"phase3-import","sets":[{"reps":8,"weight":50}]}]','{}');
select phase1_test.assert_true(exists(select 1 from public.workout_sessions session join public.workout_entry_references reference on reference.session_id=session.id
 join public.workout_records parent on parent.id=reference.workout_id where session.notes='phase3 import' and parent.value->>'kind'='standalone'),'new imported entry has explicit standalone parent');
select phase1_test.assert_true(not exists(select 1 from public.workout_entry_references where session_id=:old_request_link),'import does not group existing uncertain historical entries');

-- Malformed archive evidence may be retired without guessing a guided group.
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000007';
insert into public.app_settings(user_id,key,value) values(auth.uid(),'completed_guided_workouts','{"malformedArchive":true,"originalWeight":80}');
set role authenticated;
select public.initialize_workout_records('[]','[]',null,'{"malformedArchive":true,"originalWeight":80}',null);
select phase1_test.assert_true((select value='{"malformedArchive":true,"originalWeight":80}' from public.app_settings where user_id=auth.uid() and key='completed_guided_workouts'),'one-time migration preserves malformed archive evidence');
reset role;
insert into auth.users values('00000000-0000-0000-0000-000000000012');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000012';
insert into public.app_settings(user_id,key,value) values(auth.uid(),'completed_guided_workouts','unparseable original archive');
set role authenticated;
select public.initialize_workout_records('[]','[]',null,to_jsonb('unparseable original archive'::text),null);
select phase1_test.assert_true((select value='unparseable original archive' from public.app_settings where user_id=auth.uid() and key='completed_guided_workouts'),'invalid JSON archive text remains exact evidence');
reset role;
-- Owner-bound composite keys and the metadata-only shape remain enforced even
-- for privileged writes, independent of whether a caller bypasses the RPC.
select phase1_test.expect_error(format('insert into public.workout_entry_references(session_id,workout_id,user_id) values(%s,''new-guided'',''00000000-0000-0000-0000-000000000006'')',:old_request_link),'foreign key constraint');
select phase1_test.expect_error('insert into public.workout_records(id,user_id,value) values(''copied-facts'',''00000000-0000-0000-0000-000000000006'',''{"id":"copied-facts","kind":"standalone","status":"completed","sets":[{"weight":999}]}'' )','check constraint');

-- Reject a superficially explicit archive link that disagrees with the actual
-- exercise. A context-only active record can still preserve unresolved input.
insert into auth.users values('00000000-0000-0000-0000-000000000010'),('00000000-0000-0000-0000-000000000011');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select public.phase2_save_workout_session(1,'2026-10-09','exercise-mismatch',null,'[{"reps":8,"weight":110}]') as mismatch_link \gset
select jsonb_build_array(jsonb_build_object('id','wrong-exercise','startedAt','wrong-exercise','finishedAt','2026-10-09T10:00:00Z','workoutDate','2026-10-09',
 'todayDayKey','fri','sourceDayKey','fri','plannedMuscles',jsonb_build_array('Chest'),'completedExercises',jsonb_build_array(jsonb_build_object('sessionId',:mismatch_link,'exerciseId',2)))) as mismatch_archive \gset
insert into public.app_settings(user_id,key,value) values(auth.uid(),'completed_guided_workouts',:'mismatch_archive');
set role authenticated;
select phase1_test.expect_error(format('select public.initialize_workout_records(''[{"id":"wrong-group","legacyId":"wrong-exercise","kind":"guided","status":"completed","startedAt":"wrong-exercise"}]'',''[{"workoutId":"wrong-group","sessionId":%s}]'',null,%L,null)',:mismatch_link,:'mismatch_archive'),'does not match owned recorded');
select phase1_test.assert_true(not exists(select 1 from public.app_settings where user_id=auth.uid() and key='workout_reference_migration_v1'),'rejected evidence does not mark migration completed');
select phase1_test.assert_true((select value::jsonb=:'mismatch_archive'::jsonb from public.app_settings where user_id=auth.uid() and key='completed_guided_workouts'),'rejected group preserves old evidence');
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
select '{"startedAt":"unknown-active","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[{"exerciseId":1,"sets":[{"weight":"999"}]}],"unknownLegacyUnit":"preserved"}'::jsonb as uncertain_active \gset
insert into public.app_settings(user_id,key,value) values(auth.uid(),'active_workout',:'uncertain_active');
set role authenticated;
select public.initialize_workout_records('[{"id":"unknown-context","legacyId":"unknown-active","kind":"guided","status":"active","startedAt":"unknown-active"}]','[]',:'uncertain_active','[]',:'uncertain_active'::jsonb || '{"workoutId":"unknown-context","revision":0}');
select phase1_test.assert_true((select count(*)=0 from public.workout_entry_references),'context-only migration invents no observation references');
select phase1_test.assert_true((select value::jsonb - 'workoutId' - 'revision'=:'uncertain_active'::jsonb from public.app_settings where user_id=auth.uid() and key='active_workout'),'context-only migration preserves ambiguous raw observations');
reset role;

-- Prepare two independent-client races for the shell harness below. Each
-- client reads the same saved snapshot rather than reading a newer revision.
insert into auth.users values('00000000-0000-0000-0000-000000000008'),('00000000-0000-0000-0000-000000000009');
create table phase1_test.phase3_race_baseline(owner_id uuid primary key,draft jsonb not null);
grant select on phase1_test.phase3_race_baseline to authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
insert into phase1_test.phase3_race_baseline values(auth.uid(),public.save_active_workout('{"workoutId":"concurrent-draft","revision":0,"startedAt":"concurrent-draft-start","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"currentExercise":{}}')->'activeWorkout');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000009';
insert into phase1_test.phase3_race_baseline values(auth.uid(),public.save_active_workout('{"workoutId":"concurrent-observation","revision":0,"startedAt":"concurrent-observation-start","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"currentExercise":{"muscle":"Chest","exerciseId":1,"notes":"","machineProfileId":null,"requestId":"30000000-0000-0000-0000-000000000009","requestUnit":"kg","sets":[{"reps":"8","weight":"0.3","observationConfirmation":"[\"guided-observation-v1\",1,\"2026-10-09\",null,\"kg\",\"8\",\"0.3\",false]"}]}}')->'activeWorkout');
create function phase1_test.phase3_race_save(p_label text) returns jsonb language plpgsql as $$
declare draft jsonb; begin
 select baseline.draft into draft from phase1_test.phase3_race_baseline baseline where owner_id=auth.uid();
 return public.save_active_workout(draft || jsonb_build_object('workoutLabel',p_label));
end; $$;
create function phase1_test.phase3_race_record() returns jsonb language plpgsql as $$
declare draft jsonb; begin
 select baseline.draft into draft from phase1_test.phase3_race_baseline baseline where owner_id=auth.uid();
 return public.record_workout_entry(jsonb_build_object('workoutId','concurrent-observation','requestId','30000000-0000-0000-0000-000000000009',
   'exerciseId',1,'workoutDate','2026-10-09','notes','','machineProfileId',null,'inputUnit','kg','recordingOrigin','guided',
   'sets',jsonb_build_array(jsonb_build_object('reps',8,'weight',0.3::double precision*2.2046226218::double precision)),
   'expectedActive',draft,'completedAt','2026-10-09T15:00:00Z'));
end; $$;
-- A canonical write may precede initialization (another tab, or an older
-- compatible manual writer). Initialization must keep its original authority.
reset role;
insert into auth.users values ('00000000-0000-0000-0000-000000000013');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000013';
set role authenticated;
do $$
declare sid bigint; original_link text; saved jsonb;
begin
  sid:=public.save_workout_session(1,'2026-10-09','before checkpoint',null,'[{"reps":8,"weight":100}]',null,null,'lb','manual');
  select workout_id into original_link from public.workout_entry_references where session_id=sid;
  saved:=public.save_active_workout('{"workoutId":"before-checkpoint-active","revision":0,"startedAt":"before-checkpoint-start","workoutDate":"2026-10-09","todayDayKey":"fri","sourceDayKey":"fri","plannedMuscles":["Chest"],"completedExercises":[],"scheduleChanges":[],"currentExercise":{}}')->'activeWorkout';
  perform public.initialize_workout_records('[]','[]',saved,'[]',saved);
  perform phase1_test.assert_true((select workout_id=original_link from public.workout_entry_references where session_id=sid),'pre-checkpoint canonical membership preserved');
  perform phase1_test.assert_true((select count(*)=2 from public.workout_records),'pre-checkpoint migration adds no duplicate aggregate');
  perform phase1_test.assert_true((select value::jsonb=saved from public.app_settings where key='workout_reference_legacy_active_evidence_v1'),'pre-checkpoint active snapshot retained');
  perform public.finalize_active_workout('before-checkpoint-active',null,saved);
  perform phase1_test.assert_true((select value::jsonb=saved from public.app_settings where key='workout_reference_legacy_active_evidence_v1'),'retiring mutable draft does not destroy migration evidence');
end; $$;
reset role;
-- Repeat installation neither rewrites completed metadata nor observed facts.
create temporary table phase3_records_before as select * from public.workout_records;
create temporary table phase3_references_before as select * from public.workout_entry_references;
\ir ../migrations/20261009000000_phase3_recording_lifecycle.sql
select phase1_test.assert_true((select jsonb_agg(to_jsonb(row) order by id) from phase3_records_before row)=(select jsonb_agg(to_jsonb(row) order by id) from public.workout_records row),'repeat migration preserves durable metadata');
select phase1_test.assert_true((select jsonb_agg(to_jsonb(row) order by session_id) from phase3_references_before row)=(select jsonb_agg(to_jsonb(row) order by session_id) from public.workout_entry_references row),'repeat migration preserves explicit links');
select 'Phase 3 lifecycle/authority assertions passed: ' || (last_value - :phase3_assertions_before)::text from phase1_test.assertions;
