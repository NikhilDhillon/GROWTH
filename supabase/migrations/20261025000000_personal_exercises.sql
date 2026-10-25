-- Personal exercises: movements missing from the shared catalog.
-- A personal exercise belongs to its creator, carries its own load type, and is
-- readable by mutually accepted split-sync friends. Logging a friend's exercise
-- records access so history keeps its name after sharing ends. Its row keeps a
-- hidden unique key in name ('personal:<id>') and shows display_name, so catalog
-- names, their unique index and leaderboards are unchanged.
-- Safe to rerun.
begin;

alter table public.exercises add column if not exists creator_id uuid references auth.users(id) on delete cascade;
alter table public.exercises add column if not exists load_type text;
alter table public.exercises add column if not exists display_name text;

-- Personal display names are unique per owner and may repeat across accounts.
create unique index if not exists exercises_owner_display_name_idx on public.exercises(creator_id, lower(display_name)) where creator_id is not null;

-- Personal exercises are readable by their owner and by mutually accepted split-sync
-- friends. Logging a friend's exercise records access, so history keeps its name
-- after sharing ends. Clients never read or write the access table directly.
create table if not exists public.custom_exercise_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id bigint not null references public.exercises(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
create index if not exists custom_exercise_access_exercise_id_idx on public.custom_exercise_access(exercise_id);
alter table public.custom_exercise_access enable row level security;
revoke all on public.custom_exercise_access from public, anon, authenticated;

create or replace function public.shares_workouts(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.split_sync_requests request
    join public.friendships friendship on friendship.user_low = request.user_low and friendship.user_high = request.user_high
      and friendship.status = 'accepted'
    where request.status = 'accepted'
      and request.user_low = least(first_user, second_user) and request.user_high = greatest(first_user, second_user)
  );
$$;
revoke all on function public.shares_workouts(uuid, uuid) from public, anon, authenticated;

-- Answers only for the caller, so it reveals nothing the read policy does not.
create or replace function public.can_read_custom_exercise(p_owner uuid, p_exercise bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_owner = auth.uid()
    or exists (select 1 from public.custom_exercise_access access where access.user_id = auth.uid() and access.exercise_id = p_exercise)
    or public.shares_workouts(auth.uid(), p_owner)
  );
$$;
revoke all on function public.can_read_custom_exercise(uuid, bigint) from public, anon;
grant execute on function public.can_read_custom_exercise(uuid, bigint) to authenticated;

drop policy if exists "standard exercises are readable by authenticated users" on public.exercises;
-- The historical policy name is kept; it now also admits own and shared personal exercises.
create policy "standard exercises are readable by authenticated users" on public.exercises
  for select using (auth.role() = 'authenticated' and (creator_id is null or public.can_read_custom_exercise(creator_id, id)));

-- Leaderboards: a personal exercise never ranks.
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
        and exercise.creator_id is null and public.is_portable_performance_exercise(exercise.name)
    )
      and (select count(distinct candidate.exercise_id) from public.workout_sets candidate where candidate.session_id = session.id) = 1
      and not exists (
        select 1 from public.workout_sets candidate
        where candidate.session_id = session.id and candidate.user_id <> session.user_id
      )
      and not exists (
        select 1 from public.workout_sets candidate
        join public.exercises exercise on exercise.id = candidate.exercise_id
        where candidate.session_id = session.id and (exercise.creator_id is not null or not public.is_portable_performance_exercise(exercise.name))
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

-- Columns, the access table and the read policy are defined with the exercise
-- catalog above. A personal exercise has a creator and its own load type, and its
-- name never repeats a catalog name, so leaderboards stay catalog-only.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercises_load_type_check' and conrelid = 'public.exercises'::regclass) then
    alter table public.exercises add constraint exercises_load_type_check
      check (load_type in ('external', 'machine_stack', 'bodyweight_plus_load', 'bodyweight_minus_assistance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exercises_personal_shape_check' and conrelid = 'public.exercises'::regclass) then
    alter table public.exercises add constraint exercises_personal_shape_check
      check ((creator_id is null and display_name is null)
        or (creator_id is not null and load_type is not null and char_length(display_name) between 2 and 60 and name = 'personal:' || id));
  end if;
end;
$$;

-- Every row that names an exercise must name one its owner may use: the catalog,
-- their own, or one shared by a split-sync friend (which then stays theirs to read).
create or replace function public.reject_unavailable_exercise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  exercise_owner uuid;
begin
  select creator_id into exercise_owner from public.exercises where id = new.exercise_id;
  -- Catalog movements; a missing id is left to the foreign key.
  if exercise_owner is null or exercise_owner = new.user_id then return new; end if;
  if exists (select 1 from public.custom_exercise_access where user_id = new.user_id and exercise_id = new.exercise_id) then return new; end if;
  if public.shares_workouts(new.user_id, exercise_owner) then
    insert into public.custom_exercise_access (user_id, exercise_id) values (new.user_id, new.exercise_id) on conflict do nothing;
    return new;
  end if;
  raise exception 'That exercise is not shared with this account.';
end;
$$;
revoke all on function public.reject_unavailable_exercise() from public, anon, authenticated;

drop trigger if exists workout_sets_exercise_available on public.workout_sets;
create trigger workout_sets_exercise_available before insert or update of exercise_id, user_id on public.workout_sets
  for each row execute function public.reject_unavailable_exercise();
drop trigger if exists user_exercise_preferences_exercise_available on public.user_exercise_preferences;
create trigger user_exercise_preferences_exercise_available before insert or update of exercise_id, user_id on public.user_exercise_preferences
  for each row execute function public.reject_unavailable_exercise();
drop trigger if exists muscle_strength_config_exercise_available on public.muscle_strength_config;
create trigger muscle_strength_config_exercise_available before insert or update of exercise_id, user_id on public.muscle_strength_config
  for each row execute function public.reject_unavailable_exercise();
drop trigger if exists leaderboard_score_snapshots_exercise_available on public.leaderboard_score_snapshots;
create trigger leaderboard_score_snapshots_exercise_available before insert or update of exercise_id, user_id on public.leaderboard_score_snapshots
  for each row execute function public.reject_unavailable_exercise();

-- Creating is idempotent by name: a retry returns the exercise it already made.
create or replace function public.create_custom_exercise(p_name text, p_primary_muscle text, p_load_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator uuid := auth.uid();
  clean_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  catalog_name text;
  saved public.exercises%rowtype;
begin
  if creator is null then raise exception 'Please log in again.'; end if;
  if char_length(clean_name) not between 2 and 60 then raise exception 'Exercise names need 2 to 60 characters.'; end if;
  if p_primary_muscle is null or p_primary_muscle not in ('Chest', 'Back', 'Shoulders', 'Traps', 'Biceps', 'Triceps', 'Legs', 'Core', 'Forearms') then
    raise exception 'Choose the main muscle this exercise trains.';
  end if;
  if p_load_type is null or p_load_type not in ('external', 'machine_stack', 'bodyweight_plus_load', 'bodyweight_minus_assistance') then
    raise exception 'Choose how this exercise is loaded.';
  end if;
  select name into catalog_name from public.exercises where creator_id is null and lower(name) = lower(clean_name);
  if catalog_name is not null then raise exception '% is already in the exercise list.', catalog_name; end if;
  insert into public.exercises (id, name, display_name, primary_muscle, secondary_muscle, is_strength_exercise, creator_id, load_type)
  select reserved.id, 'personal:' || reserved.id, clean_name, p_primary_muscle, null, 0, creator, p_load_type
  from (select nextval(pg_get_serial_sequence('public.exercises', 'id')) id) reserved
  where (select count(*) from public.exercises where creator_id = creator) < 200
  on conflict (creator_id, (lower(display_name))) where creator_id is not null do nothing
  returning * into saved;
  if saved.id is null then
    select * into saved from public.exercises where creator_id = creator and lower(display_name) = lower(clean_name);
    if saved.id is null then raise exception 'You can keep up to 200 personal exercises.'; end if;
    if saved.primary_muscle <> p_primary_muscle or saved.load_type <> p_load_type then
      raise exception 'You already have an exercise named %.', saved.display_name;
    end if;
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.create_custom_exercise(text, text, text) from public, anon;
grant execute on function public.create_custom_exercise(text, text, text) to authenticated;

commit;
