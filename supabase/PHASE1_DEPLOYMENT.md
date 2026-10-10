# Phase 1 database rollout

These are checked-in changes only. No hosted Supabase database, policies, or
production records have been inspected or updated by this implementation.

## Apply and verify

1. Take a recoverable database backup and review the deployed schema/policies
   against this repository. Additional permissive RLS policies or grants must
   be reconciled; PostgreSQL combines permissive policies with OR.
   Legacy `exercises.user_id` ownership or duplicate exercise names must be
   reconciled explicitly first. The migration, schema setup, and catalog script
   refuse those ambiguous stores before changing data or policies.
   Schema setup/migration also require a validated `workout_sets.session_id` →
   `workout_sessions.id` foreign key with `ON DELETE CASCADE`; single-statement
   owned-workout deletion depends on it. Missing/non-cascading constraints need
   explicit reconciliation, preserving any orphan history instead of deleting it.
2. Apply `migrations/20261004000000_phase1_record_safety.sql` through the normal
   Supabase migration process before releasing the updated web client. It is
   one transaction. `schema.sql` contains the same contracts for fresh setup.
3. Verify function ownership belongs to the trusted migration/database role,
   authenticated clients cannot create/replace functions in `public`, and the
   exposed RPCs and their grants match the migration. Confirm PostgREST has
   refreshed its schema cache.
4. In staging, verify own-record saves/edits/deletions, password/session flows,
   legitimate invitation acceptance, repeat acceptance, removal, split opt-out,
   retry after a disconnected save, and interrupted finish/discard. Verify a
   different account cannot mutate another account's sessions or body records.
5. Release the client. Older clients' direct workout, snapshot, friendship, and active/archive
   writes intentionally fail closed after migration; coordinate rollout rather
   than restoring unsafe grants or falling back to destructive client writes.

## Contracts to preserve

- `save_workout_session` creates/edits one exercise session transactionally.
  For creation, a stable `p_request_id` returns the original ID for identical
  observations. A changed payload is rejected. Private hashed commit receipts
  survive session deletion, preventing a delayed retry recreating deleted work.
  Direct session INSERT/UPDATE, set mutations, and snapshot mutations are revoked
  so older cached clients cannot bypass atomic operations. Owned session DELETE
  remains a single statement with the verified cascade. Equipment-tag-only edits
  use the owner-scoped `update_workout_machine_profile` RPC and preserve sets.
- `replace_score_snapshots`, `import_training_data`, and
  `delete_body_observation` perform their related writes in one transaction.
  Import deduplication uses only the importing user's records. Invalid existing
  import receipt JSON is preserved and produces an error rather than being reset.
- `save_active_workout` accepts a non-null object with its original `startedAt`,
  refuses another current workout or a retired identifier, and shares the
  owner-specific transaction lock with `finalize_active_workout`.
- `finalize_active_workout(p_workout_id, p_completed_workouts, p_expected_active)`
  requires the expected JSON snapshot whenever an active draft exists. A stale
  snapshot fails without changing the draft, archive, or retirement receipt.
  The nullable parameter default supports function resolution, not an unsafe
  no-snapshot finish. Matching already-completed/discarded retries are safe when
  no active draft exists. A newer active workout is never cleared by an old retry.
  Only the matching current summary is accepted from the client; unrelated
  server archives remain authoritative and stale client extras are ignored.
- `active_workout` and `completed_guided_workouts` settings are readable by their
  owner but writable only through these RPCs. Ordinary preferences remain writable.
  Private retirement metadata survives archive removal (Phase 2 now preserves archives beyond the former 50-summary limit);
  known explicit `startedAt` values in valid legacy archives seed that metadata.
- Relationship mutations and plan propagation use one short transaction lock.
  Only a legitimate authenticated bearer-invite acceptance can create accepted
  friendship consent. Used invitation tokens cannot be reset, deleted, or replayed
  after revocation. Removing friendship also removes its direct sync edge.
- Split opt-out retains a declined pair row. Pending/declined direct pairs cannot
  receive each other's edits indirectly through a third user. Propagation also
  requires accepted friendships on every traversed edge and with the final recipient.

## Legacy preservation and remaining limits

`body_measurements_legacy_migrated` records an explicit checkpoint per existing
user. If the modern table already exists, missing dates are ambiguous: the
migration preserves modern authority and all legacy rows without backfilling.
Only an unmistakably pre-modern store with no checkpoint copies legacy weights
once. Re-running the migration/schema does not resurrect intentional deletions.
Checkpoint values distinguish `migrated_legacy` and
`existing_modern_legacy_preserved` for later explicit reconciliation.

Local SQLite/browser legacy records lacking valid unit metadata remain intact
and are excluded from automatic pre-modern conversion. Their checkpoint records
`known_legacy_migrated_unknown_preserved` and an unknown-unit count; assigning
units requires explicit reconciliation. Existing modern observations are not
reinterpreted. Local catalog startup/installers retain historical IDs, names,
classifications and references while adding missing standard movements.

Existing accepted friendships are preserved. The prior schema cannot establish
whether every historic acceptance was legitimate. Do not infer consent or delete
relationships automatically; disputed historical consent needs explicit review.
Accepted friends still read the existing workout projections, including raw notes;
narrowing those projections belongs to the later Social phase.

Malformed archives and ambiguous legacy records are retained, not silently
repaired. Retirement identities lost before this release cannot be invented.
Same-workout draft versioning across devices remains later persistence work;
this phase prevents destructive stale completion and retired-draft resurrection.

## Local regression command

Run `bash supabase/tests/run-phase1.sh` from the repository root. It requires
PostgreSQL 14+ binaries and Python 3, creates a temporary local-only cluster,
uses test-only Supabase role/auth stand-ins, and removes the cluster on exit.
It exercises RLS/authority, late-write rollback, retries, concurrent calls,
legacy retirement, schema reruns, additive catalog reruns, and refusal of
ambiguous catalog migrations without changing data or policies. It never
connects to hosted Supabase.
