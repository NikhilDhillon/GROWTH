# Phases 6 and 7: local completion

Phase 4/5 review repairs and the remaining Phase 6/7 implementation are complete locally. The UI refinement requested during verification is included. No hosted migration, production release, or physical-device acceptance is claimed.

## Delivered

Phase 6 adds narrow Social profile/performance projections, explicit direct split membership, complete relationship revocation, consistent portable comparisons, and saved-plan starts from Home. Imported records bind the initiating account, preserve known source units and RIR, commit atomically, skip occupied body dates, respect workout source identities/tombstones, and report actual inserted/skipped counts. Ambiguous local ownership refuses import visibly. See `PHASE6_IMPORT.md` and `supabase/PHASE6_SOCIAL.md`.

Phase 7 removes two proven unused web snapshot helpers, shares metric-version/freshness rules, pins installed dependency versions, adds Vercel deep-link rewrites, and updates stale phase/rollout documentation. Legacy evidence, snapshots, receipts and ambiguous ownership remain intact. Existing recording/recovery/deletion contracts were regression tested.

The UI now emphasizes the next workout, check-in and progress shortcuts, a compact weekly strip, prominent report values, and compact exercise selection. Optional notes, history and methodology use accessible expandable details. Errors, unavailable-result context, actual/suggested distinctions and named consent recipients stay visible. The top back button was removed as requested; browser Back and primary navigation remain. The requested neutral ChatGPT-style palette now follows system light/dark appearance through subscribed styles, navigation, status bar and web input colors. Appearance updates preserve open forms.

## Validation

- Vitest: **707 tests in 51 files passed** after the UI pass, including authority, retry, account-change, unit provenance, import, chart and navigation regressions.
- TypeScript and Expo web export passed. Diff whitespace checks passed.
- Phase 1/2 PostgreSQL: 102 safety assertions; domain/provenance, 6 concurrent-client scenarios, 7 catalogue repeat-install preservation checks, body migration and ambiguous-migration rejection checks passed.
- Phase 3 PostgreSQL: 70 lifecycle assertions on both upgrade and fresh paths; concurrent draft/receipt checks passed.
- Phase 5 PostgreSQL: 34 assertions each upgrade/fresh, plus 4 concurrent checks passed.
- Phase 6 import PostgreSQL: 14 import + 4 race assertions on each upgrade/fresh path passed.
- Phase 6 sharing PostgreSQL: 24 assertions on each upgrade/fresh path passed, including direct-consent boundaries, revoked access, narrow fields and preservation of malformed legacy data.
- Rendered local browser: 320/390-pixel checks with synthetic records; saved-plan starts, Quick draft reload, rejection of unentered suggested loads, canonical save/history, Progress charts and context reload, browser Back, daily body draft reload/save, and compact disclosures. Optional notes survived collapse/reload and saved into the same check-in without losing weight or creating a duplicate. Search remained reachable from the compact exercise selector. The local theme harness simulated light/dark media-query changes without changing the computer’s settings: mounted colors updated and a body draft retained its entered value. Theme tests verify switching, cached styles and normal text/status contrast of at least 4.5:1 in both modes.

The code-review graph was used before exploration and again for review. It omits several new untracked modules/tests; executed tests provide their coverage evidence. SQL harnesses use private disposable databases, not production URLs.

Mobile preview screenshots are saved under `artifacts/ui-review/`. The preview uses synthetic local records, separate from cloud accounts.

## Rollout checks

Apply migrations in `supabase/PHASE6_DEPLOYMENT.md` order before the matching client. Verify the target migration history, authenticated grants/RLS, PostgREST schema cache, hosted deep-link reloads, and Social disconnect behavior in staging. Check actual Safari/Chrome mobile keyboards and physical iOS/Android devices. These require the target environment and devices and remain outstanding.

## Design references

The action/set/previous-result hierarchy follows patterns documented by [Hevy's workout tracking page](https://www.hevyapp.com/features/track-workouts/) and [workout history overview](https://www.hevyapp.com/features/best-way-to-track-workouts/). Prominent progress values and charts were informed by [Fitbod's Insights overview](https://fitbod.me/blog/fitbod-insights-feature/). These are design references; GROWTH retains its own data contracts and visual theme. Hosting behavior follows [Vercel's SPA rewrite guidance](https://vercel.com/docs/routing/rewrites), and SQL authority follows [Supabase function guidance](https://supabase.com/docs/guides/database/functions).

### Approved UI simplifications — October 10

- Removed manual exercise enablement from the library and all recording/report pickers. Quick and Guided select from the full catalog; Guided infers muscle from the exercise without rewriting the weekly split.
- Home starts today's planned session directly; alternative routines stay available through Choose another workout, with start/draft recovery retained.
- Direct numeric weight entry is available for barbells. The optional Load plates tool shows the entered target and achievable plate total, and retains explicit apply and performed-confirmation actions.
- Progress has Strength and Body destinations. Weight and tape history share Body; comparison is contextual and carries the chosen exercise/equipment context. Old report URLs still resolve.
- Strength leads with best/latest estimated 1RM and its change. Points and explanations are secondary. Charts use metric selectors; tape sides remain separate selectable series.
- Removed performance-per-weight-gained UI. Retained underlying calculations for compatibility.
- More contains only Exercises, Social, Settings; Guided preferences remain inside Settings.
- Verification: 716 tests across 54 files, TypeScript, web export, navigation/body-history interaction checks, and localhost browser review passed. Native device testing and remote rollout remain separate.
