/** What the rest notification shows: when the rest ends and what comes next. */
export type RestAlert = {
  endsAt: number;
  seconds: number;
  /** Shown while resting, e.g. "Next: Bench press set 3 · 100 lb × 8". */
  detail: string;
  /** Shown when the rest is over, e.g. "Bench press set 3 · 100 lb × 8". */
  doneDetail: string;
};

// The website has no rest notification yet; the Android app's lives in restAlerts.android.ts.
export function showRestAlert(_alert: RestAlert) {}

export function clearRestAlert() {}
