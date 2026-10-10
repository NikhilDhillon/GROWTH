export const quickWorkoutDraftKey = (account: string | number) => `growth.quick-capture.v1:${typeof account}:${encodeURIComponent(String(account))}`;
export function assertQuickWorkoutDraftReplacement(current: string | null, expected: string | null, next: string | null) {
  if (current !== next && current !== expected) throw new Error("A newer Quick workout draft is saved on this device. Your input stays on this page; reload the saved draft before replacing it.");
}
