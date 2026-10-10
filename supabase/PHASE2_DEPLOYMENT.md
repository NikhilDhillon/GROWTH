# Phase 2 deployment notes

No production or staging Supabase instance was updated during this implementation.

Apply `migrations/20261008000000_phase2_domain_contract.sql` **after** `20261004000000_phase1_record_safety.sql`. Read the Phase 1 preflight and deployment notes as well. The updated `schema.sql` represents the combined fresh-install schema; do not reapply an older Phase 1 function definition after Phase 2 without reapplying the Phase 2 migration.

Before deploying, export a recoverable owner-scoped database/settings backup. Verify ownership, foreign keys, policies/grants (including permissive inherited policies), function owner/search-path privileges, and the actual migration history against the deployed schema. This local repository cannot establish that production matches the checked-in baseline.

The additive session columns `input_unit` and `recording_origin` are nullable. Existing rows remain unchanged. Units describe the current observation revision; origin describes capture, not a mutable classifier. New set writes preserve unobserved RIR as NULL. No archive sets, old units or owners are inferred or backfilled.

`save_workout_session` gains trailing optional `p_input_unit text` and `p_recording_origin text` parameters. Old positional/named calls continue through defaults. The obsolete seven-parameter overload is removed to avoid ambiguous default-argument resolution. Explicit new provenance contributes to the idempotency hash. Legacy hash receipts remain retryable without changing their metadata or observations; edited/deleted records keep the Phase 1 behavior. Missing RPC/parameter availability must fail closed; refresh the PostgREST schema cache and verify the new signature before deploying the new client.

`import_training_data` preserves declared workout units, origin, warm-up flags and NULL RIR. Content matching includes warm-up status while preserving old no-warm-up fingerprints. The full import/deduplication/restoration redesign remains Phase 6.

`finalize_active_workout` retains the Phase 1 locking, expected-snapshot, ownership, retirement and atomicity rules. Its merge preserves all unrelated raw archive records instead of limiting migration evidence to 50. Retention growth must be handled through verified reference migration and pagination in later phases, not automatic deletion of unresolved records.

Run `bash supabase/tests/run-phase1.sh` for the combined isolated SQL checks. It creates and removes a throwaway local PostgreSQL cluster, uses no existing server, applies both migrations, and checks consent/revocation, failure rollback, concurrent retries, explicit provenance, old receipt compatibility, raw archive retention, body migration retirement, and repeated schema preservation. This is not a production-policy verification or a live PostgREST/mobile smoke test.
