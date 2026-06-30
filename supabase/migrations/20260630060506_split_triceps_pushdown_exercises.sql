update public.exercises
set name = 'Cable Triceps Pushdown',
    primary_muscle = 'Triceps',
    secondary_muscle = null
where name = 'Cable Pushdown';

insert into public.exercises (name, primary_muscle, secondary_muscle, is_strength_exercise)
select 'Bar Triceps Pushdown', 'Triceps', null, 0
where not exists (
  select 1 from public.exercises where name = 'Bar Triceps Pushdown'
);
