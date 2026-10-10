\set ON_ERROR_STOP on
create schema phase5_test;
create sequence phase5_test.assertions;
grant usage on schema phase5_test to authenticated,anon;
grant usage,select on sequence phase5_test.assertions to authenticated,anon;
create function phase5_test.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'Assertion failed: %',label; end if;perform nextval('phase5_test.assertions');end;$$;
create function phase5_test.expect_error(statement text,expected text) returns void language plpgsql as $$begin begin execute statement;exception when others then if position(expected in sqlerrm)=0 then raise exception 'Expected %, received %',expected,sqlerrm;end if;perform phase5_test.ok(true,expected);return;end;raise exception 'Expected failure: %',statement;end;$$;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000051'),('00000000-0000-0000-0000-000000000052');
create function phase5_test.fail_receipt() returns trigger language plpgsql as $$begin if new.request_id='50000000-0000-0000-0000-000000000777' then raise exception 'Receipt storage failure';end if;return new;end;$$;
create trigger test_body_receipt_failure before insert on public.body_check_in_write_requests for each row execute function phase5_test.fail_receipt();
set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-0000-0000-000000000051';
select jsonb_build_object('requestId','50000000-0000-0000-0000-000000000001','loggedDate','2026-10-01','weight',170,'measurements','{"waist":80,"arm_flexed":{"mode":"sides","left":34,"right":35}}'::jsonb,'notes','original','inputUnits','{"weight":"lb","circumference":"cm"}'::jsonb) as create_input \gset
select public.record_body_check_in(:'create_input'::jsonb) as original \gset
select phase5_test.ok((:'original'::jsonb->>'weight')::numeric=170 and :'original'::jsonb->>'weight_input_unit'='lb' and :'original'::jsonb->>'circumference_input_unit'='cm','whole observation and explicit units recorded');
select phase5_test.expect_error(format('select public.delete_body_check_in(%s,%L::jsonb,%L::uuid)',:'original'::jsonb->>'id',:'original'::jsonb,'00000000-0000-0000-0000-000000000052'),'account changed');
select phase5_test.ok((select count(*)=1 from public.body_measurement_logs),'account switch cannot delete initiating account observation');
select phase5_test.ok(public.record_body_check_in(:'create_input'::jsonb)=:'original'::jsonb,'repeated tap creates one row');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000002","weight":999}'::jsonb),'already exists');
select phase5_test.ok((select count(*)=1 and max(weight)=170 from public.body_measurement_logs),'occupied date preserves original');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"weight":999}'::jsonb),'different values');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000003","accountId":"00000000-0000-0000-0000-000000000052"}'::jsonb),'account changed');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000004","loggedDate":"2026-02-30"}'::jsonb),'date/time field value out of range');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000005","measurements":{"unknown":2}}'::jsonb),'Unknown body');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000006","measurements":{"waist":-1}}'::jsonb),'positive body');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000007","weight":null,"measurements":{}}'::jsonb),'Record a bodyweight');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000008","measurements":{"thigh":{"mode":"sides"}}}'::jsonb),'at least one side');
-- Later receipt failure rolls back the entire create, not just its acknowledgement.
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000777","loggedDate":"2026-10-02"}'::jsonb),'Receipt storage failure');
select phase5_test.ok((select count(*)=1 from public.body_measurement_logs),'receipt failure preserves prior state');
select (:'create_input'::jsonb||jsonb_build_object('requestId','50000000-0000-0000-0000-000000000009','id',(:'original'::jsonb->>'id')::bigint,'expected',:'original'::jsonb,'weight',171)) as edit_input \gset
select public.record_body_check_in(:'edit_input'::jsonb) as edited \gset
select phase5_test.ok((:'edited'::jsonb->>'weight')::numeric=171 and :'edited'::jsonb->'measurements'=:'original'::jsonb->'measurements','whole edit keeps explicit unchanged observations');
select phase5_test.ok(public.record_body_check_in(:'create_input'::jsonb)=:'edited'::jsonb,'old successful retry returns newer facts without replay');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'edit_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000010","weight":175}'::jsonb),'changed elsewhere');
select phase5_test.expect_error(format('select public.delete_body_check_in(%s,%L::jsonb)',:'original'::jsonb->>'id',:'original'::jsonb),'changed elsewhere');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'edit_input'::jsonb||jsonb_build_object('requestId','50000000-0000-0000-0000-000000000777','expected',:'edited'::jsonb,'weight',176)),'Receipt storage failure');
select phase5_test.ok((select weight=171 from public.body_measurement_logs where id=(:'original'::jsonb->>'id')::bigint),'receipt failure rolls back edited facts');
-- A compatibility writer may not preserve false source-unit metadata; a stale
-- editor must detect changed facts even if that writer does not touch timestamp.
update public.body_measurement_logs set weight=172 where id=(:'original'::jsonb->>'id')::bigint;
select phase5_test.ok((select weight_input_unit is null and circumference_input_unit='cm' from public.body_measurement_logs where id=(:'original'::jsonb->>'id')::bigint),'legacy weight change retires only changed provenance');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'edit_input'::jsonb||jsonb_build_object('requestId','50000000-0000-0000-0000-000000000011','expected',:'edited'::jsonb,'weight',180)),'changed elsewhere');
select to_jsonb(b) as legacy from public.body_measurement_logs b where id=(:'original'::jsonb->>'id')::bigint \gset
select public.record_body_check_in(:'edit_input'::jsonb||jsonb_build_object('requestId','50000000-0000-0000-0000-000000000012','expected',:'legacy'::jsonb,'weight',172,'measurements','{}'::jsonb)) as cleared \gset
select phase5_test.ok(:'cleared'::jsonb->'measurements'='{}'::jsonb and :'cleared'::jsonb->'circumference_input_unit'='null'::jsonb and :'cleared'::jsonb->'weight_input_unit'='null'::jsonb,'field removal does not invent unknown unchanged unit');
-- Legacy unknown tape plus newly entered tape has mixed provenance, not one
-- fabricated historical input unit.
insert into public.body_measurement_logs(weight,measurements,logged_date) values(173,'{"waist":80}', '2026-10-03') returning to_jsonb(body_measurement_logs.*) as historical \gset
select public.record_body_check_in(:'create_input'::jsonb||jsonb_build_object('requestId','50000000-0000-0000-0000-000000000013','id',(:'historical'::jsonb->>'id')::bigint,'expected',:'historical'::jsonb,'loggedDate','2026-10-03','weight',174,'measurements','{"waist":80,"chest":99}'::jsonb)) as mixed \gset
select phase5_test.ok(:'mixed'::jsonb->'circumference_input_unit'='null'::jsonb and :'mixed'::jsonb->>'weight_input_unit'='lb','new weight known; retained unknown tape remains unknown');
select public.record_body_check_in(:'create_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000014","loggedDate":"2026-10-04","measurements":{}}'::jsonb) as daily \gset
select phase5_test.ok(:'daily'::jsonb->'circumference_input_unit'='null'::jsonb,'daily weight does not claim tape was entered');
select phase5_test.expect_error('select * from public.body_check_in_write_requests','permission denied');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000052';
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'edit_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000015"}'::jsonb),'no longer exists');
select public.delete_body_check_in((:'original'::jsonb->>'id')::bigint,:'cleared'::jsonb);
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000051';
select phase5_test.ok((select count(*)=1 from public.body_measurement_logs where id=(:'original'::jsonb->>'id')::bigint),'another user cannot delete private check-in');
select public.delete_body_check_in((:'original'::jsonb->>'id')::bigint,:'cleared'::jsonb);
select phase5_test.ok(not exists(select 1 from public.body_measurement_logs where id=(:'original'::jsonb->>'id')::bigint),'whole deletion removes body observation');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb),'was deleted');
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'edit_input'::jsonb||'{"requestId":"50000000-0000-0000-0000-000000000016"}'::jsonb),'no longer exists');
select public.delete_body_check_in((:'original'::jsonb->>'id')::bigint,:'cleared'::jsonb);
reset role;
select phase5_test.ok((select observation_id is null and recorded_id=(:'original'::jsonb->>'id')::bigint from public.body_check_in_write_requests where request_id='50000000-0000-0000-0000-000000000001'),'deleted receipts retain tombstone identity');
set role anon;set request.jwt.claim.sub='';
select phase5_test.expect_error(format('select public.record_body_check_in(%L::jsonb)',:'create_input'::jsonb),'permission denied');
reset role;
select 'Phase 5 body: '||last_value||' assertions passed' from phase5_test.assertions;
