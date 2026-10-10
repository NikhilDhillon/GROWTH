\set ON_ERROR_STOP on
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000069');
insert into public.profiles(id,name,email) values
  ('00000000-0000-0000-0000-000000000069','Legacy','legacy@example.test');
insert into public.shared_training_splits(user_id,split_days,updated_by,updated_by_name)
values('00000000-0000-0000-0000-000000000069','[{"key":"mon","label":"Monday","muscles":["Retired Muscle"]}]'::jsonb,
  '00000000-0000-0000-0000-000000000069','Legacy');
