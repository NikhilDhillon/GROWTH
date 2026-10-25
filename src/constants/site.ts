/** The website, for links made outside a browser: invites from the app and password-reset emails. */
export const siteUrl = process.env.EXPO_PUBLIC_SITE_URL || "https://growth-lift-tracker.vercel.app";

/** True in the Android or iOS app, false on the website and in tests. */
export const nativeApp = process.env.EXPO_OS === "android" || process.env.EXPO_OS === "ios";
