begin;

-- Import fix: an external source workout carries one entry per exercise. Earlier,
-- the first saved entry's receipt retired the whole source mid-batch, so every
-- other exercise in that workout was skipped as a duplicate. A source is now
-- retired only by receipts from earlier imports; exact duplicates still skip.
-- Re-creating the function is safe whether or not the Phase 6 migration has
-- already been applied, and changes no stored rows.
create or replace function public.import_training_data_v6(
  p_expected_user uuid,
  p_body_weights jsonb,
  p_body_measurements jsonb,
  p_workouts jsonb,
  p_exercise_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  receipts jsonb := '[]'::jsonb;
  prior_receipts jsonb;
  receipt_text text;
  row_value jsonb;
  body_row record;
  day_value text;
  day_date date;
  weight_value numeric;
  measurements_value jsonb;
  notes_value text;
  weight_unit text;
  circumference_unit text;
  measurement record;
  side record;
  measured_value numeric;
  exercise_id_value bigint;
  fingerprint_value text;
  normalized_sets jsonb;
  imported_session bigint;
  inserted_body integer := 0;
  skipped_body integer := 0;
  inserted_workouts integer := 0;
  inserted_sets integer := 0;
  skipped_workouts integer := 0;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  if p_expected_user is null or p_expected_user <> owner_id then
    raise exception 'The signed-in account changed. Return to the account that started this import.';
  end if;
  if p_body_weights is null or jsonb_typeof(p_body_weights) <> 'array'
    or p_body_measurements is null or jsonb_typeof(p_body_measurements) <> 'array'
    or p_workouts is null or jsonb_typeof(p_workouts) <> 'array' then
    raise exception 'Import records must be arrays.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_body_weights) entry where jsonb_typeof(entry) <> 'object'
    or jsonb_typeof(entry->'loggedDate') <> 'string')
    or exists (select 1 from jsonb_array_elements(p_body_measurements) entry where jsonb_typeof(entry) <> 'object'
    or jsonb_typeof(entry->'loggedDate') <> 'string') then
    raise exception 'Imported body rows require object values and calendar dates.';
  end if;
  if exists (select entry->>'loggedDate' from jsonb_array_elements(p_body_weights) entry group by entry->>'loggedDate' having count(*) > 1)
    or exists (select entry->>'loggedDate' from jsonb_array_elements(p_body_measurements) entry group by entry->>'loggedDate' having count(*) > 1) then
    raise exception 'Duplicate imported body dates must be resolved before saving.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('growth:workouts:' || owner_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('growth:body:' || owner_id::text, 0));

  select value into receipt_text from public.app_settings
  where user_id = owner_id and key = 'imported_workout_fingerprints' for update;
  if receipt_text is not null then
    begin receipts := receipt_text::jsonb;
    exception when others then raise exception 'Imported workout receipts are invalid. No data was changed.'; end;
    if jsonb_typeof(receipts) <> 'array' or exists (
      select 1 from jsonb_array_elements(receipts) receipt where jsonb_typeof(receipt) <> 'string'
    ) then raise exception 'Imported workout receipts are invalid. No data was changed.'; end if;
  end if;
  -- Only receipts committed by earlier imports retire an external source. One
  -- source workout has one entry per exercise, and all of them belong to this batch.
  prior_receipts := receipts;

  -- Combine weight and tape rows by calendar date so one file can create one
  -- whole body observation per day. Any occupied date is preserved intact.
  for body_row in
    select dates.day,
      (select value from jsonb_array_elements(p_body_weights) value where value->>'loggedDate' = dates.day limit 1) as body_weight,
      (select value from jsonb_array_elements(p_body_measurements) value where value->>'loggedDate' = dates.day limit 1) as body_measurement
    from (
      select value->>'loggedDate' as day from jsonb_array_elements(p_body_weights)
      union
      select value->>'loggedDate' as day from jsonb_array_elements(p_body_measurements)
    ) dates
    order by dates.day
  loop
    day_value := coalesce(body_row.body_measurement->>'loggedDate', body_row.body_weight->>'loggedDate');
    if day_value is null or day_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Imported body date must use YYYY-MM-DD.'; end if;
    day_date := day_value::date;
    if extract(year from day_date) not between 1 and 9999 then raise exception 'Imported body date is invalid.'; end if;

    if body_row.body_measurement is not null and body_row.body_weight is not null
      and body_row.body_measurement->'weight' is not null and body_row.body_measurement->'weight' <> 'null'::jsonb
      and (body_row.body_measurement->>'weight')::numeric is distinct from (body_row.body_weight->>'weight')::numeric then
      raise exception 'Conflicting imported bodyweights use the same date.';
    end if;

    weight_value := null;
    weight_unit := null;
    if body_row.body_measurement is not null and body_row.body_measurement->'weight' is not null
      and body_row.body_measurement->'weight' <> 'null'::jsonb then
      if jsonb_typeof(body_row.body_measurement->'weight') <> 'number' then raise exception 'Invalid imported bodyweight.'; end if;
      weight_value := (body_row.body_measurement->>'weight')::numeric;
      weight_unit := body_row.body_measurement->>'weightInputUnit';
    elsif body_row.body_weight is not null then
      if jsonb_typeof(body_row.body_weight->'weight') <> 'number' then raise exception 'Invalid imported bodyweight.'; end if;
      weight_value := (body_row.body_weight->>'weight')::numeric;
      weight_unit := body_row.body_weight->>'weightInputUnit';
    end if;
    if weight_value is not null and (weight_value <= 0 or weight_value::double precision <= 0) then raise exception 'Invalid imported bodyweight.'; end if;
    if weight_unit is not null and weight_unit not in ('lb','kg') then raise exception 'Invalid imported bodyweight unit.'; end if;

    measurements_value := coalesce(body_row.body_measurement->'measurements', '{}'::jsonb);
    if jsonb_typeof(measurements_value) is distinct from 'object' then raise exception 'Invalid imported body measurements.'; end if;
    circumference_unit := case when measurements_value = '{}'::jsonb then null else body_row.body_measurement->>'circumferenceInputUnit' end;
    if circumference_unit is not null and circumference_unit not in ('in','cm') then raise exception 'Invalid imported circumference unit.'; end if;
    for measurement in select key, value from jsonb_each(measurements_value) loop
      if measurement.key in ('chest','abdomen','thinnest_waist','waist') then
        if jsonb_typeof(measurement.value) <> 'number' then raise exception 'Invalid imported body measurement.'; end if;
        measured_value := (measurement.value#>>'{}')::numeric;
        if measured_value <= 0 or measured_value::double precision <= 0 then raise exception 'Invalid imported body measurement.'; end if;
      elsif measurement.key in ('arm_unflexed','arm_flexed','calves','forearm','thigh') then
        if jsonb_typeof(measurement.value) <> 'object' then raise exception 'Invalid imported sided body measurement.'; end if;
        if measurement.value->>'mode' = 'single' then
          if jsonb_typeof(measurement.value->'value') is distinct from 'number'
            or (measurement.value->>'value')::numeric <= 0
            or exists(select 1 from jsonb_object_keys(measurement.value) key where key not in ('mode','value')) then
            raise exception 'Invalid imported body measurement.';
          end if;
        elsif measurement.value->>'mode' = 'sides' then
          if not (measurement.value ? 'left' or measurement.value ? 'right') then raise exception 'Imported side measurement is empty.'; end if;
          for side in select key, value from jsonb_each(measurement.value) where key <> 'mode' loop
            if side.key not in ('left','right') or jsonb_typeof(side.value) <> 'number'
              or (side.value#>>'{}')::numeric <= 0 then raise exception 'Invalid imported side measurement.'; end if;
          end loop;
        else raise exception 'Invalid imported body measurement mode.'; end if;
      else raise exception 'Unknown imported body measurement field.'; end if;
    end loop;
    if weight_value is null and measurements_value = '{}'::jsonb then raise exception 'Imported body check-in is empty.'; end if;

    notes_value := nullif(btrim(body_row.body_measurement->>'notes'), '');
    if body_row.body_measurement ? 'notes' and jsonb_typeof(body_row.body_measurement->'notes') not in ('null','string') then
      raise exception 'Invalid imported body check-in notes.';
    end if;
    insert into public.body_measurement_logs (
      user_id, logged_date, weight, measurements, notes, weight_input_unit, circumference_input_unit, created_at, updated_at
    ) values (
      owner_id, day_date, weight_value, measurements_value, notes_value, weight_unit, circumference_unit,
      (day_date::text || 'T12:00:00Z')::timestamptz, clock_timestamp()
    ) on conflict (user_id, logged_date) do nothing returning id into imported_session;
    if imported_session is null then skipped_body := skipped_body + 1;
    else inserted_body := inserted_body + 1; end if;
    imported_session := null;
  end loop;

  foreach exercise_id_value in array coalesce(p_exercise_ids, '{}'::bigint[]) loop
    insert into public.user_exercise_preferences (user_id, exercise_id, enabled, updated_at)
    values (owner_id, exercise_id_value, 1, clock_timestamp())
    on conflict (user_id, exercise_id) do update set enabled = 1, updated_at = excluded.updated_at;
  end loop;

  for row_value in select value from jsonb_array_elements(p_workouts) loop
    if row_value->>'workoutDate' is null or row_value->>'workoutDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Imported workout date must use YYYY-MM-DD.';
    end if;
    if extract(year from (row_value->>'workoutDate')::date) not between 1 and 9999 then raise exception 'Imported workout date is invalid.'; end if;
    fingerprint_value := row_value->>'fingerprint';
    if nullif(fingerprint_value, '') is null then raise exception 'An imported workout fingerprint is required.'; end if;
    if fingerprint_value like 'external:%' and (position('::' in fingerprint_value) = 0
      or split_part(fingerprint_value, '::', 2) !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Imported external IDs must not contain the reserved "::" delimiter.';
    end if;
    -- External IDs identify a source record even when its facts change. Keep
    -- all old receipt strings intact and compare their stable first segment
    -- against earlier imports; within this batch only exact duplicates skip.
    if receipts ? fingerprint_value or exists (
      select 1 from jsonb_array_elements_text(prior_receipts) prior(value)
      where fingerprint_value like 'external:%'
        and split_part(prior.value, '::', 1) = split_part(fingerprint_value, '::', 1)
    ) then skipped_workouts := skipped_workouts + 1; continue; end if;
    if row_value->'sets' is null or jsonb_typeof(row_value->'sets') <> 'array' or jsonb_array_length(row_value->'sets') = 0 then
      raise exception 'Imported sets must include at least one observed set.';
    end if;
    select jsonb_agg(jsonb_build_object(
      'reps', (value->>'reps')::numeric::integer,
      'weight', round((value->>'weight')::numeric, 4),
      'rir', case when value ? 'rir' and value->'rir' <> 'null'::jsonb then (value->>'rir')::numeric else null end,
      'isWarmup', coalesce((value->>'isWarmup')::boolean, false)
    ) order by ordinal) into normalized_sets
    from jsonb_array_elements(row_value->'sets') with ordinality as input(value, ordinal);
    if exists (select 1 from jsonb_array_elements(row_value->'sets') set_value where set_value ? 'rir'
      and set_value->'rir' <> 'null'::jsonb and (jsonb_typeof(set_value->'rir') <> 'number'
      or (set_value->>'rir')::numeric < 0 or (set_value->>'rir')::numeric > 10)) then
      raise exception 'Imported RIR must be a number from 0 to 10.';
    end if;
    if fingerprint_value like 'content::%' and exists (
      select 1 from public.workout_sessions session
      where session.user_id = owner_id and session.workout_date = (row_value->>'workoutDate')::date
        and regexp_replace(trim(coalesce(session.notes, '')), '\s+', ' ', 'g')
          = regexp_replace(trim(coalesce(row_value->>'notes', '')), '\s+', ' ', 'g')
        and (select exercise_id from public.workout_sets where session_id = session.id order by set_number, id limit 1)
          = (row_value->>'exerciseId')::bigint
        and (select jsonb_agg(jsonb_build_object('reps', reps, 'weight', round(weight, 4), 'rir', rir, 'isWarmup', is_warmup) order by set_number, id)
          from public.workout_sets where session_id = session.id) = normalized_sets
    ) then
      skipped_workouts := skipped_workouts + 1;
      continue;
    end if;
    imported_session := public.save_workout_session(
      (row_value->>'exerciseId')::bigint, (row_value->>'workoutDate')::date,
      row_value->>'notes', null, row_value->'sets', null, null,
      row_value->>'inputUnit', 'import'
    );
    -- The legacy save helper supplied zero when RIR was unknown. Replace that
    -- placeholder with the exact source value, including NULL for unknown.
    update public.workout_sets set rir = set_value.value
    from (
      select (value->>'rir')::numeric as value, ordinal::integer as set_number
      from jsonb_array_elements(row_value->'sets') with ordinality as input(value, ordinal)
    ) set_value
    where workout_sets.session_id = imported_session and workout_sets.set_number = set_value.set_number;
    update public.workout_sets set rir = null
    where session_id = imported_session and set_number > jsonb_array_length(row_value->'sets');
    receipts := receipts || jsonb_build_array(fingerprint_value);
    inserted_workouts := inserted_workouts + 1;
    inserted_sets := inserted_sets + jsonb_array_length(row_value->'sets');
  end loop;

  if jsonb_array_length(p_workouts) > 0 then
    insert into public.app_settings (user_id, key, value, updated_at)
    values (owner_id, 'imported_workout_fingerprints', receipts::text, clock_timestamp())
    on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object(
    'inserted', jsonb_build_object('bodyCheckIns', inserted_body, 'workouts', inserted_workouts, 'sets', inserted_sets),
    'skipped', jsonb_build_object('bodyCheckIns', skipped_body, 'workouts', skipped_workouts),
    'failed', 0
  );
end;
$$;

revoke all on function public.import_training_data_v6(uuid,jsonb,jsonb,jsonb,bigint[]) from public, anon;
grant execute on function public.import_training_data_v6(uuid,jsonb,jsonb,jsonb,bigint[]) to authenticated;

commit;
