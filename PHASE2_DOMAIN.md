# Phase 2: canonical domain and migration contracts

This milestone defines the domain and safely projects existing records into it. It does not introduce the shared recording lifecycle planned for Phase 3, change growth formulas, redesign navigation, or perform a destructive historical migration.

## Authority and identity

- `workout_sessions` is the compatibility name for **exercise entries**. Its numeric ID remains the recorded entry identity. `workout_sets` owns performed reps, canonical load, and warm-up status. A full workout references entry IDs and contains lifecycle/planning metadata, never another set of observed numbers.
- `src/domain/workoutHistory.ts` reconstructs full guided workouts only from explicit `sessionId` references whose recorded exercise identity agrees. A legacy entry not linked to a verified group remains a standalone workout (`session:<id>`). Group identity remains the existing guided `startedAt` identity for compatibility; a future durable aggregate migration must explicitly map it rather than regenerate IDs from dates or labels.
- An exercise entry occurs once in full history. Conflicting group claims, mixed-exercise legacy sessions, missing/deleted entries, invalid facts, orphan sets, and unlinked legacy archives are reconciliation issues. The projection never synthesizes observations from archive copies or matches by date, name, reps, or weight.
- Summary, completed guided cards, and guided archive counts use linked recorded entries. Editing/deleting a session changes their observation totals. An unavailable refresh remains a data-loading error with a retry path; route copies are not a fallback authority.
- Browser observation counters persist high-water marks for entry, set, and check-in IDs. Existing archive references reserve their IDs even if their sessions no longer exist. Earlier browser ID reuse cannot be retroactively disproven; suspicious legacy links require reconciliation against a backup, not invented certainty. Cross-tab concurrent storage writes still need the Phase 3 concurrency contract.

## Observation and recommendation contracts

`src/domain/types.ts` distinguishes `Workout`, `ExerciseEntry`, `ObservedSet`, `Prescription`, `BodyCheckIn`, `WorkoutTemplate`, `ScheduledDay`, and `ComparisonContext`.

One or more explicitly entered sets can be recorded, including warm-up-only entries. Empty spare rows are ignored; partially entered rows fail validation. Reps must be positive whole numbers, external load positive, and bodyweight added load/assistance explicitly non-negative. Blank load never means performed zero. Guided capture still requires the Phase 1 confirmation tied to the exact values, exercise, date, machine, and unit.

Logging validity is independent of Performance Points eligibility. The existing metric still requires at least two working sets and the effective load/bodyweight context it previously required; formulas are unchanged. The parser and eligibility helper are separate contracts. New writes keep unobserved RIR `NULL`; old software-written zeroes are preserved and projected with unknown provenance.

Archived guided outcomes remain historical guidance context; they are not recalculated from today's preferences or treated as current achievement facts. Personal-best feedback uses the explicitly linked score entry. Actual prescription/observed-load achievement evaluation is Phase 3 work.

## Dates, units, body and planning

- New writes/imports require real calendar dates in `YYYY-MM-DD`, years 0001–9999. Invalid dates are rejected, never silently replaced with today. Calendar offsets/weekday selection operate on date-only values, including leap days and daylight-saving boundaries.
- Recording retains the existing explicit `America/Vancouver` day convention. Weekly selection now uses that same day. Changing the product timezone policy and migrating historical reporting windows is a separate decision; this phase does not rewrite old dates. Existing synthetic noon `created_at` values are not reliable evidence of an actual recording instant.
- Workout loads remain canonical pounds; body weight remains pounds and tape measurements centimetres. New workout revisions record `input_unit`, and new captures/imports record `recording_origin`. Missing historical metadata stays `NULL`/unknown. Display preferences never establish historical input units.
- Editing replaces the input-unit metadata for the current recorded revision but preserves capture origin. Old clients with no unit evidence clear the revised unit to unknown. Old ambiguous retry receipts return their original ID without retroactively assigning newly supplied provenance. New receipts include explicit provenance in their payload identity.
- `body_measurement_logs` remains the authority for a body check-in; weight-only history is a projection. The Phase 1 migration retirement remains durable. `projectBodyCheckIns` preserves bilateral measurements and represents unknown source units honestly. Durable body input-unit metadata and shared check-in capture are later work.
- Built-in templates have explicit stable IDs separate from weekdays. New Home drafts retain their chosen template ID. Legacy weekly splits can be projected as `legacy-weekday:<weekday>` templates and `weekday:<weekday>` schedules without claiming old days shared a reusable template or rewriting their settings. Template/schedule consolidation remains later work.
- Comparison contracts require metric/version, baseline, calendar range, equipment, freshness, and coverage. Existing reports have not yet been migrated to these contracts; Phase 4 owns their calculation behavior.

## Historical migration rules

1. Take recoverable backups of cloud tables, app settings, and local browser/SQLite data before any deployed migration. Include archived metadata, legacy body tables, receipts, and retirement checkpoints.
2. Apply the additive provenance migration after Phase 1. It creates no historical observations and assigns no historical units or owners. Verify the deployed authority policies separately; local tests are not deployment evidence.
3. Run the read-only history projection on an owner-scoped dataset. Preserve the original raw archive document alongside its issue report; `workoutArchiveEvidence` is a runtime view of the same stored document, not an additional persisted source.
4. Verified explicit links may populate a future durable workout/entry-reference schema. Store lifecycle metadata separately from observations and preserve original archive evidence until the new references and rollback are verified. Never use date/name/value matching to infer a missing link.
5. Unlinked, conflicting, malformed, or mixed-exercise records remain available for explicit reconciliation. Missing sessions remain missing. Reconciliation cannot recreate deliberately deleted observations or guess local account ownership/units.
6. Keep legacy body originals and Phase 1 completion checkpoints. No recurring fallback or guessed conversion is reintroduced. Unknown-unit measurements require explicit reconciliation.
7. Only retire copied compatibility documents after their linked replacement, issue handling, recovery, and all readers/writers are verified. Archive retention is no longer capped at 50 during this transition, so completing or making an unrelated save cannot prune unresolved evidence. Previously pruned metadata cannot be recovered from this repository alone.

## Scope and next milestone

Phase 3 should introduce durable workout aggregate references, shared quick/guided/history capture, revision-aware drafts, and explicit actual-load achievement rules using these contracts. Until then, legacy active/archive JSON is retained for lifecycle/planning compatibility; its copied observation fields are ignored by completed-work views. No observations, units, ownership, or grouping are automatically fabricated to make this migration appear complete.
