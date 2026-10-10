#!/usr/bin/env bash
set -euo pipefail
# Own a throwaway cluster with a private socket; never read a production DSN.
phase5_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
phase5_temp="$(mktemp -d "${TMPDIR:-/tmp}/growth-phase5-postgres.XXXXXX")"
cleanup(){ pg_ctl -D "$phase5_temp/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$phase5_temp"; }
trap cleanup EXIT
mkdir "$phase5_temp/socket"
initdb -D "$phase5_temp/data" --auth=trust --no-locale -E UTF8 >"$phase5_temp/init.log" 2>&1
pg_ctl -D "$phase5_temp/data" -l "$phase5_temp/server.log" -o "-k '$phase5_temp/socket' -p 55445 -h ''" -w start >"$phase5_temp/start.log" 2>&1
run_sql(){
  if ! psql -X -h "$phase5_temp/socket" -p 55445 -d "${2:-postgres}" -v ON_ERROR_STOP=1 -q -t -A -f "$1" >"$phase5_temp/check.log" 2>&1;then cat "$phase5_temp/check.log";return 1;fi
  sed -n '/assertions passed/p' "$phase5_temp/check.log"
}
python3 - "$phase5_source" "$phase5_temp" <<'PY'
from pathlib import Path
import sys
source,temp=map(Path,sys.argv[1:])
prior=(source/'schema.sql').read_text().split('\n-- Phase 5: atomic whole body check-ins (fresh-install copy of migration).\n')[0]
(temp/'phase3-schema.sql').write_text(prior+'\ncommit;\n')
(temp/'fresh-bootstrap.sql').write_text('\n'.join(line for line in (source/'tests/bootstrap.sql').read_text().splitlines() if not line.startswith('create role ')))
PY
run_sql "$phase5_source/tests/bootstrap.sql"
run_sql "$phase5_temp/phase3-schema.sql"
run_sql "$phase5_source/migrations/20261009000001_phase5_body_check_in.sql"
run_sql "$phase5_source/tests/phase5_body.sql"
run_sql "$phase5_source/tests/phase5_races.sql"
race_call(){
  psql -X -h "$phase5_temp/socket" -p 55445 -d postgres -v ON_ERROR_STOP=1 -q -t -A \
    -c "begin;set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-0000-0000-000000000051';select $1;select pg_sleep(0.1);commit;" >"$2" 2>&1
}
race_call 'phase5_test.race_record()' "$phase5_temp/record-a.log" &
phase5_a=$!
race_call 'phase5_test.race_record()' "$phase5_temp/record-b.log" &
phase5_b=$!
if ! wait "$phase5_a" || ! wait "$phase5_b";then cat "$phase5_temp/record-a.log" "$phase5_temp/record-b.log";exit 1;fi
race_call 'phase5_test.race_edit(1)' "$phase5_temp/edit-a.log" &
phase5_a=$!
race_call 'phase5_test.race_edit(2)' "$phase5_temp/edit-b.log" &
phase5_b=$!
if ! wait "$phase5_a" || ! wait "$phase5_b";then cat "$phase5_temp/edit-a.log" "$phase5_temp/edit-b.log";exit 1;fi
cat >"$phase5_temp/race-check.sql" <<'SQL'
select phase5_test.ok((select count(*)=1 from public.body_measurement_logs where user_id='00000000-0000-0000-0000-000000000051' and logged_date='2026-10-10'),'independent clients record one observation');
select phase5_test.ok((select count(*)=1 from public.body_check_in_write_requests where request_id='50000000-0000-0000-0000-000000000020'),'independent clients share one receipt');
select phase5_test.ok((select count(*)=1 from public.body_check_in_write_requests where request_id in ('50000000-0000-0000-0000-000000000021','50000000-0000-0000-0000-000000000022')),'independent stale editors accept one revision');
select phase5_test.ok((select weight in (171,172) and measurements='{"waist":80}'::jsonb from public.body_measurement_logs where user_id='00000000-0000-0000-0000-000000000051' and logged_date='2026-10-11'),'concurrent edit preserves complete winning observation');
select 'Phase 5 concurrent body: 4 assertions passed';
SQL
run_sql "$phase5_temp/race-check.sql"

createdb -h "$phase5_temp/socket" -p 55445 phase5_fresh
run_sql "$phase5_temp/fresh-bootstrap.sql" phase5_fresh
run_sql "$phase5_source/schema.sql" phase5_fresh
run_sql "$phase5_source/tests/phase5_body.sql" phase5_fresh
