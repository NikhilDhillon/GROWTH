# GROWTH

A strength and body-progress tracker built with Expo, React Native, TypeScript, Zustand, and Supabase.

[Live site](https://growth-lift-tracker.vercel.app) — the local work described here has not been deployed.

- Home, Record, Progress, and History, with supporting tools under More.
- Neutral ChatGPT-style light/dark colors that follow the system appearance automatically, including live changes.
- Guided and Quick workout recording with recoverable input drafts.
- Day templates remember their exercises and order. Flow mode (Settings → Workout logging) turns a started workout into a full-screen focus flow: each set starts from your last session and is set on a rolling thumb dial (momentum, settle, haptic ticks), Done logs it and starts rest, and each finished exercise saves itself and opens the next. A top-bar note button adds a note to the current exercise. Classic keeps the editable set list. Each set records when it was captured and how (`typed`, `flow`, `planned`).
- Personal exercises for movements the catalog lacks, added from any exercise search with their own load type. Split-sync friends can use them; leaderboards stay catalog-only.
- Daily bodyweight and optional sparse tape measurements in one check-in.
- Versioned Performance Points: first eligible session per exercise/equipment context = 100; 45% strength, 35% working volume, 20% fatigue resistance. Absolute observations remain visible.
- Fixed aggregate cohorts with coverage and freshness; bodyweight estimates use prior observations up to 14 calendar days old.
- Friend comparisons from narrow, portable exercise projections; private notes, machine tags, and body observations stay private. Shared plans require direct consent.
- Atomic, account-bound imports with provenance, duplicate protection, and actual committed counts.

## Development

```sh
npm ci
npm run web
npm test
npm run typecheck
npm run build
```

The web export is written to `dist/`. `vercel.json` supplies filesystem-first SPA rewrites so deep links and draft recovery survive reloads. Native development uses `npm run ios` or `npm run android`.

## Implementation and rollout

- [Phases 2–3 domain and recording](PHASE2_DOMAIN.md), [recording lifecycle](PHASE3_RECORDING.md)
- [Phases 4–5 status](PHASE45_PROGRESS.md)
- [Import behavior](PHASE6_IMPORT.md), [sharing contracts](supabase/PHASE6_SOCIAL.md)
- [Phase 6 deployment order](supabase/PHASE6_DEPLOYMENT.md)
- [Set capture evidence deployment](supabase/SET_CAPTURE_DEPLOYMENT.md)
- [Personal exercises deployment](supabase/PERSONAL_EXERCISES_DEPLOYMENT.md)
- [Phases 6–7 verification](PHASE67_COMPLETION.md), [cleanup audit](PHASE7_CLEANUP.md)

Apply migrations in documented order before releasing the matching cloud client. Local SQL harnesses under `supabase/tests/` create disposable databases and never verify deployed production state.

## Appearance

Color definitions stay separate from UI hooks: `src/utils/theme.ts` contains pure palette/spacing data, and `src/utils/themedStyles.ts` subscribes to system appearance and selects cached light/dark styles. Recording state and account navigation keys do not depend on appearance, so a theme change preserves open forms. Web inputs inherit `color-scheme`; native status bars and navigation colors adapt as well.

Expo is configured with `userInterfaceStyle: automatic` and the SDK-matched `expo-system-ui` package for Android. Native builds need to include this configuration. See [Expo's system theme guidance](https://docs.expo.dev/develop/user-interface/color-themes/) and [React Native's Appearance subscription](https://reactnative.dev/docs/appearance).
