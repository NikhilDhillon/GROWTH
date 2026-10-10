#!/usr/bin/env bash
set -euo pipefail

phase6_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
phase6_temp="$(mktemp -d "${TMPDIR:-/tmp}/g6i.XXXXXX")"
phase6_pg_bin="${PHASE6_PG_BIN:-/opt/homebrew/bin}"
cleanup(){ "$phase6_pg_bin/pg_ctl" -D "$phase6_temp/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$phase6_temp"; }
trap cleanup EXIT
mkdir "$phase6_temp/socket"
"$phase6_pg_bin/initdb" -D "$phase6_temp/data" --auth=trust --no-locale -E UTF8 >"$phase6_temp/init.log" 2>&1
if ! "$phase6_pg_bin/pg_ctl" -D "$phase6_temp/data" -l "$phase6_temp/server.log" -o "-k '$phase6_temp/socket' -p 55447 -h ''" -w start >"$phase6_temp/start.log" 2>&1; then
  cat "$phase6_temp/start.log" "$phase6_temp/server.log"
  exit 1
fi
run_sql(){
  local phase6_file="$1" phase6_database="${2:-postgres}"
  if ! "$phase6_pg_bin/psql" -X -h "$phase6_temp/socket" -p 55447 -d "$phase6_database" -v ON_ERROR_STOP=1 -q -t -A -f "$phase6_file" >"$phase6_temp/check.log" 2>&1; then
    cat "$phase6_temp/check.log"
    return 1
  fi
  sed -n '/Phase 6 import/p' "$phase6_temp/check.log"
}
run_race(){
  local phase6_database="$1"
  race_call(){
    "$phase6_pg_bin/psql" -X -h "$phase6_temp/socket" -p 55447 -d "$phase6_database" -v ON_ERROR_STOP=1 -q -t -A \
      -f "$phase6_source/tests/phase6_import_race.sql" >"$2" 2>&1
  }
  race_call "$phase6_database" "$phase6_temp/race-a.log" &
  local phase6_a=$!
  race_call "$phase6_database" "$phase6_temp/race-b.log" &
  local phase6_b=$!
  if ! wait "$phase6_a" || ! wait "$phase6_b"; then
    cat "$phase6_temp/race-a.log" "$phase6_temp/race-b.log"
    return 1
  fi
  run_sql "$phase6_source/tests/phase6_import_race_check.sql" "$phase6_database"
}

python3 - "$phase6_source" "$phase6_temp" <<'PY'
from pathlib import Path
import sys

source, temporary = map(Path, sys.argv[1:])
schema = (source / 'schema.sql').read_text()
marker = '\n-- Phase 6: import and sharing contracts\n'
if marker in schema:
    prior = schema.split(marker, 1)[0]
    (temporary / 'has-phase6-schema-copy').touch()
else:
    prior = schema.rsplit('\ncommit;', 1)[0]
(temporary / 'phase5-schema.sql').write_text(prior + '\ncommit;\n')
(temporary / 'fresh-bootstrap.sql').write_text('\n'.join(
    line for line in (source / 'tests/bootstrap.sql').read_text().splitlines()
    if not line.startswith('create role ')))
PY

# Upgrade path: start from the Phase 5 canonical schema and apply the v6 RPC.
run_sql "$phase6_source/tests/bootstrap.sql"
run_sql "$phase6_temp/phase5-schema.sql"
run_sql "$phase6_source/migrations/20261010000000_phase6_import_results.sql"
run_sql "$phase6_source/migrations/20261010000002_import_sibling_exercises.sql"
run_sql "$phase6_source/tests/phase6_import.sql"
run_race postgres

if [[ "${PHASE6_IMPORT_UPGRADE_ONLY:-0}" != "1" ]]; then
  # Fresh path: the canonical schema may already contain the Phase 6 copy.
  createdb -h "$phase6_temp/socket" -p 55447 phase6_import_fresh
  run_sql "$phase6_temp/fresh-bootstrap.sql" phase6_import_fresh
  run_sql "$phase6_source/schema.sql" phase6_import_fresh
  if [[ ! -f "$phase6_temp/has-phase6-schema-copy" ]]; then
    run_sql "$phase6_source/migrations/20261010000000_phase6_import_results.sql" phase6_import_fresh
    run_sql "$phase6_source/migrations/20261010000002_import_sibling_exercises.sql" phase6_import_fresh
  fi
  run_sql "$phase6_source/tests/phase6_import.sql" phase6_import_fresh
  run_race phase6_import_fresh
fi
