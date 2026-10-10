-- Apply after Phases 1 and 2. Aggregates contain context and references only;
-- workout_sessions/workout_sets remain the authority for performed observations.
begin;

create unique index if not exists workout_sessions_identity_owner on public.workout_sessions(id, user_id);
create table if not exists public.workout_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  value jsonb not null,
  unique (id, user_id),
  check (jsonb_typeof(value) = 'object' and jsonb_typeof(value->'id')='string' and value->>'id' = id
    and jsonb_typeof(value->'kind')='string' and value->>'kind' in ('guided', 'standalone')
    and jsonb_typeof(value->'status')='string' and value->>'status' in ('active', 'completed')),
  check (value - array['id','legacyId','kind','status','startedAt','finishedAt','label','notes','templateId','scheduledDayId','plannedMuscles','scheduleChanges'] = '{}'::jsonb)
);
create table if not exists public.workout_entry_references (
  session_id bigint primary key,
  workout_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  prescription jsonb,
  completed_at text,
  foreign key (session_id, user_id) references public.workout_sessions(id, user_id) on delete cascade,
  foreign key (workout_id, user_id) references public.workout_records(id, user_id) on delete cascade
);
alter table public.workout_records enable row level security;
alter table public.workout_entry_references enable row level security;
drop policy if exists "workout metadata readable by owner" on public.workout_records;
create policy "workout metadata readable by owner" on public.workout_records for select using (auth.uid() = user_id);
drop policy if exists "workout references readable by owner" on public.workout_entry_references;
create policy "workout references readable by owner" on public.workout_entry_references for select using (auth.uid() = user_id);
revoke all on public.workout_records, public.workout_entry_references from public, anon, authenticated;
grant select on public.workout_records, public.workout_entry_references to authenticated;

-- Migration markers and recovered drafts have the same authority boundary as
-- active drafts. A stale client cannot disable migration or delete recovery.
drop policy if exists "ordinary settings can be inserted by their user" on public.app_settings;
drop policy if exists "ordinary settings can be updated by their user" on public.app_settings;
drop policy if exists "ordinary settings can be deleted by their user" on public.app_settings;
create policy "ordinary settings can be inserted by their user" on public.app_settings for insert
  with check (auth.uid() = user_id and key not in ('active_workout', 'completed_guided_workouts', 'workout_reference_migration_v1', 'recovered_workout_drafts', 'workout_reference_legacy_active_evidence_v1'));
create policy "ordinary settings can be updated by their user" on public.app_settings for update
  using (auth.uid() = user_id and key not in ('active_workout', 'completed_guided_workouts', 'workout_reference_migration_v1', 'recovered_workout_drafts', 'workout_reference_legacy_active_evidence_v1'))
  with check (auth.uid() = user_id and key not in ('active_workout', 'completed_guided_workouts', 'workout_reference_migration_v1', 'recovered_workout_drafts', 'workout_reference_legacy_active_evidence_v1'));
create policy "ordinary settings can be deleted by their user" on public.app_settings for delete
  using (auth.uid() = user_id and key not in ('active_workout', 'completed_guided_workouts', 'workout_reference_migration_v1', 'recovered_workout_drafts', 'workout_reference_legacy_active_evidence_v1'));

