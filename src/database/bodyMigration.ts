import type { SQLiteDatabase } from "expo-sqlite";
import { bodyMeasurementSchema } from "@/database/schema";

export const bodyMigrationKey = "body_measurements_legacy_migrated";

/** Preserve legacy rows. An existing modern store may contain intentional deletions. */
export async function migrateLegacyBodyMeasurements(db: SQLiteDatabase, modernTableExisted: boolean) {
  await db.withTransactionAsync(async () => {
    // Creation and retirement must commit together; a failed first attempt must
    // still be recognizable as pre-modern when initialization is retried.
    await db.execAsync(bodyMeasurementSchema);
    const completed = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [bodyMigrationKey]);
    if (completed) return;
    const unknownUnits = !modernTableExisted
      ? await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM body_weight_logs WHERE unit IS NULL OR unit NOT IN ('lb', 'kg')")
      : null;
    if (!modernTableExisted) {
      await db.runAsync(`
        INSERT INTO body_measurement_logs (weight, measurements, notes, logged_at, logged_date, created_at, updated_at)
        SELECT legacy.weight, '{}', NULL,
          COALESCE(legacy.logged_at, legacy.logged_date || 'T12:00:00.000Z', legacy.created_at),
          COALESCE(legacy.logged_date, substr(legacy.logged_at, 1, 10), substr(legacy.created_at, 1, 10)),
          COALESCE(legacy.created_at, legacy.logged_at, datetime('now')),
          COALESCE(legacy.created_at, legacy.logged_at, datetime('now'))
        FROM body_weight_logs legacy
        WHERE legacy.unit IN ('lb', 'kg') AND legacy.id = (
          SELECT candidate.id FROM body_weight_logs candidate
          WHERE COALESCE(candidate.logged_date, substr(candidate.logged_at, 1, 10), substr(candidate.created_at, 1, 10))
            = COALESCE(legacy.logged_date, substr(legacy.logged_at, 1, 10), substr(legacy.created_at, 1, 10))
          ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
        )
        ON CONFLICT(logged_date) DO NOTHING
      `);
    }
    await db.runAsync("INSERT INTO app_settings (key, value) VALUES (?, ?)", [
      bodyMigrationKey,
      JSON.stringify({
        version: 1,
        mode: modernTableExisted ? "existing_modern_legacy_preserved"
          : unknownUnits?.count ? "known_legacy_migrated_unknown_preserved" : "migrated_legacy",
        ...(unknownUnits?.count ? { preservedUnknownUnitCount: unknownUnits.count } : {})
      })
    ]);
  });
}
