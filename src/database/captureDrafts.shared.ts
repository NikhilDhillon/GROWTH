export type CaptureDraftAccount = string | number;
export const captureDraftKey = (account: CaptureDraftAccount) => `growth.body-capture.v1:${typeof account}:${encodeURIComponent(String(account))}`;

export class CaptureDraftConflictError extends Error {
  constructor() { super("A newer body-entry draft is saved on this device. Your current input is preserved on this page; reload the saved draft before replacing it."); this.name = "CaptureDraftConflictError"; }
}

export function assertCaptureDraftReplacement(current: string | null, expected: string | null, next: string | null) {
  if (current === next) return;
  if (current !== expected) throw new CaptureDraftConflictError();
}
