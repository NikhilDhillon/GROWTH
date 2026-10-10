# Phase 3: recording lifecycle

This milestone follows the Phase 2 domain contract. It keeps Quick, Guided, and History layouts and the existing Performance Points formulas. Navigation, Progress, Body Check-In, Social, and broad import redesign remain later work.

## Approved decisions

1. Keep Quick and Guided layouts and share capture validation and persistence contracts.
2. Give workouts stable IDs. Migrate grouping only from verified explicit legacy entry links. Preserve unresolved evidence.
3. Reject stale active-draft saves. Keep the newer saved draft and retain the rejected candidate for recovery; never automatically overwrite or merge conflicting entered values.
4. Compare each prescribed working set with observed reps and load. External/added loads must meet or exceed the target; assistance must meet or be below the target. Warmups are excluded. Absent numeric targets are not evaluable.

## Authority

- `workout_sessions` and `workout_sets` remain the sole authority for performed observations. Numeric entry/set IDs are preserved.
- `workout_records` contains lifecycle/planning metadata. `workout_entry_references` associates an entry with exactly one workout and optionally retains its original prescription. Neither contains another copy of performed sets.
- Quick records create standalone workout metadata. Guided records join the stable active workout. Historical edits retain entry identity and membership; reports resolve current canonical observations. Deletion removes membership but retains metadata and receipt tombstones.
- After reference initialization, legacy archive/route copies cannot establish new grouping. Unknown or conflicting historical membership stays ungrouped and available for reconciliation. No date/name/value matching or inferred units/owners are introduced.
- Old retry receipts are preserved. Retrying cannot move an existing canonical entry to another workout, recreate deleted observations, or invent previously unrecorded provenance. Unresolved legacy attempts may require explicit reconciliation.

## Capture and concurrency

`prepareWorkoutObservations` supplies the same date, exercise, load, unit, and set validation for Quick, Guided, and History. Guided confirmation remains tied to the exact entered values and recording context; suggestions alone cannot be submitted as performed work.

`recordWorkoutEntry` commits the session, sets, retry receipt, membership, and Guided draft advancement together. Cloud RPCs use owner-scoped transaction locks; SQLite uses exclusive transactions. The local browser adapter coordinates every database-document mutation with the same Web Lock and commits each recording through one storage replacement. Unsupported local browsers fail explicitly; they do not fall back to uncoordinated writes. Cloud operation does not depend on Web Locks.

Active Guided drafts carry `workoutId` and `revision`. A candidate must match the saved revision; an identical retry returns the saved revision without advancing it again. A conflicting candidate is durably retained before rejection. SQL returns a committed conflict result rather than raising after inserting recovery data, which would roll back the recovery. Recording retries check committed receipts before newer-draft checks so a lost acknowledgement cannot clear the next exercise.

The store keeps unsaved local changes distinct from the saved concurrency baseline. Hydration never silently rebases dirty input onto a newer remote revision. Finishing requires a clean, reviewed draft and the exact saved snapshot. UI normalization may add legacy defaults; those defaults do not become historical evidence just because a draft was loaded. Recovery panels remain accessible for active, rest-day, and ended workouts. Recovered values are draft evidence, not completed observations.

Quick and History forms bind entered numbers to their displayed unit, so a preference change cannot silently reinterpret an open form. Quick retains its request identity during an in-page pending save and uses the same atomic recording boundary. This milestone does not add an offline outbox or persistence of an unsubmitted Quick form across a reload/navigation interruption. Historical editing uses shared validation and atomic replacement; active-draft revision checks do not introduce a separate historical edit-revision system.

## Migration and evidence

`workout_reference_migration_v1` retires opportunistic regrouping. Its initialization is atomic and idempotent. Existing canonical links created before initialization take precedence; ambiguous legacy groups remain standalone. Deleted observations stay deleted on subsequent startup.

Original archive documents are retained. The original active draft is also retained once, before identity normalization, so later editing or retirement cannot destroy unresolved legacy evidence:

- Cloud/SQLite: `app_settings.workout_reference_legacy_active_evidence_v1`.
- Local browser: `workoutActiveMigrationEvidence` in the existing database document.

These retained snapshots are reconciliation/rollback evidence only. They are never consumed as observations, recommendations, current drafts, or workout membership. Cloud clients cannot rewrite or delete the protected migration/recovery settings.

## Target comparison

A Guided draft freezes its numeric prescription and equipment context. Recording retains that prescription on the canonical entry reference. Summary compares current recorded sets with those original targets, including after an edit. New preferences or recommendations cannot alter that historical target. Changed exercise/load type/equipment makes comparison unavailable instead of substituting a new target. Working-set ordinals remain stable when warmups are inserted. Top-set and back-off blocks retain their separate feedback.

See `supabase/PHASE3_DEPLOYMENT.md` for installation and deployment verification. Local checks do not prove the deployed schema, privileges, or real-device browser behavior.
