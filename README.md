# GROWTH

A web-based strength analytics tracker built with Expo Web, React Native, TypeScript, Zustand, and Supabase.

Live site: https://growth-lift-tracker.vercel.app

The app focuses on individual strength-exercise progression, not just workout logging:

- Log exercises, sets, reps, weight, and notes
- Register and log in with Supabase Auth
- Calculate estimated 1RM with `weight x (1 + reps / 30)`
- Score each set with rep-quality multipliers
- Apply diminishing set-importance weights
- Normalize by square root of set count to prevent inflated high-set scores
- Mark selected exercises as strength exercises
- Show graphs and PRs for each strength exercise

## Web Development

```sh
npm install
npm run web
```

The local web app runs with Expo at a localhost URL such as:

```text
http://localhost:8083
```

## Web Build

```sh
npm run build
```

The production web export is written to `dist/`.

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
