# Phase 6: direct sharing authority

Phase 6 limits social reads to explicit direct relationships and keeps private workout context inside the owner boundary. This migration has not been deployed.

## Sharing contracts

- `social_profiles()` returns the caller and direct pending or accepted friendship participants as `{ id, name, created_at }`. It never returns profile email. Direct profile table reads remain owner-only.
- `social_performance_records()` returns `{ sessions, sets }` for the caller and accepted direct friends. The session projection is `id`, `user_id`, and `workout_date`. The set projection is `id`, `user_id`, `session_id`, `exercise_id`, `set_number`, `reps`, `weight`, and `is_warmup`.
- Performance rows are limited to canonical catalog exercises whose app load type is portable external load. Machine stacks, cable exercises, bodyweight-dependent exercises, unknown names, and mixed-exercise sessions are excluded. Notes, private machine tags, and body observations are not in the RPC response.
- Workout session, set, profile, and leaderboard snapshot SELECT policies are owner-only. Friends use the narrow performance RPC and the name-only profile RPC.
- `get_split_sync_members()` returns `{ user_id }` rows for the caller and each directly accepted split-sync partner whose friendship is also accepted. A returned member list never walks through another member's connections.
- Split requests remain bilateral. Requesting a pair creates a pending row, the addressee accepts it, and removal changes only that pair to declined under the existing global relationship advisory lock. A friend-of-a-friend receives nothing without their own accepted pair row.
- New shared split values contain exactly seven weekday objects with canonical weekday keys and labels. Each `muscles` array contains unique valid names. Legacy split JSON remains preserved; malformed requests and saves fail before writing.

The app adapter must call the three social projection functions and normalize `social_profiles()` rows to its profile shape with an absent/null email. The caller's own email remains available from the authenticated user record or its owner-only profile row. Do not fall back to direct friend session/set/profile table reads.

## Verification

Run `supabase/tests/run-phase6-sharing.sh` for the isolated local PostgreSQL test. The script creates and destroys its own throwaway cluster. The SQL assertions cover direct A-B and B-C consent, no A-to-C propagation, disconnect behavior, owner-only raw rows, narrow projections, anonymous/authentication checks, canonical exercise filtering, and split shape validation.

Apply the migration before shipping app adapters that depend on these RPCs. No production database has been changed by this work.
