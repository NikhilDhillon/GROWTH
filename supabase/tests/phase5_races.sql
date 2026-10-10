\set ON_ERROR_STOP on
create function phase5_test.race_record() returns jsonb language sql as $$
  select public.record_body_check_in('{"requestId":"50000000-0000-0000-0000-000000000020","loggedDate":"2026-10-10","weight":170,"measurements":{},"inputUnits":{"weight":"lb","circumference":"cm"}}'::jsonb);
$$;
create table phase5_test.edit_context(expected jsonb);
grant select on phase5_test.edit_context to authenticated;
set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-0000-0000-000000000051';
select public.record_body_check_in('{"requestId":"50000000-0000-0000-0000-000000000023","loggedDate":"2026-10-11","weight":170,"measurements":{"waist":80},"inputUnits":{"weight":"lb","circumference":"cm"}}'::jsonb) as race_original \gset
reset role;
insert into phase5_test.edit_context values(:'race_original'::jsonb);
create function phase5_test.race_edit(variant integer) returns text language plpgsql as $$
declare saved jsonb;
begin
  select expected into saved from phase5_test.edit_context;
  perform public.record_body_check_in(jsonb_build_object('requestId',case when variant=1 then '50000000-0000-0000-0000-000000000021' else '50000000-0000-0000-0000-000000000022' end,
    'id',(saved->>'id')::bigint,'expected',saved,'loggedDate','2026-10-11','weight',170+variant,'measurements',saved->'measurements','inputUnits','{"weight":"lb","circumference":"cm"}'::jsonb));
  return 'saved';
exception when others then
  if position('changed elsewhere' in sqlerrm)>0 then return 'rejected stale edit';end if;
  raise;
end;
$$;
