# GROWTH

A local-first strength analytics tracker built with Expo, React Native, TypeScript, Zustand, and SQLite.

The app focuses on individual strength-exercise progression, not just workout logging:

- Log exercises, sets, reps, weight, and notes
- Register and log in with a local-only account
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

SQLite is used on native platforms. The web preview uses a localStorage adapter so the app can be inspected in a browser without SQLite WASM setup.
