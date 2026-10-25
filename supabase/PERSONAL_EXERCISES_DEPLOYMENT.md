# Personal exercises deployment

No deployed Supabase schema or production data was changed during this implementation.

## What it adds

- `exercises.creator_id`, `load_type` and `display_name`. Catalog rows keep all three null and are unchanged.
- A personal exercise stores a hidden unique key in `name` (`personal:<id>`) and the name people see in `display_name`. The catalog's unique `name` index, every `on conflict (name)` statement and the leaderboard name list therefore keep working unchanged. The app shows `display_name` when it loads cloud exercises.
- The column is named `creator_id`, not `owner_id`: `finalize_active_workout` has a variable called `owner_id`, and a column with that name made its query ambiguous (the Phase 3 suite caught this).
- `create_custom_exercise(name, primary_muscle, load_type)` is the only way to add one.
  - It cleans the name.
  - It refuses catalog names, ignoring case.
  - A retry with the same name, muscle and load type returns the existing exercise; a retry that differs is refused.
  - Each account can keep up to 200.
- **Visibility.** The exercise read policy keeps its historical name, "standard exercises are readable by authenticated users". It now admits:
  - catalog rows;
  - your own personal exercises;
  - personal exercises of mutually accepted split-sync friends;
  - any personal exercise you have already logged.

  Access to a logged exercise is recorded in `custom_exercise_access`, so history keeps its name after a friend stops syncing. Clients cannot read that table.
- **Write check.** A trigger on `workout_sets`, `user_exercise_preferences`, `muscle_strength_config` and `leaderboard_score_snapshots` refuses any row whose exercise its user may not use.
- **Leaderboards.** `social_performance_records` excludes personal exercises even if a later catalog entry shares their name.

## Installation

1. Apply `migrations/20261025000000_personal_exercises.sql` after all earlier migrations. It is safe to rerun and does not depend on the set capture migration.
2. A fresh installation uses the current `schema.sql`, which includes it. Reinstalling `schema.sql` over a database that already has personal exercises keeps them.
3. Apply the migration before or together with releasing the client.
   - **New client, old database:** creating an exercise fails with a visible error. Everything else keeps working.
   - **Old client, new database:** an app still open from before the release shows a personal exercise by its hidden key until it reloads.

## Local verification

```sh
bash supabase/tests/run-personal-exercises.sh
```

The harness owns a throwaway PostgreSQL cluster and checks three paths:
- **Upgrade:** the schema at commit `f6a566f`, then set capture, then this migration applied twice.
- **Reinstall:** `schema.sql` run again over two accounts that share a personal exercise name.
- **Fresh install:** the current `schema.sql` on an empty database.

It cannot verify the deployed project.
