import { assertCaptureDraftReplacement, CaptureDraftAccount, captureDraftKey } from "./captureDrafts.shared";
import { webLocks } from "./webLocks";

export async function readBodyCheckInDraft(account: CaptureDraftAccount): Promise<string | null> {
  if (typeof localStorage === "undefined") throw new Error("Recoverable body entry is unavailable. Keep this page open until you finish recording.");
  return localStorage.getItem(captureDraftKey(account));
}

export async function writeBodyCheckInDraft(account: CaptureDraftAccount, expected: string | null, next: string | null) {
  const locks = webLocks();
  if (typeof localStorage === "undefined" || !locks) throw new Error("This browser cannot safely save a recoverable body-entry draft. Keep this page open.");
  const key = captureDraftKey(account);
  await locks.request(key, () => {
    assertCaptureDraftReplacement(localStorage.getItem(key), expected, next);
    if (next === null) localStorage.removeItem(key);
    else localStorage.setItem(key, next);
  });
}
