import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const open = vi.hoisted(() => vi.fn());
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: open }));
import { readQuickWorkoutDraft, writeQuickWorkoutDraft } from "./quickWorkoutDrafts.native";
import { quickWorkoutDraftKey } from "./quickWorkoutDrafts.shared";
let sqlite: DatabaseSync;
type Adapter = {
  getFirstAsync: (sql: string, parameters: any[]) => Promise<unknown>;
  runAsync: (sql: string, parameters: any[]) => Promise<unknown>;
  withExclusiveTransactionAsync: (action: (tx: Adapter) => Promise<void>) => Promise<void>;
};
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); sqlite.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let queue = Promise.resolve();
  const adapter: Adapter = {
    getFirstAsync: async (sql: string, parameters: any[]) => sqlite.prepare(sql).get(...parameters) ?? null,
    runAsync: async (sql: string, parameters: any[]) => sqlite.prepare(sql).run(...parameters),
    withExclusiveTransactionAsync: (action: (tx: Adapter) => Promise<void>) => {
      const result = queue.then(async () => { sqlite.exec("BEGIN IMMEDIATE"); try { await action(adapter); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; } });
      queue = result.catch(() => undefined); return result;
    }
  };
  open.mockReset().mockResolvedValue(adapter);
});
afterEach(() => sqlite.close());
describe("native Quick input recovery", () => {
  it("keeps account drafts isolated without modifying existing body or Guided state", async () => {
    sqlite.prepare("INSERT INTO app_settings VALUES (?,?)").run("active_workout", "guided evidence");
    await writeQuickWorkoutDraft("a", null, "first"); await writeQuickWorkoutDraft("b", null, "second");
    expect(await readQuickWorkoutDraft("a")).toBe("first"); expect(await readQuickWorkoutDraft("b")).toBe("second");
    expect(sqlite.prepare("SELECT value FROM app_settings WHERE key='active_workout'").get()?.value).toBe("guided evidence");
  });
  it("preserves the winning draft when concurrent writers present the same stale baseline", async () => {
    const results = await Promise.allSettled([writeQuickWorkoutDraft("a", null, "first"), writeQuickWorkoutDraft("a", null, "second")]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("rejected"); expect(await readQuickWorkoutDraft("a")).toBe("first");
  });
  it("rolls back a failed replacement and leaves prior recoverable values intact", async () => {
    await writeQuickWorkoutDraft("a", null, "saved");
    sqlite.exec(`CREATE TRIGGER reject_quick_update BEFORE INSERT ON app_settings WHEN NEW.value='changed' BEGIN SELECT RAISE(ABORT, 'Storage rejected'); END;`);
    await expect(writeQuickWorkoutDraft("a", "saved", "changed")).rejects.toThrow("Storage rejected");
    expect(await readQuickWorkoutDraft("a")).toBe("saved");
  });
  it("rejects stale cleanup instead of deleting another screen's newer draft", async () => {
    sqlite.prepare("INSERT INTO app_settings VALUES (?,?)").run(quickWorkoutDraftKey("a"), "newer");
    await expect(writeQuickWorkoutDraft("a", "older", null)).rejects.toThrow(/newer Quick workout draft/i);
    expect(await readQuickWorkoutDraft("a")).toBe("newer");
  });
});
