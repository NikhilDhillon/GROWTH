begin;

-- Training split payloads are a server contract, not arbitrary JSON. Preserve
-- legacy rows as stored evidence, but reject malformed values on every new
-- write and before any request or recipient copy is committed.
create or replace function public.is_valid_training_split_days(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  day_value jsonb;
  day_key text;
  day_label text;
  expected_label text;
  seen_keys text[] := array[]::text[];
  valid_muscles text[] := array['Chest','Triceps','Back','Biceps','Legs','Shoulders','Traps','Forearms','Abs'];
begin
  if candidate is null or jsonb_typeof(candidate) <> 'array' or jsonb_array_length(candidate) <> 7 then
    return false;
  end if;

  for day_value in select value from jsonb_array_elements(candidate) loop
    if jsonb_typeof(day_value) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(day_value)) <> 3
      or jsonb_typeof(day_value->'key') is distinct from 'string'
      or jsonb_typeof(day_value->'label') is distinct from 'string'
      or jsonb_typeof(day_value->'muscles') is distinct from 'array' then
      return false;
    end if;

    day_key := day_value->>'key';
    day_label := day_value->>'label';
    expected_label := case day_key
      when 'mon' then 'Mon' when 'tue' then 'Tue' when 'wed' then 'Wed'
      when 'thu' then 'Thu' when 'fri' then 'Fri' when 'sat' then 'Sat' when 'sun' then 'Sun'
      else null end;
    if expected_label is null or day_label <> expected_label or day_key = any(seen_keys) then
      return false;
    end if;
    seen_keys := array_append(seen_keys, day_key);

    if exists (
      select 1 from jsonb_array_elements(day_value->'muscles') muscle(value)
      where jsonb_typeof(muscle.value) <> 'string' or not ((muscle.value #>> '{}') = any(valid_muscles))
    ) then return false; end if;
    if (select count(*) from jsonb_array_elements(day_value->'muscles'))
       <> (select count(distinct value #>> '{}') from jsonb_array_elements(day_value->'muscles')) then
      return false;
    end if;
  end loop;

  return cardinality(seen_keys) = 7;
end;
$$;

create or replace function public.reject_invalid_shared_training_split()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_training_split_days(new.split_days) then
    raise exception 'Training split must contain all seven weekday keys with matching labels and valid unique muscle names.';
  end if;
  return new;
end;
$$;
revoke all on function public.is_valid_training_split_days(jsonb) from public, anon, authenticated;
revoke all on function public.reject_invalid_shared_training_split() from public, anon, authenticated;
drop trigger if exists validate_shared_training_split on public.shared_training_splits;
create trigger validate_shared_training_split
  before insert or update of split_days on public.shared_training_splits
  for each row execute function public.reject_invalid_shared_training_split();

create or replace function public.is_portable_performance_exercise(exercise_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exercise_name = any(array[
    'Barbell Bench Press','Incline Barbell Bench Press','Dumbbell Bench Press','Incline Dumbbell Press','Pin Press',
    'Conventional Deadlift','Barbell Row','Dumbbell Row','Incline Lying Dumbbell Row',
    'Overhead Press','Seated Dumbbell Shoulder Press','Arnold Press','Lateral Raise',
    'Barbell Shrug','Dumbbell Shrug','Barbell Curl','Dumbbell Curl','Incline Dumbbell Curl','Hammer Curl',
    'Barbell Preacher Curl','Dumbbell Preacher Curl','Close-Grip Bench Press','Skull Crusher',
    'Overhead Triceps Extension','Tricep Pin Press','Back Squat','Front Squat','Romanian Deadlift',
    'Hip Thrust','Bulgarian Split Squat','Walking Lunge','Weighted Plank','Hanging Leg Raise',
    'Ab Wheel Rollout','Decline Sit-Up','Wrist Curl','Reverse Wrist Curl'
  ])
$$;
revoke all on function public.is_portable_performance_exercise(text) from public, anon, authenticated;

-- Friend access to profile names is mediated by social_profiles(); a row-level
-- owner policy keeps profile email and other private columns owner-only.
drop policy if exists "profiles are visible to accepted friends" on public.profiles;
drop policy if exists "profiles are visible to their owner" on public.profiles;
create policy "profiles are visible to their owner" on public.profiles
  for select using (auth.uid() = id);

-- Raw workout rows contain notes and private machine context. Friends obtain a
-- deliberately narrow projection from social_performance_records().
drop policy if exists "workout sessions are visible to accepted friends" on public.workout_sessions;
drop policy if exists "workout sets are visible to accepted friends" on public.workout_sets;
drop policy if exists "score snapshots are visible to friends" on public.leaderboard_score_snapshots;

create or replace function public.social_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  result jsonb;
begin
  if viewer is null then raise exception 'Please log in again.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', profile.id, 'name', coalesce(nullif(trim(profile.name), ''), 'Friend'), 'created_at', profile.created_at
  ) order by profile.id), '[]'::jsonb)
  into result
  from public.profiles profile
  where profile.id = viewer or exists (
    select 1 from public.friendships friendship
    where friendship.status in ('accepted', 'pending')
      and viewer in (friendship.requester_id, friendship.addressee_id)
      and profile.id in (friendship.requester_id, friendship.addressee_id)
  );
  return result;
end;
$$;

-- The returned list is self plus direct, mutually accepted split-sync peers.
-- A pair row is a single bilateral consent edge; there is no graph traversal.
create or replace function public.get_split_sync_members()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  result jsonb;
begin
  if viewer is null then raise exception 'Please log in again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:relationships', 0));
  select coalesce(jsonb_agg(jsonb_build_object('user_id', members.user_id) order by members.user_id), '[]'::jsonb)
  into result
  from (
    select viewer as user_id
    union
    select case when request.requester_id = viewer then request.addressee_id else request.requester_id end
    from public.split_sync_requests request
    join public.friendships friendship on friendship.user_low = request.user_low and friendship.user_high = request.user_high
      and friendship.status = 'accepted'
    where request.status = 'accepted' and viewer in (request.requester_id, request.addressee_id)
  ) members;
  return result;