create or replace function public.workout_metadata(p_value jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(p_value)
  where key in ('id','legacyId','kind','status','startedAt','finishedAt','label','notes','templateId','scheduledDayId','plannedMuscles','scheduleChanges');
$$;
create or replace function public.workout_metadata_from_draft(p_draft jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',p_draft->>'workoutId','legacyId',p_draft->>'startedAt','kind','guided','status','active',
    'startedAt',p_draft->'startedAt','finishedAt',null,'label',p_draft->'workoutLabel','notes',null,
    'templateId',p_draft->'templateId','scheduledDayId','weekday:' || (p_draft->>'sourceDayKey'),
    'plannedMuscles',coalesce(p_draft->'plannedMuscles','[]'::jsonb),'scheduleChanges',coalesce(p_draft->'scheduleChanges','[]'::jsonb));
$$;
create or replace function public.empty_workout_exercise()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"muscle":null,"exerciseId":null,"sets":[{"reps":"","weight":""},{"reps":"","weight":""},{"reps":"","weight":""}],"notes":"","machineProfileId":null,"barWeight":"45","plateCounts":{"45":0,"35":0,"25":0,"10":0,"5":0}}'::jsonb;
$$;
create or replace function public.recover_workout_draft(p_user uuid, p_draft jsonb)
returns void language plpgsql set search_path = '' as $$
declare recovered jsonb;
begin
  select value::jsonb into recovered from public.app_settings where user_id=p_user and key='recovered_workout_drafts' for update;
  recovered := coalesce(recovered, '[]'::jsonb);
  if jsonb_typeof(recovered) <> 'array' then raise exception 'Stored draft recovery is invalid. No data was changed.'; end if;
  if not exists(select 1 from jsonb_array_elements(recovered) item where item->'draft'=p_draft) then
    recovered := recovered || jsonb_build_array(jsonb_build_object('id',md5(p_user::text || clock_timestamp()::text || p_draft::text),
      'savedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'draft',p_draft));
    insert into public.app_settings(user_id,key,value) values(p_user,'recovered_workout_drafts',recovered::text)
    on conflict(user_id,key) do update set value=excluded.value,updated_at=now();
  end if;
end;
$$;
revoke all on function public.workout_metadata(jsonb), public.workout_metadata_from_draft(jsonb),
  public.empty_workout_exercise(), public.recover_workout_draft(uuid,jsonb) from public, anon, authenticated;

-- Keep editing and old retry contracts, while preventing old callers from
-- creating new guided observations outside the confirmation/atomic boundary.
do $$ begin
  if to_regprocedure('public.phase2_save_workout_session(bigint,date,text,text,jsonb,bigint,uuid,text,text)') is null then
    alter function public.save_workout_session(bigint,date,text,text,jsonb,bigint,uuid,text,text) rename to phase2_save_workout_session;
  end if;
end; $$;
revoke all on function public.phase2_save_workout_session(bigint,date,text,text,jsonb,bigint,uuid,text,text) from public, anon, authenticated;
create or replace function public.save_workout_session(
  p_exercise_id bigint,p_workout_date date,p_notes text,p_machine_profile_id text,p_sets jsonb,
  p_session_id bigint default null,p_request_id uuid default null,p_input_unit text default null,p_recording_origin text default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare owner_id uuid:=auth.uid(); saved_id bigint; is_retry boolean; record_id text;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text,0));
  is_retry:=p_request_id is not null and exists(select 1 from public.workout_write_requests where user_id=owner_id and request_id=p_request_id);
  if p_session_id is null and p_recording_origin='guided' and not is_retry then
    raise exception 'New guided observations require confirmed atomic recording.';
  end if;
  saved_id:=public.phase2_save_workout_session(p_exercise_id,p_workout_date,p_notes,p_machine_profile_id,p_sets,p_session_id,p_request_id,p_input_unit,p_recording_origin);
  if p_session_id is null and not is_retry then
    record_id:='standalone-entry:' || owner_id::text || ':' || saved_id::text;
    insert into public.workout_records(id,user_id,value) values(record_id,owner_id,jsonb_build_object('id',record_id,'legacyId',null,
      'kind','standalone','status','completed','startedAt',null,'finishedAt',null,'label',null,'notes',null,'templateId',null,'scheduledDayId',null,'plannedMuscles','[]'::jsonb,'scheduleChanges','[]'::jsonb));
    insert into public.workout_entry_references(session_id,workout_id,user_id) values(saved_id,record_id,owner_id);
  end if;
  return saved_id;
end;
$$;
revoke all on function public.save_workout_session(bigint,date,text,text,jsonb,bigint,uuid,text,text) from public, anon;
grant execute on function public.save_workout_session(bigint,date,text,text,jsonb,bigint,uuid,text,text) to authenticated;

create or replace function public.initialize_workout_records(
  p_records jsonb, p_references jsonb, p_expected_active jsonb, p_expected_archive jsonb, p_active_workout jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid(); current_active jsonb; current_archive jsonb; archive_text text; contexts jsonb;
  item jsonb; ref jsonb; metadata jsonb; source jsonb; candidate jsonb; legacy_id text;
  session_id_value bigint; exercise_id_value bigint; group_id text; claims integer;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text,0));
  if exists(select 1 from public.app_settings where user_id=owner_id and key='workout_reference_migration_v1') then return; end if;
  select value::jsonb into current_active from public.app_settings where user_id=owner_id and key='active_workout' for update;
  select value into archive_text from public.app_settings where user_id=owner_id and key='completed_guided_workouts' for update;
  begin current_archive:=archive_text::jsonb;
  exception when invalid_text_representation then current_archive:=to_jsonb(archive_text); end;
  current_active := nullif(current_active,'null'::jsonb);
  current_archive := coalesce(current_archive,'[]'::jsonb);
  if current_active is distinct from nullif(p_expected_active,'null'::jsonb) or current_archive is distinct from p_expected_archive then
    raise exception 'Workout evidence changed. Reload before initializing references.';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_typeof(p_references) is distinct from 'array' then
    raise exception 'Workout migration requires explicit records and references.';
  end if;
  contexts := case when jsonb_typeof(current_archive)='array' then current_archive else '[]'::jsonb end;
  if current_active is not null then contexts := contexts || jsonb_build_array(current_active); end if;
  for item in select value from jsonb_array_elements(p_records) loop
    metadata := public.workout_metadata(item);
    if nullif(metadata->>'id','') is null then raise exception 'Workout migration identity is required.'; end if;
    if exists(select 1 from public.workout_records where id=metadata->>'id') then raise exception 'Workout identity already exists. No data was changed.'; end if;
    if metadata->>'kind'='guided' then
      legacy_id := metadata->>'legacyId';
      if current_active->>'startedAt'=legacy_id and not exists(select 1 from jsonb_array_elements(p_references) planned where planned->>'workoutId'=metadata->>'id') then
        source:=current_active;
      else
        select count(*) into claims from jsonb_array_elements(contexts) evidence where evidence->>'startedAt'=legacy_id;
        if claims<>1 then raise exception 'Ambiguous guided workout metadata must remain ungrouped.'; end if;
        select evidence into source from jsonb_array_elements(contexts) evidence where evidence->>'startedAt'=legacy_id;
      end if;
      if jsonb_typeof(source->'startedAt') is distinct from 'string' or jsonb_typeof(source->'workoutDate') is distinct from 'string'
        or jsonb_typeof(source->'todayDayKey') is distinct from 'string' or jsonb_typeof(source->'sourceDayKey') is distinct from 'string'
        or jsonb_typeof(source->'plannedMuscles') is distinct from 'array' or jsonb_typeof(source->'completedExercises') is distinct from 'array'
        or (source is distinct from current_active and jsonb_typeof(source->'finishedAt') is distinct from 'string') then
        raise exception 'Malformed guided evidence must remain ungrouped.';
      end if;
      -- An active context with no linked entries may retain uncertain raw
      -- completion evidence. It supplies no grouping authority for that data.
      -- Every actual guided group must have wholly unambiguous references.
      for candidate in select value from jsonb_array_elements(source->'completedExercises')
        where source is distinct from current_active or exists(select 1 from jsonb_array_elements(p_references) planned where planned->>'workoutId'=metadata->>'id') loop
        if jsonb_typeof(candidate->'sessionId') is distinct from 'number' or jsonb_typeof(candidate->'exerciseId') is distinct from 'number'
          or (candidate->>'sessionId')::numeric<=0 or (candidate->>'exerciseId')::numeric<=0 then
          raise exception 'Unlinked guided evidence must remain ungrouped.';
        end if;
        session_id_value := (candidate->>'sessionId')::bigint;
        exercise_id_value := (candidate->>'exerciseId')::bigint;
        if not exists(select 1 from public.workout_sessions where id=session_id_value and user_id=owner_id)
          or not exists(select 1 from public.workout_sets where session_id=session_id_value and user_id=owner_id)
          or exists(select 1 from public.workout_sets where session_id=session_id_value and (user_id<>owner_id or exercise_id<>exercise_id_value or reps<=0 or weight<0)) then
          raise exception 'Guided migration does not match owned recorded observations.';
        end if;
        select count(*) into claims from jsonb_array_elements(contexts) evidence
          cross join lateral jsonb_array_elements(case when jsonb_typeof(evidence->'completedExercises')='array' then evidence->'completedExercises' else '[]'::jsonb end) linked
          where linked->>'sessionId'=session_id_value::text;
        if claims<>1 then raise exception 'Conflicting guided reference claims must remain ungrouped.'; end if;
      end loop;
      if metadata->>'status' is distinct from (case when source=current_active then 'active' else 'completed' end)
        or metadata->>'startedAt' is distinct from source->>'startedAt' then raise exception 'Workout migration context does not match stored evidence.'; end if;
    elsif metadata->>'kind'='standalone' then
      metadata := jsonb_build_object('id',metadata->>'id','legacyId',null,'kind','standalone','status','completed',
        'startedAt',null,'finishedAt',null,'label',null,'notes',null,'templateId',null,'scheduledDayId',null,'plannedMuscles','[]'::jsonb,'scheduleChanges','[]'::jsonb);
    else raise exception 'Invalid workout migration kind.'; end if;
    insert into public.workout_records(id,user_id,value) values(metadata->>'id',owner_id,metadata);
  end loop;
  for ref in select value from jsonb_array_elements(p_references) loop
    session_id_value := (ref->>'sessionId')::bigint; group_id:=ref->>'workoutId';
    if not exists(select 1 from public.workout_sessions where id=session_id_value and user_id=owner_id) then raise exception 'A migration reference must belong to you.'; end if;
    select value into metadata from public.workout_records where id=group_id and user_id=owner_id;
    if not found then raise exception 'A migration reference requires its owned workout.'; end if;
    if metadata->>'kind'='guided' then
      if not exists(select 1 from jsonb_array_elements(contexts) evidence
        cross join lateral jsonb_array_elements(case when jsonb_typeof(evidence->'completedExercises')='array' then evidence->'completedExercises' else '[]'::jsonb end) linked
        where evidence->>'startedAt'=metadata->>'legacyId' and linked->>'sessionId'=session_id_value::text) then
        raise exception 'Guided migration requires an explicit stored reference.';
      end if;
    end if;
    -- Migration cannot manufacture prescriptions or completion times.
    insert into public.workout_entry_references(session_id,workout_id,user_id,prescription,completed_at)
      values(session_id_value,group_id,owner_id,null,null);
  end loop;
  if current_active is not null then
    insert into public.app_settings(user_id,key,value) values(owner_id,'workout_reference_legacy_active_evidence_v1',current_active::text) on conflict(user_id,key) do nothing;
    if nullif(p_active_workout->>'workoutId','') is null
      or p_active_workout->>'startedAt' is distinct from current_active->>'startedAt'
      or not exists(select 1 from public.workout_records where id=p_active_workout->>'workoutId' and user_id=owner_id and value->>'legacyId'=current_active->>'startedAt' and value->>'status'='active') then
      raise exception 'The active migration identity does not match stored evidence.';
    end if;
    current_active := current_active || jsonb_build_object('workoutId',p_active_workout->>'workoutId','revision',coalesce(current_active->'revision','0'::jsonb));
    update public.app_settings set value=current_active::text,updated_at=now() where user_id=owner_id and key='active_workout';
  elsif p_active_workout is not null and p_active_workout<>'null'::jsonb then raise exception 'Migration cannot invent an active workout.'; end if;
  insert into public.app_settings(user_id,key,value) values(owner_id,'workout_reference_migration_v1','true');
