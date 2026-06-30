alter table public.workout_sessions
  add column if not exists machine_profile_id text;

create index if not exists workout_sessions_user_machine_date_idx
  on public.workout_sessions(user_id, machine_profile_id, workout_date desc);
