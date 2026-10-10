# Phases 4 and 5

Local implementation is complete. This replaces the earlier pending-choice status: the user authorized the choices that best suit a growth model, and the approved choices below are implemented. Production rollout and physical-device acceptance remain separate checks.

## Phase 4: comparable growth

- First eligible session in each exercise/equipment context establishes Performance Points at 100. The 45/35/20 formula is versioned as `performance-points.first-eligible.v1`. Reports show absolute observations alongside current/start/best/change; session-relative feedback remains separate.
- Bodyweight-based estimation uses the latest prior observation at most 14 calendar days old. Training freshness is 30 calendar days. Comparisons use calendar dates and only evidence available at each cutoff.
- Aggregates retain a fixed eligible cohort, show coverage, and withhold results when members are missing or stale. Unversioned legacy scores cannot silently enter current growth calculations.
- Machine comparisons require the same private equipment context. Untagged machine entries remain standalone evidence, without invented growth baselines. Private tags never establish cross-user equipment equivalence.
- Warmups are excluded from working volume. Sparse tape channels retain their actual dates and side identity. Missing units and observations remain unknown, and insights avoid unsupported causal claims.

## Phase 5: recording and navigation

- Primary navigation is Home / Record / Progress / History, with More for supporting features. Browser URLs restore routes and report contexts; browser Back works. The top header back button was removed at the user's request.
- Home starts workouts from the saved weekly schedule as well as built-in templates. Guided capture prioritizes the current task; summaries resolve saved stable identities. Quick recording distinguishes previous-set suggestions from actual observations and has one Save action.
- Workout and body input drafts recover after interruption without automatic submission. Ambiguous acknowledgements freeze the attempted identity and payload; account changes cannot submit an old account's draft.
- Body Check-In records daily weight first and optional sparse tape channels. Whole edits/deletes use saved identity/snapshot authority; occupied dates cannot be blindly overwritten. Original input units and unchanged canonical precision are preserved.
- Charts have selectable touch/keyboard controls with persistent date/value/unit details. Progress exposes current/start/best/change and specialist reports. Searchable exercise selection replaces long scanning lists.
- The UI refinement requested during verification puts actions, values, and charts first. Secondary instructions and methodology are expandable. Errors, actual-versus-suggested distinctions, consent recipients and unavailable-result context remain visible.

## Verification and limits

See `PHASE67_COMPLETION.md` for the final combined checks. Local browser checks cover 320/390-pixel layouts, saved-plan starts, Quick recovery/save/history, chart selection/context persistence, browser Back, and daily body recovery/save. SQL harnesses verify fresh and upgrade schemas in disposable local databases.

No production migration or deployment was performed. Supported Safari/Chrome mobile keyboards and physical iOS/Android devices still require acceptance testing. Browser recording requires Web Locks and working local storage; unsupported storage fails visibly. Local historical data has no reliable multi-account ownership, so import refuses ambiguous local databases instead of assigning old records to an account. Recovery drafts are input evidence, never reporting sources or a background sync outbox.
