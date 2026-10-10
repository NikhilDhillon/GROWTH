#!/usr/bin/env bash
set -euo pipefail

# This test owns a throwaway PostgreSQL cluster/socket. It cannot connect to a
# deployed Supabase project or an existing database, even with PG* variables set.
phase3_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
phase3_temp="$(mktemp -d "${TMPDIR:-/tmp}/growth-phase3-postgres.XXXXXX")"
cleanup() {
  pg_ctl -D "$phase3_temp/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$phase3_temp"
}
trap cleanup EXIT
mkdir "$phase3_temp/socket"
initdb -D "$phase3_temp/data" --auth=trust --no-locale -E UTF8 >"$phase3_temp/init.log" 2>&1
pg_ctl -D "$phase3_temp/data" -l "$phase3_temp/server.log" -o "-k '$phase3_temp/socket' -p 55440 -h ''" -w start >"$phase3_temp/start.log" 2>&1
run_sql() {
  local phase3_file="$1"
  local phase3_database="${2:-postgres}"
  if ! psql -X -h "$phase3_temp/socket" -p 55440 -d "$phase3_database" -v ON_ERROR_STOP=1 -q -t -A -f "$phase3_file" >"$phase3_temp/check.log" 2>&1; then
    cat "$phase3_temp/check.log"
    return 1
  fi
  sed -n '/assertions passed/p' "$phase3_temp/check.log"
}
python3 - "$phase3_source" "$phase3_temp" <<'PY'
from pathlib import Path
import sys
source, temporary = map(Path, sys.argv[1:])
# An upgrade starts from the previous schema. Never reinstall an older RPC
# over the latest fresh schema (PostgreSQL forbids changed return types).
schema = (source / 'schema.sql').read_text().split('\n-- Phase 3: durable recording lifecycle (fresh-install copy of migration).\n')[0]
(temporary / 'phase2-schema.sql').write_text(schema + '\ncommit;\n')
(temporary / 'fresh-bootstrap.sql').write_text('\n'.join(line for line in (source / 'tests/bootstrap.sql').read_text().splitlines() if not line.startswith('create role ')))
# Reuse the existing error/assertion helpers and failure triggers, without
# executing the older client contract tests against the new draft contract.
helpers = (source / 'tests/phase1_safety.sql').read_text().split('-- Normal saves are atomic')[0]
(temporary / 'fresh-helpers.sql').write_text(helpers)
PY
run_sql "$phase3_source/tests/bootstrap.sql"
run_sql "$phase3_temp/phase2-schema.sql"
# Exercise the documented deployment ordering, and verify previous checks before
# replacing draft RPCs with the stronger revision-aware Phase 3 contract.
run_sql "$phase3_source/migrations/20261004000000_phase1_record_safety.sql"
run_sql "$phase3_source/migrations/20261008000000_phase2_domain_contract.sql"
run_sql "$phase3_source/tests/phase1_safety.sql"
run_sql "$phase3_source/tests/phase2_domain.sql"
run_sql "$phase3_source/migrations/20261009000000_phase3_recording_lifecycle.sql"
run_sql "$phase3_source/tests/phase3_lifecycle.sql"

race_call() {
  local phase3_owner="$1" phase3_action="$2" phase3_log="$3"
  psql -X -h "$phase3_temp/socket" -p 55440 -d postgres -v ON_ERROR_STOP=1 -q -t -A \
    -c "begin; set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='$phase3_owner'; select $phase3_action; select pg_sleep(0.1); commit;" >"$phase3_log" 2>&1
}
race_call '00000000-0000-0000-0000-000000000008' "phase1_test.phase3_race_save('A')" "$phase3_temp/draft-a.log" &
phase3_first=$!
race_call '00000000-0000-0000-0000-000000000008' "phase1_test.phase3_race_save('B')" "$phase3_temp/draft-b.log" &
phase3_second=$!
if ! wait "$phase3_first" || ! wait "$phase3_second"; then
  cat "$phase3_temp/draft-a.log" "$phase3_temp/draft-b.log"
  exit 1
fi
race_call '00000000-0000-0000-0000-000000000009' 'phase1_test.phase3_race_record()' "$phase3_temp/record-a.log" &
phase3_first=$!
race_call '00000000-0000-0000-0000-000000000009' 'phase1_test.phase3_race_record()' "$phase3_temp/record-b.log" &
phase3_second=$!
if ! wait "$phase3_first" || ! wait "$phase3_second"; then
  cat "$phase3_temp/record-a.log" "$phase3_temp/record-b.log"
  exit 1
fi
cat >"$phase3_temp/race-check.sql" <<'SQL'
select phase1_test.assert_true((select value::jsonb->>'revision'='2' and value::jsonb->>'workoutLabel' in('A','B') from public.app_settings where user_id='00000000-0000-0000-0000-000000000008' and key='active_workout'),'concurrent draft CAS accepts exactly one revision');
select phase1_test.assert_true((select jsonb_array_length(value::jsonb)=1 from public.app_settings where user_id='00000000-0000-0000-0000-000000000008' and key='recovered_workout_drafts'),'concurrent losing draft remains recoverable');
select phase1_test.assert_true((select count(*)=1 from public.workout_sessions where user_id='00000000-0000-0000-0000-000000000009'),'concurrent receipt retry creates one observed entry');
select phase1_test.assert_true((select count(*)=1 from public.workout_entry_references where user_id='00000000-0000-0000-0000-000000000009'),'concurrent receipt retry creates one reference');
select phase1_test.assert_true((select value::jsonb->>'revision'='2' and jsonb_array_length(value::jsonb->'completedExercises')=1 from public.app_settings where user_id='00000000-0000-0000-0000-000000000009' and key='active_workout'),'concurrent receipt retry advances draft exactly once');
select 'Phase 3 concurrent draft/receipt assertions passed';
SQL
run_sql "$phase3_temp/race-check.sql"

createdb -h "$phase3_temp/socket" -p 55440 phase3_fresh
run_sql "$phase3_temp/fresh-bootstrap.sql" phase3_fresh
run_sql "$phase3_source/schema.sql" phase3_fresh
run_sql "$phase3_temp/fresh-helpers.sql" phase3_fresh
run_sql "$phase3_source/tests/phase3_lifecycle.sql" phase3_fresh
