import * as SQLite from "expo-sqlite";
import { assertQuickWorkoutDraftReplacement, quickWorkoutDraftKey } from "./quickWorkoutDrafts.shared";
export async function readQuickWorkoutDraft(account: string | number): Promise<string | null> {
  const db = await SQLite.openDatabaseAsync("growth.db");
  return (await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [quickWorkoutDraftKey(account)]))?.value ?? null;
}
export async function writeQuickWorkoutDraft(account: string | number, expected: string | null, next: string | null) {
  const db = await SQLite.openDatabaseAsync("growth.db");
  await db.withExclusiveTransactionAsync(async (tx) => {
    const key = quickWorkoutDraftKey(account);
    const current = (await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]))?.value ?? null;
    assertQuickWorkoutDraftReplacement(current, expected, next);
    if (next === null) await tx.runAsync("DELETE FROM app_settings WHERE key = ?", [key]);
    else await tx.runAsync("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)", [key, next]);
  });
}
