# Phase 3 deployment and verification

No deployed Supabase schema or production data was changed during this implementation.

## Installation

1. Take recoverable backups of workout sessions/sets, app settings (including raw active/archive documents), receipts, retirement checkpoints, body observations, and local browser/SQLite stores. Do not clear ambiguous evidence to make initialization pass.
2. For an existing deployment, verify Phase 1 authority protections and apply Phase 2 first. Then apply `migrations/20261009000000_phase3_recording_lifecycle.sql`. The migration adds metadata/references and protected settings; it does not replace historical observations or infer their units/owners.
3. A fresh installation uses the current `schema.sql`, which includes Phases 1–3 in one transaction. Do not apply older Phase 1/2 migrations afterward; they define superseded RPC contracts. Fresh-schema and Phase 3 migration reruns are covered by preservation tests.
4. Publish the matching client and require old/suspended clients to reload. `save_active_workout` now returns a saved revision or a committed conflict result. New Guided entries require `record_workout_entry`; the older session RPC continues to support manual/import writes, edits, and old receipt retries but rejects new Guided creation. No unsafe client fallback is provided.
5. On the first owner-scoped load, the client plans explicit reference initialization and calls `initialize_workout_records`. The server checks raw evidence snapshots, ownership, and explicit legacy links under the same workout lock. If evidence changed or is ambiguous, retain it and reload/reconcile; never rewrite the source to invent a successful migration.

## Contracts to verify in the deployed project

- Owner-only reads and no direct client writes for `workout_records` and `workout_entry_references`; composite owner foreign keys; one reference per canonical entry.
- Protected active/archive, migration, original-active-evidence, and recovery settings cannot be directly inserted, overwritten, or deleted by clients.
- Phase 2 implementation helpers and Phase 3 internal helpers have no client execute grant. Public mutation RPCs require valid authentication and owner-scoped transaction locks.
- Guided input confirmation covers exercise, day, unit, machine, reps, load, and warmup state. The confirmed draft must equal the recorded payload; missing muscle context is rejected rather than invented.
- Concurrent draft saves accept one changed revision and preserve the loser. Duplicate recording retries create one canonical entry/reference and advance the draft once. Lost acknowledgement retries return the original entry without changing newer work.
- Historical edits change canonical facts while retaining workout membership and original targets. Deletion cascades references and leaves receipt tombstones. Initialization never recreates deleted observations or re-parents existing canonical links.
- Initialization retains raw archives and the one-time original active snapshot; verify `workout_reference_migration_v1` and `workout_reference_legacy_active_evidence_v1` for representative migrated accounts. Treat these snapshots as evidence, never a fallback data authority.
- Finish/discard rejects changed snapshots and cannot reopen a retired workout. Failed writes preserve prior valid facts/draft state.

Verify these with ordinary authenticated accounts and independent clients in staging before production. Repository tests run in throwaway databases; they cannot establish production policy correctness. Test Guided recovery and retries on the mobile browsers actually supported by the product, including interruption and suspension. The local preview requires Web Locks; Quick form recovery across reload and a full offline outbox are not introduced here.

## Local verification commands

```sh
npm test
npm run typecheck
npm run build
bash supabase/tests/run-phase1.sh
bash supabase/tests/run-phase3.sh
```

The SQL harnesses own temporary PostgreSQL clusters with private sockets and cannot connect to a deployed database. The Phase 1 harness checks its original contracts before an upgrade; the Phase 3 harness checks that upgrade, fresh installation, authority failures, atomic rollback, migration preservation, and independent-client races. Preserve the retained documents/checkpoints during rollback; deploying an older client does not authorize downgrading protections or reconstructing observations from legacy copies.
