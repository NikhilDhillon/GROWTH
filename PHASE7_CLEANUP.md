# Phase 7 cleanup audit

This is a bounded cleanup audit of the current working tree. It records candidates and verification limits; it does not retire database evidence or compatibility behavior.

## Utility cleanup

The code-review graph reported no dead symbols in `src/utils/strength.ts` or `src/utils/analytics.ts`, but neither file currently exists in the checkout. No new utility modules were added: the existing date, unit, workout-history, calendar, and observation helpers already have callers across the app, and moving those contracts would create a broad import-only rewrite without removing meaningful duplication.

The graph flagged `daysAgoIso` in `src/utils/date.ts` as unused by production code. A repository search found its calendar test import and assertion, so it is retained. The date module's remaining helpers are imported by screens, services, constants, and adapters. No utility files were proven unused and deleted.

## Snapshot and legacy paths

The graph marks platform database exports as dead because it does not follow the dynamic platform adapters and store delegation. Repository searches confirm the app store exercises the database adapter APIs. The snapshot-specific findings were forwarded to the database/store owner: `syncScoreSnapshots` has no production call site in `src` (only its adapter definitions and test references), while the web adapter's `normalizeLeaderboardSets` and `findSnapshotSets` have no call sites. The two unused web-only helpers were removed after call-site verification. The exported snapshot sync API remains for compatibility. The Phase 1–5 rollout notes require preserving migration receipts, historical snapshots and legacy evidence until deployed migration state is verified.

## Dependency reproducibility

Runtime and development dependencies in `package.json` now use the exact versions already installed in `package-lock.json`, including Expo `55.0.24`, React Navigation Native `7.2.4`, Supabase JS `2.105.4`, and Vitest `3.2.7`. This pins the existing dependency set without upgrading it. Use `npm ci` for reproducible installation.

## Verification still required

- The checked-in SQL harnesses exercise isolated throwaway PostgreSQL databases. They do not establish which Phase 1–5 migrations, grants, policies, functions, or PostgREST schema cache are present in staging or production. Verify the actual deployed migration history and authority settings, then apply the documented migrations in order before releasing matching clients.
- Local browser capture/recovery, mobile-width layout, chart details and browser Back were checked with synthetic records. Supported Safari/Chrome mobile keyboards, account switching on actual devices and native devices still require acceptance checks. Component tests and local web export do not replace those checks.
- Web recovery depends on browser Web Locks and local storage. Verify interruption/reload behavior in the actual supported browsers; unsupported storage must continue to fail visibly before submission.
- The production rollout state and real legacy-record ownership/unit evidence remain unverified. Preserve ambiguous old observations and receipts until an explicit deployed-data reconciliation plan exists.

The final combined test, typecheck, build and SQL results are recorded in `PHASE67_COMPLETION.md`. Legacy snapshots, source rows, receipts and ambiguous ownership/unit evidence remain preserved. No production deployment occurred.
