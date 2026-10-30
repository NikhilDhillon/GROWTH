/** What the rest notification shows: when the rest ends and what comes next. */
export type RestAlert = {
  endsAt: number;
  seconds: number;
  /** Shown while resting, e.g. "Next: Bench press set 3 · 100 lb × 8". */
  detail: string;
  /** Shown when the rest is over, e.g. "Bench press set 3 · 100 lb × 8". */
  doneDetail: string;
};

// Rest alerts live in restAlerts.web.ts and restAlerts.android.ts; other platforms and tests have none.
export function primeRestAlerts() {}

export function showRestAlert(_alert: RestAlert) {}

export function clearRestAlert() {}
