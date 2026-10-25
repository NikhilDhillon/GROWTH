#!/usr/bin/env bash
set -euo pipefail

# This test owns a throwaway PostgreSQL cluster/socket. It cannot connect to a
# deployed Supabase project or an existing database, even with PG* variables set.
capture_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
capture_temp="$(mktemp -d "${TMPDIR:-/tmp}/growth-capture-postgres.XXXXXX")"
cleanup() {
  pg_ctl -D "$capture_temp/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$capture_temp"
}
trap cleanup EXIT
mkdir "$capture_temp/socket"
initdb -D "$capture_temp/data" --auth=trust --no-locale -E UTF8 >"$capture_temp/init.log" 2>&1
pg_ctl -D "$capture_temp/data" -l "$capture_temp/server.log" -o "-k '$capture_temp/socket' -p 55442 -h ''" -w start >"$capture_temp/start.log" 2>&1
run_sql() {
  local capture_file="$1"
  local capture_database="${2:-postgres}"
  if ! psql -X -h "$capture_temp/socket" -p 55442 -d "$capture_database" -v ON_ERROR_STOP=1 -q -t -A -f "$capture_file" >"$capture_temp/check.log" 2>&1; then
    cat "$capture_temp/check.log"
    return 1
  fi
  sed -n '/assertions passed/p' "$capture_temp/check.log"
}
python3 - "$capture_source" "$capture_temp" <<'PY'
from pathlib import Path
import sys
source, temporary = map(Path, sys.argv[1:])
marker = '\n-- Set capture evidence (fresh-install copy of migration).\n'
schema = (source / 'schema.sql').read_text()
assert marker in schema
# The upgrade starts from the schema as it was before this migration.
(temporary / 'previous-schema.sql').write_text(schema.split(marker)[0] + '\ncommit;\n')
(temporary / 'fresh-bootstrap.sql').write_text('\n'.join(line for line in (source / 'tests/bootstrap.sql').read_text().splitlines() if not line.startswith('create role ')))
helpers = (source / 'tests/phase1_safety.sql').read_text().split('-- Normal saves are atomic')[0]
(temporary / 'helpers.sql').write_text(helpers)
PY

# Upgrade: previous schema, then the migration applied twice (it must be rerunnable).
run_sql "$capture_source/tests/bootstrap.sql"
run_sql "$capture_temp/previous-schema.sql"
run_sql "$capture_source/migrations/20261024000000_set_capture_evidence.sql"
run_sql "$capture_source/migrations/20261024000000_set_capture_evidence.sql"
run_sql "$capture_temp/helpers.sql"
run_sql "$capture_source/tests/set_capture.sql"

# Fresh installation from the current schema.
createdb -h "$capture_temp/socket" -p 55442 capture_fresh
run_sql "$capture_temp/fresh-bootstrap.sql" capture_fresh
run_sql "$capture_source/schema.sql" capture_fresh
run_sql "$capture_temp/helpers.sql" capture_fresh
run_sql "$capture_source/tests/set_capture.sql" capture_fresh
