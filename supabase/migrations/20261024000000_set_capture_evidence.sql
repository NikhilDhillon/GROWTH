begin;

-- Set capture metadata: when a set was captured during the workout and how its
-- values were entered. It is not part of the observation, so it never enters a
-- retry payload hash and existing receipts keep matching. Rows recorded before
-- this migration keep unknown (null) metadata; nothing is backfilled or guessed.
alter table public.workout_sets add column if not exists performed_at timestamptz;
alter table public.workout_sets add column if not exists evidence text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workout_sets_evidence_check' and conrelid = 'public.workout_sets'::regclass) then
    alter table public.workout_sets add constraint workout_sets_evidence_check check (evidence in ('typed', 'flow', 'planned', 'recalled'));
  end if;
end; $$;

-- Same contract as Phase 2, plus optional per-set performedAt/evidence. A history
-- edit keeps the original evidence of a set whose values are unchanged, marks a
-- changed set as typed, and keeps capture timing with the set's position.
create or replace function public.phase2_save_workout_session(
  p_exercise_id bigint, p_workout_date date, p_notes text, p_machine_profile_id text,
  p_sets jsonb, p_session_id bigint default null, p_request_id uuid default null,
  p_input_unit text default null, p_recording_origin text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  recording_user uuid := auth.uid();
  saved_session public.workout_sessions%rowtype;
  receipt public.workout_write_requests%rowtype;
  normalized_sets jsonb;
  input_hash text;
  legacy_hash text;
  input_payload jsonb;
  row_value jsonb;
  set_index integer := 0;
  timestamp_value timestamptz;
  previous_sets jsonb := '[]'::jsonb;
  previous_set jsonb;
  capture_time timestamptz;
  capture_evidence text;
begin
  if recording_user is null then raise exception 'Please log in again.'; end if;
  if p_exercise_id is null or p_workout_date is null then raise exception 'An exercise and workout date are required.'; end if;
  if extract(year from p_workout_date) not between 1 and 9999 then raise exception 'A supported calendar date is required.'; end if;
  if p_input_unit is not null and p_input_unit not in ('lb', 'kg') then raise exception 'Input units must be lb or kg.'; end if;
  if p_recording_origin is not null and p_recording_origin not in ('manual', 'guided', 'import') then raise exception 'Invalid recording origin.'; end if;
  if p_session_id is not null and p_recording_origin is not null then raise exception 'Recording origin cannot be changed when editing.'; end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'At least one observed set is required.';
  end if;
  if p_session_id is not null and p_request_id is not null then raise exception 'Create request IDs cannot be used for editing.'; end if;
  for row_value in select value from jsonb_array_elements(p_sets) loop
    if jsonb_typeof(row_value) <> 'object' or jsonb_typeof(row_value->'reps') is distinct from 'number'
      or jsonb_typeof(row_value->'weight') is distinct from 'number'
      or (row_value->>'reps')::numeric <= 0 or (row_value->>'reps')::numeric <> trunc((row_value->>'reps')::numeric)
      or (row_value->>'weight')::numeric < 0
      or (row_value ? 'isWarmup' and jsonb_typeof(row_value->'isWarmup') <> 'boolean') then
      raise exception 'Observed sets require positive whole reps, non-negative weight and a valid warm-up flag.';
    end if;
    if jsonb_typeof(row_value->'evidence') = 'string' and row_value->>'evidence' not in ('typed', 'flow', 'planned', 'recalled')
      or (row_value ? 'evidence' and jsonb_typeof(row_value->'evidence') not in ('string', 'null')) then
      raise exception 'A set''s capture method is invalid.';
    end if;
    if row_value ? 'performedAt' and jsonb_typeof(row_value->'performedAt') not in ('string', 'null') then
      raise exception 'A set''s capture time is invalid.';
    end if;
    if jsonb_typeof(row_value->'performedAt') = 'string' then
      begin
        capture_time := (row_value->>'performedAt')::timestamptz;
      exception when others then
        raise exception 'A set''s capture time is invalid.';
      end;
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('reps', (value->>'reps')::numeric::integer, 'weight', trim_scale((value->>'weight')::numeric),
    'isWarmup', coalesce((value->>'isWarmup')::boolean, false)) order by ordinal)
  into normalized_sets from jsonb_array_elements(p_sets) with ordinality as input(value, ordinal);
  input_payload := jsonb_build_object('exerciseId', p_exercise_id, 'workoutDate', p_workout_date,
    'notes', p_notes, 'machineProfileId', p_machine_profile_id, 'sets', normalized_sets);
  legacy_hash := encode(sha256(convert_to(input_payload::text, 'UTF8')), 'hex');
  if p_input_unit is not null then input_payload := input_payload || jsonb_build_object('inputUnit', p_input_unit); end if;
  if p_recording_origin is not null then input_payload := input_payload || jsonb_build_object('recordingOrigin', p_recording_origin); end if;
  input_hash := encode(sha256(convert_to(input_payload::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || recording_user::text, 0));
  if p_request_id is not null then
    select * into receipt from public.workout_write_requests where user_id = recording_user and request_id = p_request_id;
    if found then
      if receipt.payload_hash <> input_hash and receipt.payload_hash <> legacy_hash then raise exception 'This save request was already used for different observations.'; end if;
      if receipt.session_id is null then raise exception 'This saved workout was deleted. Start a new recording to save new work.'; end if;
      return receipt.session_id;
    end if;
  end if;

  if p_session_id is null then
    timestamp_value := (p_workout_date::text || 'T12:00:00Z')::timestamptz;
    insert into public.workout_sessions (user_id, workout_date, notes, machine_profile_id, input_unit, recording_origin, created_at)
    values (recording_user, p_workout_date, p_notes, p_machine_profile_id, p_input_unit, p_recording_origin, timestamp_value)
    returning * into saved_session;
  else
    select * into saved_session from public.workout_sessions where id = p_session_id and user_id = recording_user for update;
    if not found then raise exception 'This workout is unavailable or does not belong to you.'; end if;
    timestamp_value := saved_session.created_at;
    update public.workout_sessions set workout_date = p_workout_date, notes = p_notes, machine_profile_id = p_machine_profile_id, input_unit = p_input_unit
    where id = saved_session.id;
    select coalesce(jsonb_agg(jsonb_build_object('reps', existing.reps, 'weight', existing.weight, 'isWarmup', existing.is_warmup,
      'performedAt', existing.performed_at, 'evidence', existing.evidence) order by existing.set_number, existing.id), '[]'::jsonb)
    into previous_sets from public.workout_sets existing where existing.session_id = saved_session.id;
    delete from public.workout_sets where session_id = saved_session.id;
  end if;

  for row_value in select value from jsonb_array_elements(normalized_sets) loop
    set_index := set_index + 1;
    capture_time := (p_sets->(set_index - 1)->>'performedAt')::timestamptz;
    capture_evidence := p_sets->(set_index - 1)->>'evidence';
    if p_session_id is not null then
      previous_set := previous_sets->(set_index - 1);
      if previous_set is not null and (previous_set->>'reps')::integer = (row_value->>'reps')::integer
        and (previous_set->>'weight')::numeric = (row_value->>'weight')::numeric
        and (previous_set->>'isWarmup')::boolean = (row_value->>'isWarmup')::boolean then
        capture_evidence := previous_set->>'evidence';
      else
        capture_evidence := coalesce(capture_evidence, 'typed');
      end if;
      capture_time := coalesce(capture_time, (previous_set->>'performedAt')::timestamptz);
    end if;
    insert into public.workout_sets (user_id, session_id, exercise_id, set_number, reps, weight, rir, is_warmup, performed_at, evidence, created_at)
    values (recording_user, saved_session.id, p_exercise_id, set_index, (row_value->>'reps')::integer,
      (row_value->>'weight')::numeric, null, (row_value->>'isWarmup')::boolean, capture_time, capture_evidence, timestamp_value);
  end loop;
  if p_request_id is not null then
    insert into public.workout_write_requests (user_id, request_id, payload_hash, session_id)
    values (recording_user, p_request_id, input_hash, saved_session.id);
  end if;
  return saved_session.id;
end;
$$;
revoke all on function public.phase2_save_workout_session(bigint,date,text,text,jsonb,bigint,uuid,text,text) from public, anon, authenticated;

commit;
