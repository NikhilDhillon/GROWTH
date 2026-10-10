import * as SQLite from "expo-sqlite";
import { assertCaptureDraftReplacement, CaptureDraftAccount, captureDraftKey } from "./captureDrafts.shared";

const database = () => SQLite.openDatabaseAsync("growth.db");
export async function readBodyCheckInDraft(account: CaptureDraftAccount): Promise<string | null> {
  const db = await database();
  return (await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [captureDraftKey(account)]))?.value ?? null;
}
export async function writeBodyCheckInDraft(account: CaptureDraftAccount, expected: string | null, next: string | null) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const key = captureDraftKey(account);
    const current = (await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]))?.value ?? null;
    assertCaptureDraftReplacement(current, expected, next);
    if (next === null) await tx.runAsync("DELETE FROM app_settings WHERE key = ?", [key]);
    else await tx.runAsync("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)", [key, next]);
  });
}
