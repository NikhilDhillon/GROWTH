# GROWTH

A strength analytics tracker built with Expo, React Native, TypeScript, Zustand, Supabase on web, and SQLite/localStorage fallbacks.

The app focuses on individual strength-exercise progression, not just workout logging:

- Log exercises, sets, reps, weight, and notes
- Register and log in with Supabase Auth on the published website
- Calculate estimated 1RM with `weight x (1 + reps / 30)`
- Score each set with rep-quality multipliers
- Apply diminishing set-importance weights
- Normalize by square root of set count to prevent inflated high-set scores
- Mark selected exercises as strength exercises
- Show graphs and PRs for each strength exercise

## Run

```sh
npm install
npm run web
```

For iOS:

```sh
npm run ios
```

## Structure

```text
src/
  components/
  database/
  screens/
  services/
  store/
  types/
  utils/
```

## Supabase website setup

1. Create a Supabase project.
2. Open the Supabase SQL editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill in:

```sh
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

4. For Vercel or Netlify, add the same variables in the hosting dashboard.

When those variables are present, the web app uses Supabase Auth and cloud tables. Without them, web preview falls back to browser localStorage.

Password reset checks `public.profiles` before sending a reset email. If you update `supabase/schema.sql`, rerun it in Supabase SQL editor so the helper function stays current.

SQLite is still used on native platforms.
