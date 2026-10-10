begin;

-- Whole body check-ins are observations; receipts identify attempts and never
-- recreate a deleted record. Existing rows keep unknown input-unit provenance.
alter table public.body_measurement_logs
  add column if not exists weight_input_unit text,
  add column if not exists circumference_input_unit text;
alter table public.body_measurement_logs drop constraint if exists body_weight_input_unit_valid;
alter table public.body_measurement_logs add constraint body_weight_input_unit_valid check (weight_input_unit is null or weight_input_unit in ('lb','kg'));
alter table public.body_measurement_logs drop constraint if exists body_circumference_input_unit_valid;
alter table public.body_measurement_logs add constraint body_circumference_input_unit_valid check (circumference_input_unit is null or circumference_input_unit in ('cm','in'));

create table if not exists public.body_check_in_write_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  observation_id bigint references public.body_measurement_logs(id) on delete set null,
  recorded_id bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table public.body_check_in_write_requests enable row level security;
revoke all on public.body_check_in_write_requests from public, anon, authenticated;

create or replace function public.body_check_in_snapshot_matches(p_row public.body_measurement_logs,p_expected jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if p_expected is null or jsonb_typeof(p_expected)<>'object' then return false; end if;
  return (p_expected->>'id')::bigint=p_row.id
    and (p_expected->>'logged_date')::date=p_row.logged_date
    and (p_expected->>'weight')::numeric is not distinct from p_row.weight
    and p_expected->'measurements'=p_row.measurements
    and (p_expected->>'notes') is not distinct from p_row.notes
    and (p_expected->>'updated_at')::timestamptz=p_row.updated_at
    and (p_expected->>'weight_input_unit') is not distinct from p_row.weight_input_unit
    and (p_expected->>'circumference_input_unit') is not distinct from p_row.circumference_input_unit;
exception when others then return false;
end;
$$;
revoke all on function public.body_check_in_snapshot_matches(public.body_measurement_logs,jsonb) from public,anon,authenticated;

create or replace function public.record_body_check_in(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid:=auth.uid();
  attempt_id text;
  target_id bigint;
  target_date date;
  previous public.body_measurement_logs%rowtype;
  saved public.body_measurement_logs%rowtype;
  receipt public.body_check_in_write_requests%rowtype;
  measurement record;
  side record;
  measured_value numeric;
  weight_value numeric;
  canonical_payload jsonb;
  weight_unit text;
  tape_unit text;
  unchanged_tape boolean;
  changed_tape boolean;
  previous_contract text:=current_setting('growth.body_check_in_contract',true);
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Choose valid body check-in values.'; end if;
  if p_input->>'accountId' is not null and p_input->>'accountId'<>owner_id::text then raise exception 'The signed-in account changed. Return to the original account before saving this check-in.'; end if;
  attempt_id:=p_input->>'requestId';
  if attempt_id is null or attempt_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'A body check-in requires a stable retry identity.'; end if;
  if p_input->>'loggedDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a real calendar date.'; end if;
  target_date:=(p_input->>'loggedDate')::date;
  if target_date is null or extract(year from target_date) not between 1 and 9999 then raise exception 'Choose a real calendar date.'; end if;
  if p_input->'inputUnits'->>'weight' is null or p_input->'inputUnits'->>'weight' not in ('lb','kg')
    or p_input->'inputUnits'->>'circumference' is null or p_input->'inputUnits'->>'circumference' not in ('cm','in') then raise exception 'Record the body input units explicitly.'; end if;
  if not(p_input?'weight') or jsonb_typeof(p_input->'weight') not in ('null','number') then raise exception 'Choose valid bodyweight.'; end if;
  weight_value:=(p_input->>'weight')::numeric;
  if weight_value is not null and (weight_value<=0 or weight_value::double precision<=0) then raise exception 'Choose positive bodyweight.'; end if;
  if jsonb_typeof(p_input->'measurements') is distinct from 'object' then raise exception 'Choose valid body measurements.'; end if;
  for measurement in select key,value from jsonb_each(p_input->'measurements') loop
    if measurement.key in ('chest','abdomen','thinnest_waist','waist') then
      if jsonb_typeof(measurement.value)<>'number' then raise exception 'Choose positive body measurements.'; end if;
      measured_value:=(measurement.value#>>'{}')::numeric;
      if measured_value<=0 or measured_value::double precision<=0 then raise exception 'Choose positive body measurements.'; end if;
    elsif measurement.key in ('arm_unflexed','arm_flexed','calves','forearm','thigh') then
      if jsonb_typeof(measurement.value)<>'object' then raise exception 'Choose valid bilateral measurements.'; end if;
      if measurement.value->>'mode'='single' then
        if jsonb_typeof(measurement.value->'value') is distinct from 'number' or (measurement.value->>'value')::numeric<=0 or (measurement.value->>'value')::double precision<=0
          or exists(select 1 from jsonb_object_keys(measurement.value) k where k not in('mode','value')) then raise exception 'Choose positive body measurements.'; end if;
      elsif measurement.value->>'mode'='sides' then
        if not(measurement.value?'left' or measurement.value?'right') then raise exception 'Choose at least one side measurement.'; end if;
        for side in select key,value from jsonb_each(measurement.value) where key<>'mode' loop
          if side.key not in('left','right') or jsonb_typeof(side.value)<>'number' or (side.value#>>'{}')::numeric<=0 or (side.value#>>'{}')::double precision<=0 then raise exception 'Choose positive side measurements.'; end if;
        end loop;
      else raise exception 'Choose a body measurement mode.'; end if;
    else raise exception 'Unknown body measurement field.'; end if;
  end loop;
  if weight_value is null and p_input->'measurements'='{}'::jsonb then raise exception 'Record a bodyweight or body measurement.'; end if;
  if p_input?'notes' and jsonb_typeof(p_input->'notes') not in ('null','string') then raise exception 'Choose valid check-in notes.'; end if;
  target_id:=(p_input->>'id')::bigint;
  if target_id is not null and (target_id<=0 or jsonb_typeof(p_input->'expected') is distinct from 'object') then raise exception 'Reload this check-in before editing.'; end if;
  if target_id is null and p_input->'expected' is not null and p_input->'expected'<>'null'::jsonb then raise exception 'A new body check-in cannot replace an existing snapshot.'; end if;
  canonical_payload:=jsonb_build_object('accountId',p_input->'accountId','id',target_id,'expected',coalesce(p_input->'expected','null'::jsonb),'loggedDate',target_date::text,
    'weight',weight_value,'measurements',p_input->'measurements','notes',nullif(btrim(p_input->>'notes'),''),'inputUnits',p_input->'inputUnits');
  perform pg_advisory_xact_lock(hashtextextended('growth:body:'||owner_id::text,0));
  select * into receipt from public.body_check_in_write_requests where user_id=owner_id and body_check_in_write_requests.request_id=attempt_id;
  if found then
    if receipt.payload<>canonical_payload then raise exception 'This save attempt already has different values. Resolve the previous attempt before recording another.'; end if;
    select * into saved from public.body_measurement_logs where id=receipt.observation_id and user_id=owner_id;
    if not found then raise exception 'This body check-in was deleted. An old retry cannot recreate it.'; end if;
    return to_jsonb(saved);
  end if;
  if target_id is null then
    if exists(select 1 from public.body_measurement_logs where user_id=owner_id and logged_date=target_date) then raise exception 'A body check-in already exists for this date. Open that check-in to edit it.'; end if;
    perform set_config('growth.body_check_in_contract','phase5',true);
    insert into public.body_measurement_logs(user_id,logged_date,weight,measurements,notes,weight_input_unit,circumference_input_unit,updated_at)
      values(owner_id,target_date,weight_value,p_input->'measurements',nullif(btrim(p_input->>'notes'),''),case when weight_value is null then null else p_input->'inputUnits'->>'weight' end,case when p_input->'measurements'='{}'::jsonb then null else p_input->'inputUnits'->>'circumference' end,clock_timestamp()) returning * into saved;
  else
    select * into previous from public.body_measurement_logs where id=target_id and user_id=owner_id for update;
    if not found then raise exception 'This body check-in no longer exists. Reload before editing it.'; end if;
    if public.body_check_in_snapshot_matches(previous,p_input->'expected') is distinct from true then raise exception 'This body check-in changed elsewhere. Reload before editing it; your entered values have been preserved.'; end if;
    if exists(select 1 from public.body_measurement_logs where user_id=owner_id and logged_date=target_date and id<>target_id) then raise exception 'A body check-in already exists for this date. Both records have been preserved.'; end if;
    weight_unit:=case when weight_value is null then null when weight_value is not distinct from previous.weight then previous.weight_input_unit else p_input->'inputUnits'->>'weight' end;
    select coalesce(bool_or(previous.measurements->key=value),false), coalesce(bool_or(previous.measurements->key is distinct from value),false) into unchanged_tape,changed_tape from jsonb_each(p_input->'measurements');
    tape_unit:=case when p_input->'measurements'='{}'::jsonb then null
      when unchanged_tape then case when not changed_tape or previous.circumference_input_unit=p_input->'inputUnits'->>'circumference' then previous.circumference_input_unit else null end
      else p_input->'inputUnits'->>'circumference' end;
    perform set_config('growth.body_check_in_contract','phase5',true);
    update public.body_measurement_logs set logged_date=target_date,weight=weight_value,measurements=p_input->'measurements',notes=nullif(btrim(p_input->>'notes'),''),
      weight_input_unit=weight_unit,circumference_input_unit=tape_unit,updated_at=clock_timestamp()
      where id=target_id returning * into saved;
  end if;
  perform set_config('growth.body_check_in_contract',coalesce(previous_contract,''),true);
  insert into public.body_check_in_write_requests(user_id,request_id,observation_id,recorded_id,payload) values(owner_id,attempt_id,saved.id,saved.id,canonical_payload);
  return to_jsonb(saved);
end;
$$;

create or replace function public.delete_body_check_in(p_id bigint,p_expected jsonb default null,p_expected_account uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); previous public.body_measurement_logs%rowtype;
begin
  if owner_id is null then raise exception 'Please log in again.'; end if;
  if p_expected_account is not null and p_expected_account<>owner_id then raise exception 'The signed-in account changed. Return to the original account before deleting this check-in.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('growth:body:'||owner_id::text,0));
  select * into previous from public.body_measurement_logs where id=p_id and user_id=owner_id for update;
  if not found then return; end if;
  if p_expected is not null and public.body_check_in_snapshot_matches(previous,p_expected) is distinct from true then raise exception 'This body check-in changed elsewhere. Reload before deleting it.'; end if;
  delete from public.body_measurement_logs where id=p_id and user_id=owner_id;
end;
$$;
revoke all on function public.record_body_check_in(jsonb),public.delete_body_check_in(bigint,jsonb,uuid) from public,anon;
grant execute on function public.record_body_check_in(jsonb),public.delete_body_check_in(bigint,jsonb,uuid) to authenticated;
-- Older callers and imports do not provide trustworthy tape input-unit evidence.
-- They may still write compatible observations, but cannot retain metadata that
-- no longer describes the changed values. The whole-check-in RPC assigns its
-- conservative metadata explicitly before restoring its transaction-local flag.
create or replace function public.invalidate_legacy_body_input_units()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('growth.body_check_in_contract',true) is distinct from 'phase5' then
    if new.weight is distinct from old.weight then new.weight_input_unit:=null; end if;
    if new.measurements is distinct from old.measurements then new.circumference_input_unit:=null; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_legacy_body_input_units() from public,anon,authenticated;
drop trigger if exists invalidate_legacy_body_input_units on public.body_measurement_logs;
create trigger invalidate_legacy_body_input_units before update on public.body_measurement_logs for each row execute function public.invalidate_legacy_body_input_units();

commit;
