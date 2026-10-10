import { assertQuickWorkoutDraftReplacement, quickWorkoutDraftKey } from "./quickWorkoutDrafts.shared";
export async function readQuickWorkoutDraft(account: string | number): Promise<string | null> {
  if (typeof localStorage === "undefined") throw new Error("Quick workout recovery storage is unavailable. Keep this page open.");
  return localStorage.getItem(quickWorkoutDraftKey(account));
}
export async function writeQuickWorkoutDraft(account: string | number, expected: string | null, next: string | null) {
  if (typeof localStorage === "undefined" || !globalThis.navigator?.locks?.request) throw new Error("This browser cannot safely preserve a recoverable Quick workout draft. Keep this page open.");
  const key = quickWorkoutDraftKey(account);
  await navigator.locks.request(key, () => {
    assertQuickWorkoutDraftReplacement(localStorage.getItem(key), expected, next);
    if (next === null) localStorage.removeItem(key); else localStorage.setItem(key, next);
  });
}
