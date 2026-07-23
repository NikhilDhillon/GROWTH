insert into public.exercises (name, primary_muscle, secondary_muscle, is_strength_exercise)
values ('Hack Squat', 'Legs', null, 0)
on conflict (name) do update set
  primary_muscle = excluded.primary_muscle,
  secondary_muscle = excluded.secondary_muscle;