end;
$$;

drop function if exists public.save_active_workout(jsonb);
create function public.save_active_workout(p_active_workout jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner_id uuid:=auth.uid(); current_active jsonb; saved jsonb; metadata jsonb; revision_value bigint;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  if jsonb_typeof(p_active_workout) is distinct from 'object' or nullif(p_active_workout->>'workoutId','') is null
    or nullif(p_active_workout->>'startedAt','') is null or jsonb_typeof(p_active_workout->'revision') is distinct from 'number'
    or (p_active_workout->>'revision')::numeric<0 or (p_active_workout->>'revision')::numeric<>trunc((p_active_workout->>'revision')::numeric) then
    raise exception 'A durable workout identity and expected revision are required. Reload before saving.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text,0));
  select value::jsonb into current_active from public.app_settings where user_id=owner_id and key='active_workout' for update;
  current_active:=nullif(current_active,'null'::jsonb);
  if exists(select 1 from public.active_workout_retirements where user_id=owner_id and workout_id in(p_active_workout->>'startedAt',p_active_workout->>'workoutId'))
    or exists(select 1 from public.workout_records where id=p_active_workout->>'workoutId' and (user_id<>owner_id or value->>'status'<>'active' or value->>'kind'<>'guided' or value->>'startedAt' is distinct from p_active_workout->>'startedAt')) then
    perform public.recover_workout_draft(owner_id,p_active_workout);
    return jsonb_build_object('conflict',true,'current',current_active);
  end if;
  if current_active is not null and current_active->>'workoutId'=p_active_workout->>'workoutId'
    and current_active->>'startedAt'=p_active_workout->>'startedAt' and (current_active-'revision')=(p_active_workout-'revision') then
    return jsonb_build_object('activeWorkout',current_active);
  end if;
  revision_value:=coalesce((current_active->>'revision')::bigint,0);
  if (current_active is not null and (current_active->>'workoutId' is distinct from p_active_workout->>'workoutId'
    or current_active->>'startedAt' is distinct from p_active_workout->>'startedAt'))
    or (p_active_workout->>'revision')::bigint<>revision_value then
    perform public.recover_workout_draft(owner_id,p_active_workout);
    return jsonb_build_object('conflict',true,'current',current_active);
  end if;
  saved:=p_active_workout || jsonb_build_object('revision',revision_value+1);
  metadata:=public.workout_metadata_from_draft(saved);
  insert into public.workout_records(id,user_id,value) values(saved->>'workoutId',owner_id,metadata)
    on conflict(id) do update set value=excluded.value where public.workout_records.user_id=owner_id;
  insert into public.app_settings(user_id,key,value) values(owner_id,'active_workout',saved::text)
    on conflict(user_id,key) do update set value=excluded.value,updated_at=now();
  return jsonb_build_object('activeWorkout',saved);
end;
$$;

create or replace function public.record_workout_entry(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid:=auth.uid(); current_active jsonb; expected_active jsonb:=p_input->'expectedActive';
  workout_id_value text:=p_input->>'workoutId'; request_id_value uuid:=(p_input->>'requestId')::uuid;
  session_id_value bigint; reference_workout text; row_value jsonb; fingerprint jsonb; expected_fingerprint jsonb;
  observed jsonb; draft jsonb; normalized_input jsonb; set_index integer:=0; entered_weight numeric; multiplier numeric;
  completed jsonb; revised jsonb;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  if nullif(workout_id_value,'') is null or request_id_value is null then raise exception 'Recording requires durable workout and request identities.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text,0));
  select value::jsonb into current_active from public.app_settings where user_id=owner_id and key='active_workout' for update;
  current_active:=nullif(current_active,'null'::jsonb);
  -- Validate and return an existing receipt BEFORE checking a potentially newer
  -- draft. Retrying a committed entry cannot append or clear another exercise.
  if exists(select 1 from public.workout_write_requests where user_id=owner_id and request_id=request_id_value) then
    session_id_value:=public.phase2_save_workout_session((p_input->>'exerciseId')::bigint,(p_input->>'workoutDate')::date,p_input->>'notes',p_input->>'machineProfileId',
      p_input->'sets',null,request_id_value,p_input->>'inputUnit',p_input->>'recordingOrigin');
    select workout_id into reference_workout from public.workout_entry_references where session_id=session_id_value and user_id=owner_id;
    if found and reference_workout<>workout_id_value then raise exception 'A recorded entry cannot be moved to another workout.'; end if;
    return jsonb_build_object('sessionId',session_id_value,'activeWorkout',current_active);
  end if;
  if p_input->>'recordingOrigin'='guided' then
    if expected_active is null or expected_active='null'::jsonb or current_active is distinct from expected_active then
      if expected_active is not null and expected_active<>'null'::jsonb then perform public.recover_workout_draft(owner_id,expected_active); end if;
      return jsonb_build_object('conflict',true,'current',current_active);
    end if;
    draft:=current_active->'currentExercise';
    if current_active->>'workoutId' is distinct from workout_id_value or draft->>'requestId' is distinct from request_id_value::text
      or (draft->>'exerciseId')::bigint is distinct from (p_input->>'exerciseId')::bigint
      or current_active->>'workoutDate' is distinct from p_input->>'workoutDate'
      or draft->>'requestUnit' is distinct from p_input->>'inputUnit'
      or draft->>'notes' is distinct from p_input->>'notes'
      or draft->>'machineProfileId' is distinct from p_input->>'machineProfileId' then
      raise exception 'The recording attempt does not match the saved workout draft.';
    end if;
    if not exists(select 1 from public.workout_records where id=workout_id_value and user_id=owner_id and value->>'status'='active')
      or exists(select 1 from public.active_workout_retirements where user_id=owner_id and workout_id in(workout_id_value,current_active->>'startedAt')) then
      raise exception 'This workout was already finished or discarded.';
    end if;
    if nullif(draft->>'muscle','') is null then raise exception 'The selected exercise has no muscle context. Review the draft before recording.'; end if;
    if jsonb_typeof(draft->'sets') is distinct from 'array' or jsonb_typeof(p_input->'sets') is distinct from 'array'
      or p_input->>'inputUnit' is null or p_input->>'inputUnit' not in('lb','kg') then raise exception 'Confirmed guided observations and input units are required.'; end if;
    multiplier:=case when p_input->>'inputUnit'='kg' then 2.2046226218 else 1 end;
    for row_value in select value from jsonb_array_elements(draft->'sets') loop
      if coalesce(trim(row_value->>'reps'),'')='' and coalesce(trim(row_value->>'weight'),'')='' then continue; end if;
      if jsonb_typeof(row_value->'reps') is distinct from 'string' or jsonb_typeof(row_value->'weight') is distinct from 'string'
        or nullif(trim(row_value->>'reps'),'') is null or nullif(trim(row_value->>'weight'),'') is null
        or jsonb_typeof(row_value->'observationConfirmation') is distinct from 'string' then
        raise exception 'Suggested or changed values require explicit performed confirmation.';
      end if;
      begin fingerprint:=(row_value->>'observationConfirmation')::jsonb;
      exception when invalid_text_representation then raise exception 'Invalid performed confirmation.'; end;
      expected_fingerprint:=jsonb_build_array('guided-observation-v1',(p_input->>'exerciseId')::bigint,p_input->>'workoutDate',p_input->>'machineProfileId',
        p_input->>'inputUnit',trim(row_value->>'reps'),trim(row_value->>'weight'),coalesce((row_value->>'isWarmup')::boolean,false));
      if fingerprint is distinct from expected_fingerprint then raise exception 'Suggested or changed values require explicit performed confirmation.'; end if;
      observed:=p_input->'sets'->set_index;
      entered_weight:=(trim(row_value->>'weight'))::numeric;
      if (trim(row_value->>'reps'))::numeric is distinct from (observed->>'reps')::numeric
        or entered_weight::double precision*multiplier::double precision is distinct from (observed->>'weight')::double precision
        or coalesce((row_value->>'isWarmup')::boolean,false) is distinct from coalesce((observed->>'isWarmup')::boolean,false) then
        raise exception 'Recorded observations do not match confirmed values.';
      end if;
      set_index:=set_index+1;
    end loop;
    if set_index=0 or set_index<>jsonb_array_length(p_input->'sets') then raise exception 'Recorded observations do not match confirmed values.'; end if;
  elsif p_input->>'recordingOrigin'='manual' then
    if expected_active is not null and expected_active<>'null'::jsonb then raise exception 'Manual recording cannot mutate a guided draft.'; end if;
    if exists(select 1 from public.workout_records where id=workout_id_value) then raise exception 'New standalone recording requires a new workout identity.'; end if;
    insert into public.workout_records(id,user_id,value) values(workout_id_value,owner_id,jsonb_build_object('id',workout_id_value,'legacyId',null,
      'kind','standalone','status','completed','startedAt',null,'finishedAt',null,'label',null,'notes',null,'templateId',null,'scheduledDayId',null,'plannedMuscles','[]'::jsonb,'scheduleChanges','[]'::jsonb));
  else raise exception 'A manual or guided recording origin is required.'; end if;
  session_id_value:=public.phase2_save_workout_session((p_input->>'exerciseId')::bigint,(p_input->>'workoutDate')::date,p_input->>'notes',p_input->>'machineProfileId',
    p_input->'sets',null,request_id_value,p_input->>'inputUnit',p_input->>'recordingOrigin');
  insert into public.workout_entry_references(session_id,workout_id,user_id,prescription,completed_at)
    values(session_id_value,workout_id_value,owner_id,case when p_input->>'recordingOrigin'='guided' then nullif(draft->'prescription','null'::jsonb) else null end,p_input->>'completedAt');
  if p_input->>'recordingOrigin'='guided' then
    select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into completed from jsonb_array_elements(coalesce(current_active->'completedExercises','[]'::jsonb)) with ordinality entries(value,ordinal)
      where value->>'sessionId' is distinct from session_id_value::text;
    completed:=completed || jsonb_build_array(jsonb_build_object('sessionId',session_id_value,'exerciseId',(p_input->>'exerciseId')::bigint,
      'machineProfileId',p_input->>'machineProfileId','exerciseName','','muscle',draft->>'muscle','sets','[]'::jsonb,'completedAt',p_input->>'completedAt'));
    revised:=current_active || jsonb_build_object('completedExercises',completed,'currentExercise',public.empty_workout_exercise(),'revision',(current_active->>'revision')::bigint+1);
    update public.app_settings set value=revised::text,updated_at=now() where user_id=owner_id and key='active_workout';
    current_active:=revised;
  end if;
  return jsonb_build_object('sessionId',session_id_value,'activeWorkout',current_active);
end;
$$;

create or replace function public.finalize_active_workout(p_workout_id text,p_completed_workouts jsonb default null,p_expected_active jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid:=auth.uid(); active_record jsonb; archived_records jsonb; requested jsonb; summary jsonb; completed jsonb; stable_id text;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  if nullif(p_workout_id,'') is null then raise exception 'The active workout identifier is required.'; end if;
  if p_completed_workouts is not null and jsonb_typeof(p_completed_workouts)<>'array' then raise exception 'Completed workouts must be an array.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text,0));
  select value::jsonb into active_record from public.app_settings where user_id=owner_id and key='active_workout' for update;
  select value::jsonb into archived_records from public.app_settings where user_id=owner_id and key='completed_guided_workouts' for update;
  archived_records:=coalesce(archived_records,'[]'::jsonb);
  if jsonb_typeof(archived_records)<>'array' then raise exception 'Stored workout summaries are invalid. No data was changed.'; end if;
  if active_record is null or active_record='null'::jsonb then
    if p_completed_workouts is null or exists(select 1 from jsonb_array_elements(archived_records) item where item->>'startedAt'=p_workout_id or item->>'workoutId'=p_workout_id)
      or exists(select 1 from public.active_workout_retirements where user_id=owner_id and workout_id=p_workout_id) then
      insert into public.active_workout_retirements(user_id,workout_id) values(owner_id,p_workout_id) on conflict do nothing; return;
    end if;
    raise exception 'This active workout is no longer available.';
  end if;
  if p_workout_id not in(active_record->>'startedAt',coalesce(active_record->>'workoutId',active_record->>'startedAt')) then raise exception 'A different workout is active. This request did not change it.'; end if;
  if p_expected_active is null then raise exception 'The current active-workout snapshot is required before finishing or discarding.'; end if;
  if active_record<>p_expected_active then raise exception 'The active workout changed. Refresh it before finishing or discarding.'; end if;
  if exists(select 1 from public.active_workout_retirements where user_id=owner_id and workout_id in(p_workout_id,active_record->>'startedAt',active_record->>'workoutId')) then raise exception 'This workout was already finished or discarded.'; end if;
  stable_id:=active_record->>'workoutId';
  if p_completed_workouts is not null then
    select item into requested from jsonb_array_elements(p_completed_workouts) item where item->>'startedAt'=active_record->>'startedAt' limit 1;
    if requested is null or nullif(requested->>'id','') is null or nullif(requested->>'finishedAt','') is null then raise exception 'The completed summary must identify the active workout and completion time.'; end if;
    if stable_id is null then raise exception 'Initialize durable workout references before completing this workout.'; end if;
    -- Derive only links/context. Legacy archive evidence is never rewritten.
    select coalesce(jsonb_agg(jsonb_build_object('sessionId',reference.session_id,'exerciseId',identity.exercise_id,
      'machineProfileId',session.machine_profile_id,'exerciseName','','muscle',coalesce(prior.entry->>'muscle',exercise.primary_muscle),
      'sets','[]'::jsonb,'completedAt',reference.completed_at) order by reference.session_id),'[]'::jsonb) into completed
      from public.workout_entry_references reference join public.workout_sessions session on session.id=reference.session_id and session.user_id=owner_id
      cross join lateral (select min(exercise_id) exercise_id from public.workout_sets where session_id=session.id having count(distinct exercise_id)=1) identity
      join public.exercises exercise on exercise.id=identity.exercise_id
      left join lateral (select item entry from jsonb_array_elements(coalesce(active_record->'completedExercises','[]'::jsonb)) item where item->>'sessionId'=session.id::text limit 1) prior on true
      where reference.workout_id=stable_id and reference.user_id=owner_id;
    summary:=active_record || jsonb_build_object('id',requested->>'id','finishedAt',requested->>'finishedAt','completedExercises',completed,'currentExercise',public.empty_workout_exercise());
    select jsonb_build_array(summary) || coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into archived_records
      from jsonb_array_elements(archived_records) with ordinality evidence(item,ordinal) where item->>'startedAt' is distinct from active_record->>'startedAt';
    insert into public.app_settings(user_id,key,value) values(owner_id,'completed_guided_workouts',archived_records::text)
      on conflict(user_id,key) do update set value=excluded.value,updated_at=now();
  end if;
  if stable_id is not null then
    update public.workout_records set value=value || jsonb_build_object('status','completed','finishedAt',case when p_completed_workouts is not null then requested->>'finishedAt' else null end)
      where id=stable_id and user_id=owner_id;
    insert into public.active_workout_retirements(user_id,workout_id) values(owner_id,stable_id) on conflict do nothing;
  end if;
  insert into public.active_workout_retirements(user_id,workout_id) values(owner_id,active_record->>'startedAt') on conflict do nothing;
  delete from public.app_settings where user_id=owner_id and key='active_workout';
end;
$$;

-- Retain Phase 2 import matching/receipts. The wrapper adds a reference only for
-- genuinely new sessions, inside the same transaction; old uncertain entries
-- are left to the explicit one-time migration.
do $$ begin
  if to_regprocedure('public.phase2_import_training_data(jsonb,jsonb,jsonb,bigint[])') is null then
    alter function public.import_training_data(jsonb,jsonb,jsonb,bigint[]) rename to phase2_import_training_data;
  end if;
end; $$;
revoke all on function public.phase2_import_training_data(jsonb,jsonb,jsonb,bigint[]) from public, anon, authenticated;
create or replace function public.import_training_data(p_body_weights jsonb,p_body_measurements jsonb,p_workouts jsonb,p_exercise_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid:=auth.uid(); prior_ids bigint[]; new_entry record; record_id text;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text,0));
  select coalesce(array_agg(id),'{}'::bigint[]) into prior_ids from public.workout_sessions where user_id=owner_id;
  perform public.phase2_import_training_data(p_body_weights,p_body_measurements,p_workouts,p_exercise_ids);
  for new_entry in select id from public.workout_sessions where user_id=owner_id and not(id=any(prior_ids))
    and not exists(select 1 from public.workout_entry_references where session_id=public.workout_sessions.id) loop
    record_id:='import-entry:' || owner_id::text || ':' || new_entry.id::text;
    insert into public.workout_records(id,user_id,value) values(record_id,owner_id,jsonb_build_object('id',record_id,'legacyId',null,
      'kind','standalone','status','completed','startedAt',null,'finishedAt',null,'label',null,'notes',null,'templateId',null,'scheduledDayId',null,'plannedMuscles','[]'::jsonb,'scheduleChanges','[]'::jsonb));
    insert into public.workout_entry_references(session_id,workout_id,user_id) values(new_entry.id,record_id,owner_id);
  end loop;
end;
$$;

revoke all on function public.initialize_workout_records(jsonb,jsonb,jsonb,jsonb,jsonb), public.save_active_workout(jsonb),
  public.record_workout_entry(jsonb), public.finalize_active_workout(text,jsonb,jsonb), public.import_training_data(jsonb,jsonb,jsonb,bigint[]) from public, anon;
grant execute on function public.initialize_workout_records(jsonb,jsonb,jsonb,jsonb,jsonb), public.save_active_workout(jsonb),
  public.record_workout_entry(jsonb), public.finalize_active_workout(text,jsonb,jsonb), public.import_training_data(jsonb,jsonb,jsonb,bigint[]) to authenticated;
commit;
