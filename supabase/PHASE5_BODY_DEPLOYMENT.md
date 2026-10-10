# Phase 5: whole body check-in authority

The checked-in implementation and disposable database tests do not establish that these changes are deployed. Apply `20261009000001_phase5_body_check_in.sql` after the Phase 1, 2 and 3 migrations, before releasing the client that calls the new body RPCs. Fresh installations use the matching block in `schema.sql`; do not install old migration definitions over the latest fresh schema.

## Deployment and verification

1. Back up `body_measurement_logs`, legacy `body_weight_logs`, app settings including body migration checkpoints, and local browser/SQLite storage. Preserve unknown historical values and input-unit evidence.
2. Apply the additive migration. It adds nullable `weight_input_unit` / `circumference_input_unit`; existing rows stay unknown. It creates the private owner-scoped receipt table, protected RPCs, and a trigger that retires changed legacy input-unit metadata. It does not create, merge, delete, or convert historical observations and does not change the Phase 1 legacy migration retirement.
3. Check deployed function definitions, execute grants, RLS and receipt privileges. Anonymous callers must not execute the new RPCs; authenticated callers must not directly read/write receipts. Both functions derive ownership from `auth.uid()`.
4. Verify owner-scoped create, occupied-date rejection, exact-snapshot edit, stale edit, whole delete, account-switch rejection, duplicate retry and retry after deletion using test accounts. Confirm failure messages retain entered values and do not acknowledge an unsuccessful write. Check fresh/current row timestamps and nullable input provenance.
5. Release the client only after the RPCs are available. The new client deliberately fails with a migration-required message rather than falling back to an unsafe upsert.

## Contracts

`record_body_check_in(p_input jsonb)` accepts canonical pounds/centimetres plus explicit input display units, a stable UUID attempt ID, optional bound account identity and, for edits, the exact saved snapshot. Each owner has at most one check-in per calendar date. A new capture at an occupied date rejects; an edit must explicitly select the existing row and snapshot. An edit replaces the whole observation, including deliberate blank-field removal.

The saved snapshot includes ID, date, weight, complete tape values, notes, updated timestamp and nullable input-unit provenance. Malformed or extra historical tape values that were hidden by a UI normalization cannot authorize an edit. Such records require explicit reconciliation; they are preserved. An unrelated browser body capture/deletion preserves the other raw body rows.

The observation and attempt receipt commit together. Owner locks and row locks serialize concurrent new-client capture/edit operations. A completed attempt returns the current surviving row on retry, without restoring older values. Deleted receipts retain their original identity; an old retry never recreates deleted facts. Browser storage similarly commits one locked document and includes receipt IDs in its durable observation high-water mark.

Input provenance describes observed fields, rather than assigning today's display preference to history. Unchanged old numbers retain unknown units. New weight has its explicit unit. A tape row containing both unchanged unknown values and new values remains unknown as a whole; a mixture of recorded input units remains unknown. Empty tape has no tape unit. Weight-only daily captures contain no implied tape observations or carry-forward tape values.

`delete_body_check_in(p_id bigint,p_expected jsonb,p_expected_account uuid)` removes the entire owner-scoped check-in and its weight projection. The final two arguments default to null for compatibility. The current client supplies its saved snapshot and initiating account; a supplied stale snapshot or changed account rejects. Missing/deleted rows are an idempotent no-op; receipt tombstones and body migration retirement prevent capture retries or legacy normalization from restoring them.

## Compatibility and limits

Existing owner-scoped direct body writes, import behavior and partial-deletion RPCs remain for compatibility. The new combined UI uses the whole-check-in APIs. Legacy changes that lack source evidence clear provenance only for fields whose facts changed; unchanged metadata is preserved. Native/browser legacy weight helpers can retain explicit input units, while cloud legacy updates conservatively become unknown because a database trigger cannot distinguish an unchanged metadata column from a unit explicitly re-entered with the same value. The new RPC supplies its conservative units under a transaction-local flag, restored before it returns.

New-client snapshot checks catch legacy edits to actual values even if an older writer leaves `updated_at` unchanged. Older clients retain their historical write behavior; a simultaneous legacy upsert can still change an observation after a new-client transaction completes. Retiring those compatibility writers and direct write privileges requires a coordinated client deployment. No offline synchronization/outbox or production policy verification is implied by this migration.

Browser capture drafts require Web Locks and working local storage. Storage failure blocks submission and is shown to the user; malformed or inconsistent retry evidence is preserved for explicit recovery. Native drafts use exclusive SQLite transactions. Drafts and new operations bind the initiating account, including deletion after confirmation, but existing native/preview historical observations have no reliable per-account ownership field. This milestone does not invent ownership or migrate those older facts between accounts.

## Local verification

`bash supabase/tests/run-phase5.sh` owns an isolated PostgreSQL cluster and cannot connect to deployed Supabase. It checks 34 body invariants against both a Phase 3 upgrade and the latest fresh schema, plus four assertions using independent concurrent clients. Tests inject failure after observation mutation at receipt insertion to prove complete rollback, including edits. Browser/native adapter regression tests cover storage failures, repeated taps, occupied dates, stale/deleted observations, account changes, unknown-unit preservation, raw evidence preservation and cloud RPC routing. The full client suite at this milestone passes 547 tests across 39 files; TypeScript and the isolated preview web export pass. Existing Phase 1/2/3 SQL harnesses also pass. Authenticated rendered mobile-device verification remains outstanding.
