#!/usr/bin/env bash
set -euo pipefail

# This test owns a throwaway PostgreSQL cluster/socket. It cannot connect to a
# deployed Supabase project or an existing database, even with PG* variables set.
personal_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
personal_temp="$(mktemp -d "${TMPDIR:-/tmp}/growth-personal-postgres.XXXXXX")"
cleanup() {
  pg_ctl -D "$personal_temp/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$personal_temp"
}
trap cleanup EXIT
mkdir "$personal_temp/socket"
initdb -D "$personal_temp/data" --auth=trust --no-locale -E UTF8 >"$personal_temp/init.log" 2>&1
pg_ctl -D "$personal_temp/data" -l "$personal_temp/server.log" -o "-k '$personal_temp/socket' -p 55443 -h ''" -w start >"$personal_temp/start.log" 2>&1
run_sql() {
  local personal_file="$1"
  local personal_database="${2:-postgres}"
  if ! psql -X -h "$personal_temp/socket" -p 55443 -d "$personal_database" -v ON_ERROR_STOP=1 -q -t -A -f "$personal_file" >"$personal_temp/check.log" 2>&1; then
    cat "$personal_temp/check.log"
    return 1
  fi
  sed -n '/assertions passed/p' "$personal_temp/check.log"
}
# The upgrade starts from the schema at f6a566f (before set capture) plus set capture,
# which is what a deployment applying both migrations in order sees.
git -C "$personal_source" show f6a566f:supabase/schema.sql >"$personal_temp/previous-schema.sql"
python3 - "$personal_source" "$personal_temp" <<'PY'
from pathlib import Path
import sys
source, temporary = map(Path, sys.argv[1:])
(temporary / 'fresh-bootstrap.sql').write_text('\n'.join(line for line in (source / 'tests/bootstrap.sql').read_text().splitlines() if not line.startswith('create role ')))
helpers = (source / 'tests/phase1_safety.sql').read_text().split('-- Normal saves are atomic')[0]
(temporary / 'helpers.sql').write_text(helpers)
PY

# Upgrade: previous schema, set capture, then this migration applied twice (it must be rerunnable).
run_sql "$personal_source/tests/bootstrap.sql"
run_sql "$personal_temp/previous-schema.sql"
run_sql "$personal_source/migrations/20261024000000_set_capture_evidence.sql"
run_sql "$personal_source/migrations/20261025000000_personal_exercises.sql"
run_sql "$personal_source/migrations/20261025000000_personal_exercises.sql"
run_sql "$personal_temp/helpers.sql"
run_sql "$personal_source/tests/personal_exercises.sql"
# Reinstalling the current schema over personal exercises (two accounts share a name) keeps them.
run_sql "$personal_source/schema.sql"
psql -X -h "$personal_temp/socket" -p 55443 -d postgres -v ON_ERROR_STOP=1 -q -t -A -c \
  "select case when (select count(*) from public.exercises where creator_id is not null) = 3 and exists (select 1 from pg_indexes where indexname = 'exercises_owner_display_name_idx') then 'Schema reinstall assertions passed' else 'Schema reinstall lost personal exercises' end" | grep 'assertions passed'

# Fresh installation from the current schema.
createdb -h "$personal_temp/socket" -p 55443 personal_fresh
run_sql "$personal_temp/fresh-bootstrap.sql" personal_fresh
run_sql "$personal_source/schema.sql" personal_fresh
run_sql "$personal_temp/helpers.sql" personal_fresh
run_sql "$personal_source/tests/personal_exercises.sql" personal_fresh
