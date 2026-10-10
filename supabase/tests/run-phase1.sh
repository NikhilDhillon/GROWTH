#!/usr/bin/env bash
set -euo pipefail

# Self-contained throwaway PostgreSQL cluster. It never connects to Supabase,
# an existing server, or any user database. Requires local PostgreSQL binaries.
phase1_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
phase1_temp="$(mktemp -d "${TMPDIR:-/tmp}/growth-phase1-postgres.XXXXXX")"
cleanup() {
  pg_ctl -D "$phase1_temp/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$phase1_temp"
}
trap cleanup EXIT
mkdir "$phase1_temp/socket"
initdb -D "$phase1_temp/data" --auth=trust --no-locale -E UTF8 >"$phase1_temp/init.log" 2>&1
pg_ctl -D "$phase1_temp/data" -l "$phase1_temp/server.log" -o "-k '$phase1_temp/socket' -p 55439 -h ''" -w start >"$phase1_temp/start.log" 2>&1

run_sql() {
  local phase1_database="$1"
  local phase1_sql_file="$2"
  shift 2
  if ! psql -X -h "$phase1_temp/socket" -p 55439 -d "$phase1_database" -v ON_ERROR_STOP=1 -q -t -A "$@" -f "$phase1_sql_file" >"$phase1_temp/check.log" 2>&1; then
    cat "$phase1_temp/check.log"
    return 1
  fi
  # Only emit concise result lines; retain notices in the temporary check log.
  sed -n '/assertions passed/p' "$phase1_temp/check.log"
}
run_sql postgres "$phase1_source/tests/bootstrap.sql"
python3 - "$phase1_source/schema.sql" "$phase1_temp/phase2-schema.sql" <<'PYBASE'
from pathlib import Path
import sys
Path(sys.argv[2]).write_text(Path(sys.argv[1]).read_text().split('\n-- Phase 3: durable recording lifecycle (fresh-install copy of migration).\n')[0] + '\ncommit;\n')
PYBASE
run_sql postgres "$phase1_temp/phase2-schema.sql"
run_sql postgres "$phase1_source/migrations/20261004000000_phase1_record_safety.sql"
run_sql postgres "$phase1_source/migrations/20261008000000_phase2_domain_contract.sql"
run_sql postgres "$phase1_source/tests/phase1_safety.sql"
run_sql postgres "$phase1_source/tests/phase2_domain.sql"
python3 "$phase1_source/tests/concurrency.py" "$phase1_temp/socket"
run_sql postgres "$phase1_source/tests/catalog_preservation.sql"

# Roles are cluster-scoped; use the same schema with a fresh second database.
createdb -h "$phase1_temp/socket" -p 55439 phase1_body
sed '/^create role /d' "$phase1_source/tests/bootstrap.sql" >"$phase1_temp/body-bootstrap.sql"
run_sql phase1_body "$phase1_temp/body-bootstrap.sql"
run_sql phase1_body "$phase1_temp/phase2-schema.sql"
python3 - "$phase1_source" "$phase1_temp" <<'PYBODY'
from pathlib import Path
import sys
source, temporary = map(Path, sys.argv[1:])
# Body retirement regressions reinstall Phase 1. Keep their schema dependency
# at that contract; Phase 3 upgrade/fresh-install behavior has its own suite.
body = (source / 'tests/body_migration.sql').read_text()
body = body.replace('\\ir ../schema.sql', '\\ir ' + str(temporary / 'phase2-schema.sql'))
body = body.replace('\\ir ../migrations/', '\\ir ' + str(source / 'migrations') + '/')
(temporary / 'body-migration.sql').write_text(body)
PYBODY
run_sql phase1_body "$phase1_temp/body-migration.sql"

for phase1_case in legacy duplicate missing_fk; do
  phase1_database="phase1_catalog_$phase1_case"
  createdb -h "$phase1_temp/socket" -p 55439 "$phase1_database"
  run_sql "$phase1_database" "$phase1_temp/body-bootstrap.sql"
  run_sql "$phase1_database" "$phase1_source/schema.sql"
  phase1_legacy=false
  phase1_missing_fk=false
  phase1_installs=(standard_exercise_catalog.sql schema.sql migrations/20261004000000_phase1_record_safety.sql)
  case "$phase1_case" in
    legacy) phase1_legacy=true; phase1_expected_error="Legacy exercise ownership" ;;
    duplicate) phase1_expected_error="Duplicate exercise names" ;;
    missing_fk)
      phase1_missing_fk=true
      phase1_expected_error="ON DELETE CASCADE session foreign key"
      phase1_installs=(schema.sql migrations/20261004000000_phase1_record_safety.sql)
      ;;
  esac
  run_sql "$phase1_database" "$phase1_source/tests/catalog_failure_setup.sql" -v legacy="$phase1_legacy" -v missing_fk="$phase1_missing_fk"
  for phase1_install in "${phase1_installs[@]}"; do
    if psql -X -h "$phase1_temp/socket" -p 55439 -d "$phase1_database" -v ON_ERROR_STOP=1 -q -t -A -f "$phase1_source/$phase1_install" >"$phase1_temp/failure.log" 2>&1; then
      printf '%s should have refused %s ambiguity\n' "$phase1_install" "$phase1_case"
      exit 1
    fi
    if [[ "$(<"$phase1_temp/failure.log")" != *"$phase1_expected_error"* ]]; then
      cat "$phase1_temp/failure.log"
      exit 1
    fi
  done
  run_sql "$phase1_database" "$phase1_source/tests/catalog_failure_verify.sql"
done
