# Android app

The Android app is the website's app with a few phone extras. It runs the same cloud data layer (`src/database/*.android.ts` re-export the `.web.ts` modules), so accounts, friends, split sync and leaderboards match the website. `src/platform/polyfills.native.ts` supplies browser storage (SQLite-backed `localStorage`) and Web Crypto. Rests in flow mode count down in an ongoing notification with a progress bar, and an alert sounds when the rest is over (`modules/rest-timer`). On Android 16 the countdown also shows as a Live Update in the status bar.

The app ID is `app.growthstrength`. It cannot change once the app is on Google Play.

## Build an APK to install

Needs the Android SDK and JDK 17. Release builds read the Supabase URL and anon key from `.env.production.local` (gitignored):

```sh
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Then:

```sh
npx expo prebuild --platform android
cd android && JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ./gradlew assembleRelease
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`. It is signed with the debug key, so it is for testing only. An APK from another machine cannot update it; uninstall first.

## Publish on Google Play

`eas.json` has a `preview` profile (an APK to share) and a `production` profile (an app bundle for Play, version codes counted by EAS).

1. `npm install -g eas-cli`, then `eas login` and `eas init` to link the project.
2. Add the two `EXPO_PUBLIC_SUPABASE_*` values with `eas env:create` for the `preview` and `production` environments.
3. `eas build --platform android --profile production`. EAS creates and keeps the upload key.
4. Create the app in Play Console and upload the first bundle by hand. Later builds can go up with `eas submit --platform android --profile production` (internal testing track).

Play also needs these before review:

- In-app account deletion, plus a web page for it. The app has neither yet.
- A privacy policy URL, the Data safety form (account email, workout and body data, sharing with chosen friends) and the Health apps declaration.
- The foreground service declaration: the rest timer uses `specialUse` to count down and alert during a recorded workout.