end;
$$;

-- Leaderboard ingestion receives only owner plus accepted direct friends and
-- only canonical external-load catalog exercises. Notes, machine tags, body
-- observations, warmup metadata, and profile data are separate/private.
create or replace function public.social_performance_records()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  result jsonb;
begin
  if viewer is null then raise exception 'Please log in again.'; end if;
  with visible_users as (
    select viewer as user_id
    union
    select case when friendship.requester_id = viewer then friendship.addressee_id else friendship.requester_id end
    from public.friendships friendship
    where friendship.status = 'accepted' and viewer in (friendship.requester_id, friendship.addressee_id)
  ), eligible_sessions as (
    select session.id, session.user_id, session.workout_date
    from public.workout_sessions session
    join visible_users allowed on allowed.user_id = session.user_id
    where exists (
      select 1 from public.workout_sets candidate
      join public.exercises exercise on exercise.id = candidate.exercise_id
      where candidate.session_id = session.id and candidate.user_id = session.user_id
        and public.is_portable_performance_exercise(exercise.name)
    )
      and (select count(distinct candidate.exercise_id) from public.workout_sets candidate where candidate.session_id = session.id) = 1
      and not exists (
        select 1 from public.workout_sets candidate
        where candidate.session_id = session.id and candidate.user_id <> session.user_id
      )
      and not exists (
        select 1 from public.workout_sets candidate
        join public.exercises exercise on exercise.id = candidate.exercise_id
        where candidate.session_id = session.id and not public.is_portable_performance_exercise(exercise.name)
      )
  )
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', session.id, 'user_id', session.user_id, 'workout_date', session.workout_date)
        order by session.workout_date, session.user_id, session.id)
      from eligible_sessions session
    ), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', record.id, 'user_id', record.user_id, 'session_id', record.session_id,
        'exercise_id', record.exercise_id, 'set_number', record.set_number, 'reps', record.reps,
        'weight', record.weight, 'is_warmup', record.is_warmup
      ) order by record.user_id, record.session_id, record.set_number, record.id)
      from public.workout_sets record
      join eligible_sessions session on session.id = record.session_id and session.user_id = record.user_id
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.request_split_sync(friend_id uuid, split_days jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  editing_user uuid := auth.uid();
  editor_name text;
begin
  if editing_user is null then raise exception 'Please log in again.'; end if;
  if not public.is_valid_training_split_days(split_days) then
    raise exception 'Training split must contain all seven weekday keys with matching labels and valid unique muscle names.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:relationships', 0));
  if not exists (
    select 1 from public.friendships where status = 'accepted'
      and user_low = least(editing_user, friend_id) and user_high = greatest(editing_user, friend_id)
  ) then raise exception 'Split synchronization can only be requested from an accepted friend.'; end if;

  select coalesce(nullif(trim(name), ''), 'User') into editor_name
  from public.profiles where id = editing_user;
  insert into public.shared_training_splits (user_id, split_days, updated_by, updated_by_name, updated_at)
  values (editing_user, split_days, editing_user, coalesce(editor_name, 'User'), now())
  on conflict (user_id) do update set split_days = excluded.split_days, updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at;

  insert into public.split_sync_requests (requester_id, addressee_id, status, updated_at)
  values (editing_user, friend_id, 'pending', now())
  on conflict (user_low, user_high) do update set
    requester_id = excluded.requester_id, addressee_id = excluded.addressee_id,
    status = 'pending', updated_at = excluded.updated_at;
