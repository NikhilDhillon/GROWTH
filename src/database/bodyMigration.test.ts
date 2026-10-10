import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bodyMigrationKey, migrateLegacyBodyMeasurements } from "@/database/bodyMigration";
import { schema } from "@/database/schema";

let sqlite: DatabaseSync;
let db: SQLiteDatabase;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  db = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    getFirstAsync: async (sql: string, params: (string | number)[] = []) => sqlite.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: (string | number)[] = []) => sqlite.prepare(sql).run(...params),
    withTransactionAsync: async (action: () => Promise<void>) => {
      sqlite.exec("BEGIN");
      try { await action(); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  } as unknown as SQLiteDatabase;
});
afterEach(() => sqlite.close());

function legacy(id: number, weight: number, date: string, createdAt = `${date}T12:00:00.000Z`) {
  sqlite.prepare("INSERT INTO body_weight_logs (id, weight, unit, logged_date, logged_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, weight, "lb", date, `${date}T12:00:00.000Z`, createdAt);
}
function measurements() { return sqlite.prepare("SELECT * FROM body_measurement_logs ORDER BY logged_date").all(); }
function marker() { return sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(bodyMigrationKey); }

describe("durable legacy body migration", () => {
  it("migrates a pre-modern store once while preserving every legacy observation", async () => {
    legacy(1, 170, "2026-07-01");
    legacy(2, 171, "2026-07-01", "2026-07-01T13:00:00.000Z");
    legacy(3, 172, "2026-07-02");
    await migrateLegacyBodyMeasurements(db, false);
    expect(measurements()).toMatchObject([
      { weight: 171, logged_date: "2026-07-01", created_at: "2026-07-01T13:00:00.000Z" },
      { weight: 172, logged_date: "2026-07-02" }
    ]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM body_weight_logs").get()).toMatchObject({ n: 3 });

    sqlite.exec("DELETE FROM body_measurement_logs WHERE logged_date = '2026-07-01'");
    await migrateLegacyBodyMeasurements(db, false);
    expect(measurements()).toHaveLength(1);
    expect(marker()).toMatchObject({ value: JSON.stringify({ version: 1, mode: "migrated_legacy" }) });
  });

  it("treats an existing empty modern store as authoritative without inventing deleted history", async () => {
    legacy(1, 170, "2026-07-01");
    await migrateLegacyBodyMeasurements(db, true);
    expect(measurements()).toEqual([]);
    expect(sqlite.prepare("SELECT weight FROM body_weight_logs").get()).toMatchObject({ weight: 170 });
    expect(marker()).toMatchObject({ value: JSON.stringify({ version: 1, mode: "existing_modern_legacy_preserved" }) });
    await migrateLegacyBodyMeasurements(db, false);
    expect(measurements()).toEqual([]);
  });

  it("rolls back copied observations if writing migration completion fails, then retries safely", async () => {
    legacy(1, 170, "2026-07-01");
    sqlite.exec(`CREATE TRIGGER reject_marker BEFORE INSERT ON app_settings
      WHEN NEW.key = 'body_measurements_legacy_migrated'
      BEGIN SELECT RAISE(ABORT, 'Checkpoint rejected'); END;`);
    await expect(migrateLegacyBodyMeasurements(db, false)).rejects.toThrow("Checkpoint rejected");
    expect(measurements()).toEqual([]);
    expect(marker()).toBeUndefined();
    expect(sqlite.prepare("SELECT weight FROM body_weight_logs").get()).toMatchObject({ weight: 170 });
    sqlite.exec("DROP TRIGGER reject_marker");
    await migrateLegacyBodyMeasurements(db, false);
    expect(measurements()).toHaveLength(1);
  });
});
