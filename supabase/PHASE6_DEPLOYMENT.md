# Phase 6 rollout

No hosted database or production client was changed in this work. Before release, inspect the target migration history and apply missing migrations in this order:

1. `20261004000000_phase1_record_safety.sql`
2. `20261008000000_phase2_domain_contract.sql`
3. `20261009000000_phase3_recording_lifecycle.sql`
4. `20261009000001_phase5_body_check_in.sql`
5. `20261010000000_phase6_import_results.sql`
6. `20261010000001_phase6_sharing.sql`
7. `20261010000002_import_sibling_exercises.sql` — re-creates `import_training_data_v6` so every exercise of a multi-exercise external workout is imported. Safe to apply whether or not migration 5 is already live; it changes no stored rows.

Fresh installations use `schema.sql` and the standard exercise catalogue. The schema includes both Phase 6 migration bodies. Deploy the RPCs and policies before the matching client; refresh the PostgREST schema cache as required by the hosted environment.

## Changes to verify in staging

- `import_training_data_v6` binds `auth.uid()` to the expected initiating account, commits atomically, preserves input units and RIR, skips occupied body dates, and returns actual inserted/skipped counts. Failed batches roll back. Workout external IDs remain source identities across source edits and deletion; content-only imports retain content-based duplicate behavior.
- Social uses `social_profiles`, `social_performance_records`, and `get_split_sync_members`. Raw friend access to profiles, workout rows and snapshots is removed. Owner records remain accessible; no historical records are deleted.
- Shared plans update only explicitly accepted direct relationships. A–B and B–C consent does not imply A–C consent. Removing a friend removes associated sync access. Existing malformed legacy splits remain preserved, but future writes must satisfy the complete weekly contract.
- Old clients using raw friend queries require the new client for Social. The new import client fails visibly if its RPC migration is missing.

Run all checked-in SQL harnesses locally, then verify actual authenticated owner/friend/pending/unrelated account behavior against staging. Test disconnect, reconnect, import retry after interruption, account switching, and deep-link reload. Verify grants, RLS and function search paths rather than relying only on migration filenames.

The definer functions use an empty search path with qualified relations and authenticated access checks, following [Supabase database function guidance](https://supabase.com/docs/guides/database/functions) and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). Web deep-link rewrites follow [Vercel's SPA rewrite guidance](https://vercel.com/docs/routing/rewrites).