end;
$$;

create or replace function public.respond_split_sync(request_id uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  receiving_user uuid := auth.uid();
  request_row public.split_sync_requests%rowtype;
  requester_split jsonb;
begin
  if receiving_user is null then raise exception 'Please log in again.'; end if;
  if accept_request is null then raise exception 'A response is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:relationships', 0));
  select * into request_row from public.split_sync_requests
  where id = request_id and addressee_id = receiving_user and status = 'pending' for update;
  if request_row.id is null then raise exception 'This split synchronization request is not available.'; end if;
  if not exists (
    select 1 from public.friendships where status = 'accepted'
      and user_low = request_row.user_low and user_high = request_row.user_high
  ) then raise exception 'Split synchronization requires an accepted friendship.'; end if;

  if accept_request then
    select split_days into requester_split from public.shared_training_splits where user_id = request_row.requester_id;
    if not public.is_valid_training_split_days(requester_split) then
      raise exception 'The requested training split is invalid or unavailable. Ask the sender to save it again.';
    end if;
  end if;

  update public.split_sync_requests set status = case when accept_request then 'accepted' else 'declined' end,
    updated_at = now() where id = request_id;
  if accept_request then
    insert into public.shared_training_splits (user_id, split_days, updated_by, updated_by_name, updated_at)
    select receiving_user, split_days, updated_by, updated_by_name, updated_at
    from public.shared_training_splits where user_id = request_row.requester_id
    on conflict (user_id) do update set split_days = excluded.split_days, updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at;
  end if;
end;
$$;

create or replace function public.remove_split_sync(friend_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removing_user uuid := auth.uid();
begin
  if removing_user is null then raise exception 'Please log in again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:relationships', 0));
  if exists (
    select 1 from public.friendships where status = 'accepted'
      and user_low = least(removing_user, friend_id) and user_high = greatest(removing_user, friend_id)
  ) then
    insert into public.split_sync_requests (requester_id, addressee_id, status, updated_at)
    values (removing_user, friend_id, 'declined', now())
    on conflict (user_low, user_high) do update set status = 'declined', updated_at = excluded.updated_at;
  else
    update public.split_sync_requests set status = 'declined', updated_at = now()
    where user_low = least(removing_user, friend_id) and user_high = greatest(removing_user, friend_id);
  end if;
end;
$$;

create or replace function public.save_shared_training_split(split_days jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  editing_user uuid := auth.uid();
  editor_name text;
begin
  if editing_user is null then raise exception 'Please log in again.'; end if;
  if not public.is_valid_training_split_days(split_days) then
    raise exception 'Training split must contain all seven weekday keys with matching labels and valid unique muscle names.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:relationships', 0));
  select coalesce(nullif(trim(name), ''), 'User') into editor_name
  from public.profiles where id = editing_user;

  insert into public.shared_training_splits (user_id, split_days, updated_by, updated_by_name, updated_at)
  select recipient.user_id, split_days, editing_user, coalesce(editor_name, 'User'), now()
  from (
    select editing_user as user_id
    union
    select case when request.requester_id = editing_user then request.addressee_id else request.requester_id end
    from public.split_sync_requests request
    join public.friendships friendship on friendship.user_low = request.user_low and friendship.user_high = request.user_high
      and friendship.status = 'accepted'
    where request.status = 'accepted' and editing_user in (request.requester_id, request.addressee_id)
  ) recipient
  on conflict (user_id) do update set split_days = excluded.split_days, updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.social_profiles() from public, anon;
revoke all on function public.get_split_sync_members() from public, anon;
revoke all on function public.social_performance_records() from public, anon;
revoke all on function public.is_portable_performance_exercise(text) from public, anon, authenticated;
revoke all on function public.request_split_sync(uuid, jsonb) from public, anon;
revoke all on function public.respond_split_sync(uuid, boolean) from public, anon;
revoke all on function public.remove_split_sync(uuid) from public, anon;
revoke all on function public.save_shared_training_split(jsonb) from public, anon;
grant execute on function public.social_profiles() to authenticated;
grant execute on function public.get_split_sync_members() to authenticated;
grant execute on function public.social_performance_records() to authenticated;
grant execute on function public.request_split_sync(uuid, jsonb) to authenticated;
grant execute on function public.respond_split_sync(uuid, boolean) to authenticated;
grant execute on function public.remove_split_sync(uuid) to authenticated;
grant execute on function public.save_shared_training_split(jsonb) to authenticated;

commit;
