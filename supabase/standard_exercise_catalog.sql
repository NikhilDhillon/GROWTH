drop policy if exists "exercises are owned by their user" on public.exercises;
drop policy if exists "standard exercises are readable by authenticated users" on public.exercises;

drop index if exists public.exercises_user_id_idx;

alter table public.exercises drop column if exists user_id;
alter table public.exercises alter column is_strength_exercise set default 0;

create table if not exists public.user_exercise_preferences (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id bigint not null references public.exercises(id) on delete cascade,
  enabled integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table public.exercises enable row level security;
alter table public.user_exercise_preferences enable row level security;
drop policy if exists "exercise preferences are owned by their user" on public.user_exercise_preferences;

truncate table
  public.user_exercise_preferences,
  public.muscle_strength_config,
  public.workout_sets,
  public.workout_sessions,
  public.exercises
restart identity cascade;

insert into public.exercises (name, primary_muscle, secondary_muscle, is_strength_exercise) values
  ('Barbell Bench Press', 'Chest', null, 0),
  ('Incline Barbell Bench Press', 'Chest', null, 0),
  ('Dumbbell Bench Press', 'Chest', null, 0),
  ('Incline Dumbbell Press', 'Chest', null, 0),
  ('Machine Chest Press', 'Chest', null, 0),
  ('Weighted Dip', 'Chest', 'Triceps', 0),
  ('Cable Fly', 'Chest', null, 0),
  ('High to Low Cable Fly', 'Chest', null, 0),
  ('Low to High Cable Fly', 'Chest', null, 0),
  ('Pin Press', 'Chest', 'Triceps', 0),
  ('Conventional Deadlift', 'Back', 'Legs', 0),
  ('Barbell Row', 'Back', null, 0),
  ('Dumbbell Row', 'Back', null, 0),
  ('Incline Lying Dumbbell Row', 'Back', null, 0),
  ('Pull-Up', 'Back', 'Biceps', 0),
  ('Chin-Up', 'Back', 'Biceps', 0),
  ('Lat Pulldown', 'Back', null, 0),
  ('Seated Cable Row', 'Back', null, 0),
  ('Overhead Press', 'Shoulders', null, 0),
  ('Seated Dumbbell Shoulder Press', 'Shoulders', null, 0),
  ('Arnold Press', 'Shoulders', null, 0),
  ('Lateral Raise', 'Shoulders', null, 0),
  ('Cable Lateral Raise', 'Shoulders', null, 0),
  ('Rear Delt Fly', 'Shoulders', null, 0),
  ('Cable Rear Delt Fly', 'Shoulders', null, 0),
  ('Face Pull', 'Shoulders', 'Back', 0),
  ('Barbell Shrug', 'Traps', null, 0),
  ('Dumbbell Shrug', 'Traps', null, 0),
  ('Cable Shrug', 'Traps', null, 0),
  ('Barbell Curl', 'Biceps', null, 0),
  ('Dumbbell Curl', 'Biceps', null, 0),
  ('Incline Dumbbell Curl', 'Biceps', null, 0),
  ('Hammer Curl', 'Biceps', null, 0),
  ('Barbell Preacher Curl', 'Biceps', null, 0),
  ('Dumbbell Preacher Curl', 'Biceps', null, 0),
  ('Cable Curl', 'Biceps', null, 0),
  ('Close-Grip Bench Press', 'Triceps', 'Chest', 0),
  ('Skull Crusher', 'Triceps', null, 0),
  ('Cable Triceps Pushdown', 'Triceps', null, 0),
  ('Bar Triceps Pushdown', 'Triceps', null, 0),
  ('Overhead Triceps Extension', 'Triceps', null, 0),
  ('Assisted Dip', 'Triceps', 'Chest', 0),
  ('Tricep Pin Press', 'Triceps', 'Chest', 0),
  ('Back Squat', 'Legs', null, 0),
  ('Front Squat', 'Legs', null, 0),
  ('Leg Press', 'Legs', null, 0),
  ('Romanian Deadlift', 'Legs', 'Back', 0),
  ('Hip Thrust', 'Legs', null, 0),
  ('Bulgarian Split Squat', 'Legs', null, 0),
  ('Walking Lunge', 'Legs', null, 0),
  ('Leg Extension', 'Legs', null, 0),
  ('Leg Curl', 'Legs', null, 0),
  ('Standing Calf Raise', 'Legs', null, 0),
  ('Seated Calf Raise', 'Legs', null, 0),
  ('Weighted Plank', 'Core', null, 0),
  ('Cable Crunch', 'Core', null, 0),
  ('Hanging Leg Raise', 'Core', null, 0),
  ('Ab Wheel Rollout', 'Core', null, 0),
  ('Decline Sit-Up', 'Core', null, 0),
  ('Pallof Press', 'Core', null, 0);

create unique index if not exists exercises_name_idx on public.exercises(name);
create index if not exists user_exercise_preferences_user_id_idx on public.user_exercise_preferences(user_id);
create index if not exists user_exercise_preferences_exercise_id_idx on public.user_exercise_preferences(exercise_id);

create policy "standard exercises are readable by authenticated users" on public.exercises
  for select using (auth.role() = 'authenticated');

create policy "exercise preferences are owned by their user" on public.user_exercise_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.exercises to authenticated;
grant select, insert, update, delete on public.user_exercise_preferences to authenticated;
