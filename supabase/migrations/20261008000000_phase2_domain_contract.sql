-- Apply after Phase 1. Recorded sessions and sets remain authoritative.
-- This migration never guesses historical input units, ownership or archive links.
begin;
-- Phase 2 provenance is additive; missing historical evidence stays NULL.
alter table public.workout_sessions add column if not exists input_unit text check (input_unit in ('lb', 'kg'));
alter table public.workout_sessions add column if not exists recording_origin text check (recording_origin in ('manual', 'guided', 'import'));

drop function if exists public.save_workout_session(bigint, date, text, text, jsonb, bigint, uuid);

create or replace function public.save_workout_session(
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
    delete from public.workout_sets where session_id = saved_session.id;
  end if;

  for row_value in select value from jsonb_array_elements(normalized_sets) loop
    set_index := set_index + 1;
    insert into public.workout_sets (user_id, session_id, exercise_id, set_number, reps, weight, rir, is_warmup, created_at)
    values (recording_user, saved_session.id, p_exercise_id, set_index, (row_value->>'reps')::integer,
      (row_value->>'weight')::numeric, null, (row_value->>'isWarmup')::boolean, timestamp_value);
  end loop;
  if p_request_id is not null then
    insert into public.workout_write_requests (user_id, request_id, payload_hash, session_id)
    values (recording_user, p_request_id, input_hash, saved_session.id);
  end if;
  return saved_session.id;
end;
$$;

create or replace function public.finalize_active_workout(
  p_workout_id text, p_completed_workouts jsonb default null, p_expected_active jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  finishing_user uuid := auth.uid();
  active_record jsonb;
  archived_records jsonb := '[]'::jsonb;
  requested_summary jsonb;
  merged_records jsonb;
begin
  if finishing_user is null then raise exception 'Please log in again.'; end if;
  if nullif(p_workout_id, '') is null then raise exception 'The active workout identifier is required.'; end if;
  if p_completed_workouts is not null and jsonb_typeof(p_completed_workouts) <> 'array' then
    raise exception 'Completed workouts must be an array.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || finishing_user::text, 0));
  select value::jsonb into active_record from public.app_settings where user_id = finishing_user and key = 'active_workout' for update;
  select value::jsonb into archived_records from public.app_settings where user_id = finishing_user and key = 'completed_guided_workouts' for update;
  archived_records := coalesce(archived_records, '[]'::jsonb);
  if jsonb_typeof(archived_records) <> 'array' then raise exception 'Stored workout summaries are invalid. No data was changed.'; end if;
  if active_record is null or active_record = 'null'::jsonb then
    if p_completed_workouts is null or exists (
      select 1 from jsonb_array_elements(archived_records) summary where summary->>'startedAt' = p_workout_id
    ) or exists (
      select 1 from public.active_workout_retirements where user_id = finishing_user and workout_id = p_workout_id
    ) then
      insert into public.active_workout_retirements (user_id, workout_id) values (finishing_user, p_workout_id)
      on conflict (user_id, workout_id) do nothing;
      return;
    end if;
    raise exception 'This active workout is no longer available.';
  end if;
  if active_record->>'startedAt' is distinct from p_workout_id then
    raise exception 'A different workout is active. This request did not change it.';
  end if;
  if p_expected_active is null then
    raise exception 'The current active-workout snapshot is required before finishing or discarding.';
  end if;
  if active_record <> p_expected_active then
    raise exception 'The active workout changed. Refresh it before finishing or discarding.';
  end if;
  if exists (select 1 from public.active_workout_retirements where user_id = finishing_user and workout_id = p_workout_id) then
    raise exception 'This workout was already finished or discarded. This request did not change it.';
  end if;

  if p_completed_workouts is not null then
    select value into requested_summary from jsonb_array_elements(p_completed_workouts)
    where value->>'startedAt' = p_workout_id limit 1;
    if requested_summary is null or nullif(requested_summary->>'id', '') is null then
      raise exception 'The completed summary must identify the active workout.';
    end if;
    -- Only this explicit current summary may come from the client. Keep the
    -- server's unrelated archive entries exactly as stored; neither stale
    -- client extras nor guessed legacy summary IDs may rewrite that history.
    select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into merged_records from (
      select value, ordinal from (
        select requested_summary as value, 0::bigint as ordinal
        union all
        select value, ordinal from jsonb_array_elements(archived_records) with ordinality as summaries(value, ordinal)
        where value->>'startedAt' is distinct from p_workout_id
      ) authoritative_summaries order by ordinal
    ) limited_summaries;
    insert into public.app_settings (user_id, key, value, updated_at)
    values (finishing_user, 'completed_guided_workouts', merged_records::text, now())
    on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
  insert into public.active_workout_retirements (user_id, workout_id) values (finishing_user, p_workout_id)
  on conflict (user_id, workout_id) do nothing;
  delete from public.app_settings where user_id = finishing_user and key = 'active_workout';
end;
$$;

create or replace function public.import_training_data(
  p_body_weights jsonb, p_body_measurements jsonb, p_workouts jsonb, p_exercise_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  importing_user uuid := auth.uid();
  row_value jsonb;
  exercise_id_value bigint;
  fingerprint_value text;
  receipt_text text;
  receipts jsonb := '[]'::jsonb;
  normalized_sets jsonb;
  imported_session bigint;
begin
  if importing_user is null then raise exception 'Please log in again.'; end if;
  if p_body_weights is null or jsonb_typeof(p_body_weights) <> 'array'
    or p_body_measurements is null or jsonb_typeof(p_body_measurements) <> 'array'
    or p_workouts is null or jsonb_typeof(p_workouts) <> 'array' then raise exception 'Import records must be arrays.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || importing_user::text, 0));
  select value into receipt_text from public.app_settings
  where user_id = importing_user and key = 'imported_workout_fingerprints' for update;
  if receipt_text is not null then
    begin receipts := receipt_text::jsonb;
    exception when others then raise exception 'Imported workout receipts are invalid. No data was changed.'; end;
    if jsonb_typeof(receipts) <> 'array' or exists (
      select 1 from jsonb_array_elements(receipts) receipt where jsonb_typeof(receipt) <> 'string'
    ) then raise exception 'Imported workout receipts are invalid. No data was changed.'; end if;
  end if;

  for row_value in select value from jsonb_array_elements(p_body_measurements) loop
    if jsonb_typeof(row_value->'measurements') is distinct from 'object'
      or (row_value->'weight' <> 'null'::jsonb and (jsonb_typeof(row_value->'weight') is distinct from 'number'
        or (row_value->>'weight')::numeric <= 0)) then raise exception 'Invalid imported body measurement.'; end if;
    insert into public.body_measurement_logs (user_id, logged_date, weight, measurements, notes, updated_at)
    values (importing_user, (row_value->>'loggedDate')::date, (row_value->>'weight')::numeric,
      row_value->'measurements', row_value->>'notes', now())
    on conflict (user_id, logged_date) do update set
      weight = coalesce(excluded.weight, public.body_measurement_logs.weight), measurements = excluded.measurements,
      notes = excluded.notes, updated_at = excluded.updated_at;
  end loop;
  for row_value in select value from jsonb_array_elements(p_body_weights) loop
    if jsonb_typeof(row_value->'weight') is distinct from 'number' or (row_value->>'weight')::numeric <= 0 then
      raise exception 'Invalid imported bodyweight.';
    end if;
    insert into public.body_measurement_logs (user_id, logged_date, weight, created_at, updated_at)
    values (importing_user, (row_value->>'loggedDate')::date, (row_value->>'weight')::numeric,
      ((row_value->>'loggedDate') || 'T12:00:00Z')::timestamptz, now())
    on conflict (user_id, logged_date) do update set weight = excluded.weight, updated_at = excluded.updated_at;
  end loop;
  foreach exercise_id_value in array coalesce(p_exercise_ids, '{}'::bigint[]) loop
    insert into public.user_exercise_preferences (user_id, exercise_id, enabled, updated_at)
    values (importing_user, exercise_id_value, 1, now())
    on conflict (user_id, exercise_id) do update set enabled = 1, updated_at = excluded.updated_at;
  end loop;

  for row_value in select value from jsonb_array_elements(p_workouts) loop
    fingerprint_value := row_value->>'fingerprint';
    if nullif(fingerprint_value, '') is null then raise exception 'An imported workout fingerprint is required.'; end if;
    if receipts ? fingerprint_value then continue; end if;
    if row_value->'sets' is null or jsonb_typeof(row_value->'sets') <> 'array' then raise exception 'Imported sets must be an array.'; end if;
    select jsonb_agg(jsonb_build_object('reps', (value->>'reps')::numeric::integer, 'weight', round((value->>'weight')::numeric, 4), 'isWarmup', coalesce((value->>'isWarmup')::boolean, false)) order by ordinal)
    into normalized_sets from jsonb_array_elements(row_value->'sets') with ordinality as input(value, ordinal);
    -- Content matching is owner-scoped; a friend's identical observations
    -- cannot suppress this user's import. External receipts retain old rules.
    if fingerprint_value like 'content::%' and exists (
      select 1 from public.workout_sessions session where session.user_id = importing_user
        and session.workout_date = (row_value->>'workoutDate')::date
        and regexp_replace(trim(coalesce(session.notes, '')), '\s+', ' ', 'g')
          = regexp_replace(trim(coalesce(row_value->>'notes', '')), '\s+', ' ', 'g')
        and (select exercise_id from public.workout_sets where session_id = session.id order by set_number, id limit 1)
          = (row_value->>'exerciseId')::bigint
        and (select jsonb_agg(jsonb_build_object('reps', reps, 'weight', round(weight, 4), 'isWarmup', is_warmup) order by set_number, id)
          from public.workout_sets where session_id = session.id) = normalized_sets
    ) then continue; end if;

    imported_session := public.save_workout_session((row_value->>'exerciseId')::bigint, (row_value->>'workoutDate')::date,
      row_value->>'notes', null, row_value->'sets', null, null, row_value->>'inputUnit', 'import');
    receipts := receipts || jsonb_build_array(fingerprint_value);
  end loop;
  if jsonb_array_length(p_workouts) > 0 then
    insert into public.app_settings (user_id, key, value, updated_at)
    values (importing_user, 'imported_workout_fingerprints', receipts::text, now())
    on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
end;
$$;

revoke all on function public.save_workout_session(bigint, date, text, text, jsonb, bigint, uuid, text, text) from public, anon;
grant execute on function public.save_workout_session(bigint, date, text, text, jsonb, bigint, uuid, text, text) to authenticated;
revoke all on function public.import_training_data(jsonb, jsonb, jsonb, bigint[]) from public, anon;
grant execute on function public.import_training_data(jsonb, jsonb, jsonb, bigint[]) to authenticated;
revoke all on function public.finalize_active_workout(text, jsonb, jsonb) from public, anon;
grant execute on function public.finalize_active_workout(text, jsonb, jsonb) to authenticated;

commit;
