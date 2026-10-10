import * as SQLite from "expo-sqlite";
export async function readReportContext(key: string): Promise<string | null> {
  const db = await SQLite.openDatabaseAsync("growth.db");
  return (await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]))?.value ?? null;
}
export async function writeReportContext(key: string, value: string) {
  const db = await SQLite.openDatabaseAsync("growth.db");
  await db.runAsync("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)", [key, value]);
}
