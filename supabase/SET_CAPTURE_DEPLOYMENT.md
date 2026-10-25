# Set capture evidence deployment

No deployed Supabase schema or production data was changed during this implementation.

## What it adds

- `workout_sets.performed_at` (timestamptz) and `workout_sets.evidence` (`typed`, `flow`, `planned` or `recalled`). Both are capture metadata, not observations. Existing rows stay null (unknown); nothing is backfilled.
- `phase2_save_workout_session` stores per-set `performedAt`/`evidence` when supplied. They are excluded from the retry payload hash, so existing receipts still match. A history edit keeps the evidence of sets whose values are unchanged, marks changed sets `typed`, and keeps capture timing by position.
- Template exercise lists live in the ordinary owner setting `workout_template_exercises`, and active drafts gain `slots` and `rest` keys. Neither needs a migration: owners may already write ordinary settings, and `save_active_workout`/`record_workout_entry` preserve unknown draft keys.

## Installation

1. Apply after all earlier migrations: `migrations/20261024000000_set_capture_evidence.sql`. It is safe to rerun.
2. A fresh installation uses the current `schema.sql`, which includes this migration.
3. Either order of client and schema release works. A client without the migration's columns sends metadata the old function ignores. An old client keeps working against the new schema, because the metadata is optional.

## Local verification

```sh
bash supabase/tests/run-set-capture.sh
```

The harness owns a throwaway PostgreSQL cluster. It checks the upgrade path (the previous schema plus the migration, applied twice) and a fresh install. It cannot verify the deployed project.
