# GROWTH

A web-based strength analytics tracker built with Expo Web, React Native, TypeScript, Zustand, and Supabase.

Live site: https://growth-lift-tracker.vercel.app

The app focuses on individual strength-exercise progression, not just workout logging:

- Log exercises, sets, reps, weight, and notes
- Register and log in with Supabase Auth
- Calculate estimated 1RM with `weight x (1 + reps / 30)`
- Score eligible failure-set sessions using best e1RM, failure-set volume, and fatigue resistance
- Calculate Performance Points as `100 x (0.45 strength + 0.35 volume + 0.20 resistance)` normalized against the prior best-strength session, with rolling 7/30/365-day progress compared to the preceding equal-length period
- Rank friend exercise leaderboards using best estimated 1RM
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
