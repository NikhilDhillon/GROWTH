\set ON_ERROR_STOP on

-- The caller creates an unmistakably pre-modern database by dropping only the
-- temporary test table before applying the migration. No production data used.
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.body_weight_logs (user_id, weight, logged_date)
values ('00000000-0000-0000-0000-000000000001', 200, '2026-01-01');
drop table public.body_measurement_logs;
\ir ../migrations/20261004000000_phase1_record_safety.sql
do $$
begin
  if not exists (select 1 from public.body_measurement_logs where logged_date = '2026-01-01' and weight = 200) then
    raise exception 'An unmistakably pre-modern database must retain its legacy observation';
  end if;
  if not exists (select 1 from public.app_settings where key = 'body_measurements_legacy_migrated' and value = 'migrated_legacy') then
    raise exception 'A successful migration must have a durable completion marker';
  end if;
end;
$$;
delete from public.body_measurement_logs where logged_date = '2026-01-01';
\ir ../migrations/20261004000000_phase1_record_safety.sql
-- The checkpoint, not only table presence, retires repeated legacy copying.
drop table public.body_measurement_logs;
\ir ../migrations/20261004000000_phase1_record_safety.sql
\ir ../schema.sql
do $$
begin
  if exists (select 1 from public.body_measurement_logs where logged_date = '2026-01-01') then
    raise exception 'Migration/schema rerun must not resurrect a deliberately deleted observation';
  end if;
  if not exists (select 1 from public.body_weight_logs where logged_date = '2026-01-01' and weight = 200) then
    raise exception 'Compatibility retirement must preserve the legacy source for explicit reconciliation';
  end if;
end;
$$;

-- Existing modern stores have ambiguous absent dates. Neither migration nor
-- schema rerun is allowed to assume those dates were accidentally omitted.
insert into auth.users values ('00000000-0000-0000-0000-000000000002');
insert into public.body_weight_logs (user_id, weight, logged_date)
values ('00000000-0000-0000-0000-000000000002', 180, '2026-02-01');
insert into public.body_measurement_logs (user_id, weight, measurements, logged_date)
values ('00000000-0000-0000-0000-000000000002', 181, '{"waist":80}', '2026-02-02');
\ir ../migrations/20261004000000_phase1_record_safety.sql
\ir ../schema.sql
do $$
begin
  if exists (select 1 from public.body_measurement_logs where logged_date = '2026-02-01') then
    raise exception 'An existing modern store must not restore an ambiguous legacy-only date';
  end if;
  if not exists (select 1 from public.body_measurement_logs where logged_date = '2026-02-02' and weight = 181 and measurements = '{"waist":80}'::jsonb) then
    raise exception 'Existing modern weight and tape observations must be preserved';
  end if;
  if not exists (select 1 from public.app_settings where user_id = '00000000-0000-0000-0000-000000000002'
    and key = 'body_measurements_legacy_migrated' and value = 'existing_modern_legacy_preserved') then
    raise exception 'Modern authority with preserved legacy data needs an explicit checkpoint';
  end if;
end;
$$;
select 'Body migration/retirement assertions passed';
