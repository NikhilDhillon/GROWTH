#!/usr/bin/env bash
set -euo pipefail

phase6_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
phase6_temp="$(mktemp -d "${TMPDIR:-/tmp}/growth-phase6-sharing.XXXXXX")"
cleanup(){ pg_ctl -D "$phase6_temp/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$phase6_temp"; }
trap cleanup EXIT
mkdir "$phase6_temp/socket"
initdb -D "$phase6_temp/data" --auth=trust --no-locale -E UTF8 >"$phase6_temp/init.log" 2>&1
pg_ctl -D "$phase6_temp/data" -l "$phase6_temp/server.log" -o "-k '$phase6_temp/socket' -p 55446 -h ''" -w start >"$phase6_temp/start.log" 2>&1
run_sql(){
  local phase6_file="$1" phase6_database="${2:-postgres}"
  if ! psql -X -h "$phase6_temp/socket" -p 55446 -d "$phase6_database" -v ON_ERROR_STOP=1 -q -t -A -f "$phase6_file" >"$phase6_temp/check.log" 2>&1; then
    cat "$phase6_temp/check.log"
    return 1
  fi
  sed -n '/Phase 6 sharing:/p' "$phase6_temp/check.log"
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
    # Permit local migration testing before the schema fresh-install copy lands.
    prior = schema.rsplit('\ncommit;', 1)[0]
(temporary / 'phase5-schema.sql').write_text(prior + '\ncommit;\n')
(temporary / 'fresh-bootstrap.sql').write_text('\n'.join(
    line for line in (source / 'tests/bootstrap.sql').read_text().splitlines()
    if not line.startswith('create role ')))
PY
run_sql "$phase6_source/tests/bootstrap.sql"
run_sql "$phase6_temp/phase5-schema.sql"
run_sql "$phase6_source/tests/phase6_sharing_legacy_setup.sql"
run_sql "$phase6_source/migrations/20261010000000_phase6_import_results.sql"
run_sql "$phase6_source/migrations/20261010000001_phase6_sharing.sql"
run_sql "$phase6_source/tests/phase6_sharing.sql"
run_sql "$phase6_source/tests/phase6_sharing_legacy_verify.sql"

createdb -h "$phase6_temp/socket" -p 55446 phase6_fresh
run_sql "$phase6_temp/fresh-bootstrap.sql" phase6_fresh
run_sql "$phase6_source/schema.sql" phase6_fresh
if [[ ! -f "$phase6_temp/has-phase6-schema-copy" ]]; then
  run_sql "$phase6_source/migrations/20261010000000_phase6_import_results.sql" phase6_fresh
  run_sql "$phase6_source/migrations/20261010000001_phase6_sharing.sql" phase6_fresh
fi
run_sql "$phase6_source/tests/phase6_sharing.sql" phase6_fresh
