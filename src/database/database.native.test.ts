import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDatabase = vi.hoisted(() => vi.fn());
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: openDatabase }));

import { createActiveWorkout } from "@/constants/activeWorkout";
import { baseSchema, schema } from "@/database/schema";
import { WorkoutWriteInput, workoutWritePayload } from "@/database/workoutWrite";
import { ActiveWorkout, CompletedGuidedWorkout } from "@/types";
import { WorkoutRecordingInput } from "@/domain/workoutLifecycle";
import { BodyCheckInWriteInput } from "@/domain/bodyCheckInRecording";
import { confirmGuidedObservation } from "@/services/guidedWorkout/guidedObservationService";

type SqlValue = null | string | number | bigint | Uint8Array;
type TestSqliteAdapter = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, params?: SqlValue[]) => Promise<{ lastInsertRowId: number; changes: number }>;
  getFirstAsync: <T>(sql: string, params?: SqlValue[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, params?: SqlValue[]) => Promise<T[]>;
  withTransactionAsync: (action: () => Promise<void>) => Promise<void>;
  withExclusiveTransactionAsync: (action: (tx: TestSqliteAdapter) => Promise<void>) => Promise<void>;
};
function sqliteAdapter(sqlite: DatabaseSync) {
  const adapter: TestSqliteAdapter = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    runAsync: async (sql: string, params: SqlValue[] = []) => {
      const result = sqlite.prepare(sql).run(...params);
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    getFirstAsync: async <T>(sql: string, params: SqlValue[] = []) => sqlite.prepare(sql).get(...params) as T | undefined ?? null,
    getAllAsync: async <T>(sql: string, params: SqlValue[] = []) => sqlite.prepare(sql).all(...params) as T[],
    withTransactionAsync: async (action: () => Promise<void>) => transaction(action),
    withExclusiveTransactionAsync: async (action: (tx: TestSqliteAdapter) => Promise<void>) => transaction(() => action(adapter))
  };
  async function transaction(action: () => Promise<void>) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { await action(); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }
  return adapter;
}

let sqlite: DatabaseSync;
type NativeDatabase = typeof import("@/database/database.native");
let native: NativeDatabase;
let exerciseId: number;
const date = "2026-07-01";
const timestamp = `${date}T12:00:00.000Z`;

async function initialize() {
  native = await import("@/database/database.native");
  const data = await native.loadAllData();
  exerciseId = data.exercises[0].id;
  return data;
}
function input(): WorkoutWriteInput {
  return {
    requestId: "attempt-a", exerciseId, workoutDate: date, notes: "Observed work", machineProfileId: "machine-a",
    sets: [{ reps: 8, weight: 100 }, { reps: 7, weight: 100 }]
  };
}
function workout(): ActiveWorkout {
  return { ...createActiveWorkout({ key: "mon", label: "Monday", muscles: ["Chest"] }), workoutId: "bfe33d34-0c3f-4a96-9c0b-de9f173c7d06", startedAt: timestamp, workoutDate: date };
}
function completed(active = workout()): CompletedGuidedWorkout {
  return { ...active, id: active.startedAt, finishedAt: `${date}T13:00:00.000Z` };
}
function rows(table: string) { return sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); }
function bodyRequest(attempt = 1) { return `00000000-0000-4000-8000-${String(attempt).padStart(12, "0")}`; }
function bodyInput(attempt = 1): BodyCheckInWriteInput {
  return { requestId: bodyRequest(attempt), loggedDate: date, weight: 175, measurements: {}, notes: "Observed today",
    inputUnits: { weight: "lb", circumference: "cm" } };
}

beforeEach(() => {
  vi.resetModules();
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  openDatabase.mockReset().mockResolvedValue(sqliteAdapter(sqlite));
});
afterEach(() => sqlite.close());

describe("native whole body check-in transactions", () => {
  it("rejects deletion after the initiating account changes, including transaction acquisition", async () => {
    await initialize();
    const first = await native.registerUser({ name: "First", email: "first@example.test", password: "password123" });
    const original = await native.recordBodyCheckIn({ ...bodyInput(), accountId: first.id });
    const second = await native.registerUser({ name: "Second", email: "second@example.test", password: "password123" });
    await expect(native.deleteBodyCheckIn(original.id, original, first.id)).rejects.toThrow(/account changed/i);
    await native.loginUser({ email: first.email, password: "password123" });
    const adapter = await openDatabase.mock.results[0].value as TestSqliteAdapter;
    const exclusiveTransaction = adapter.withExclusiveTransactionAsync;
    vi.spyOn(adapter, "withExclusiveTransactionAsync").mockImplementationOnce(async (action) => {
      sqlite.prepare("UPDATE auth_session SET user_id = ? WHERE id = 1").run(Number(second.id));
      return exclusiveTransaction(action);
    });
    await expect(native.deleteBodyCheckIn(original.id, original, first.id)).rejects.toThrow(/account changed/i);
    expect((await native.loadAllData()).bodyMeasurementLogs).toEqual([original]);
    expect(rows("body_check_in_write_requests")[0]).toMatchObject({ body_id: original.id });
  });
  it("records daily weight and infrequent tape independently without carrying older facts forward", async () => {
    await initialize();
    const measured = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    const daily = await native.recordBodyCheckIn({ ...bodyInput(2), loggedDate: "2026-07-02", weight: 174 });
    const tape = await native.recordBodyCheckIn({ ...bodyInput(3), loggedDate: "2026-10-01", weight: null, measurements: { waist: 78 } });
    expect(measured).toMatchObject({ weight: 175, measurements: { waist: 80 }, weight_input_unit: "lb", circumference_input_unit: "cm" });
    expect(daily).toMatchObject({ weight: 174, measurements: {}, weight_input_unit: "lb", circumference_input_unit: null });
    expect(tape).toMatchObject({ weight: null, measurements: { waist: 78 }, weight_input_unit: null, circumference_input_unit: "cm" });
    expect((await native.loadAllData()).bodyMeasurementLogs).toHaveLength(3);
  });

  it("replaces the whole saved check-in and permits deliberate removal of one observed part", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 }, notes: "Original" });
    const updated = await native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original, weight: null,
      measurements: { waist: 79 }, notes: null, loggedDate: "2026-07-02" });
    expect(updated).toMatchObject({ id: original.id, weight: null, measurements: { waist: 79 }, notes: null,
      logged_date: "2026-07-02", created_at: original.created_at, weight_input_unit: null, circumference_input_unit: "cm" });
    expect(rows("body_measurement_logs")).toHaveLength(1);
    expect(rows("body_check_in_write_requests")).toHaveLength(2);
  });

  it("refuses an occupied date rather than merging or overwriting an unrelated check-in", async () => {
    await initialize();
    await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    const original = rows("body_measurement_logs");
    await expect(native.recordBodyCheckIn({ ...bodyInput(2), weight: 174 })).rejects.toThrow(/already exists for this date/i);
    expect(rows("body_measurement_logs")).toEqual(original);
    expect(rows("body_check_in_write_requests")).toHaveLength(1);
  });

  it("preserves both observations if moving a check-in would collide with another date", async () => {
    await initialize();
    await native.recordBodyCheckIn(bodyInput());
    const other = await native.recordBodyCheckIn({ ...bodyInput(2), loggedDate: "2026-07-02", weight: 174 });
    const original = rows("body_measurement_logs");
    await expect(native.recordBodyCheckIn({ ...bodyInput(3), id: other.id, expected: other, weight: 173 })).rejects.toThrow(/already exists for this date/i);
    expect(rows("body_measurement_logs")).toEqual(original);
    expect(rows("body_check_in_write_requests")).toHaveLength(2);
  });

  it("rejects stale whole edits without losing the newer weight, tape, or notes", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    const newer = await native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original,
      weight: 174, measurements: { waist: 79 }, notes: "Newer observation" });
    const saved = rows("body_measurement_logs");
    await expect(native.recordBodyCheckIn({ ...bodyInput(3), id: original.id, expected: original, weight: 173 })).rejects.toThrow(/changed.*reload/i);
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect((await native.loadAllData()).bodyMeasurementLogs).toEqual([newer]);
    expect(rows("body_check_in_write_requests")).toHaveLength(2);
  });

  it("returns the current observation on an acknowledged retry without replaying old values after later editing", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn(bodyInput());
    const newer = await native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original, weight: 174 });
    expect(await native.recordBodyCheckIn(bodyInput())).toEqual(newer);
    expect(rows("body_measurement_logs")).toHaveLength(1);
    expect(rows("body_check_in_write_requests")).toHaveLength(2);
  });

  it("does not reuse a committed attempt for changed observations", async () => {
    await initialize();
    await native.recordBodyCheckIn(bodyInput());
    const original = rows("body_measurement_logs");
    await expect(native.recordBodyCheckIn({ ...bodyInput(), weight: 174 })).rejects.toThrow(/different values/i);
    expect(rows("body_measurement_logs")).toEqual(original);
  });

  it("rolls back a newly recorded check-in when recording its retry receipt fails", async () => {
    await initialize();
    sqlite.exec(`CREATE TRIGGER reject_body_receipt BEFORE INSERT ON body_check_in_write_requests
      BEGIN SELECT RAISE(ABORT, 'Body receipt rejected'); END;`);
    await expect(native.recordBodyCheckIn(bodyInput())).rejects.toThrow("Body receipt rejected");
    expect(rows("body_measurement_logs")).toEqual([]);
    expect(rows("body_check_in_write_requests")).toEqual([]);
    sqlite.exec("DROP TRIGGER reject_body_receipt");
    expect(await native.recordBodyCheckIn(bodyInput())).toMatchObject({ weight: 175 });
    expect(rows("body_measurement_logs")).toHaveLength(1);
  });

  it("rolls back a whole edit when its later receipt fails", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 }, notes: "Keep" });
    const saved = rows("body_measurement_logs");
    sqlite.exec(`CREATE TRIGGER reject_body_edit_receipt BEFORE INSERT ON body_check_in_write_requests
      WHEN NEW.request_id = '${bodyRequest(2)}' BEGIN SELECT RAISE(ABORT, 'Body edit receipt rejected'); END;`);
    await expect(native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original,
      weight: 174, measurements: { waist: 79 }, notes: "Replace" })).rejects.toThrow("Body edit receipt rejected");
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect(rows("body_check_in_write_requests")).toHaveLength(1);
  });

  it("whole deletion and all receipt tombstones roll back together if the observation cannot be deleted", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 }, notes: "Keep" });
    const saved = rows("body_measurement_logs");
    const receipts = rows("body_check_in_write_requests");
    sqlite.exec(`CREATE TRIGGER reject_whole_body_delete BEFORE DELETE ON body_measurement_logs
      BEGIN SELECT RAISE(ABORT, 'Body deletion rejected'); END;`);
    await expect(native.deleteBodyCheckIn(original.id, original)).rejects.toThrow("Body deletion rejected");
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect(rows("body_check_in_write_requests")).toEqual(receipts);
    expect(await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 }, notes: "Keep" })).toEqual(original);
  });

  it("rejects stale deletion and preserves every part of the current check-in", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    await native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original, weight: 174, measurements: { waist: 79 } });
    const saved = rows("body_measurement_logs");
    const receipts = rows("body_check_in_write_requests");
    await expect(native.deleteBodyCheckIn(original.id, original)).rejects.toThrow(/changed.*reload/i);
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect(rows("body_check_in_write_requests")).toEqual(receipts);
  });

  it("retains deletion tombstones, rejects delayed retries and edits, and never reuses the deleted identity", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    await native.deleteBodyCheckIn(original.id, original);
    expect(rows("body_measurement_logs")).toEqual([]);
    expect(rows("body_check_in_write_requests")).toEqual([expect.objectContaining({ body_id: null })]);
    await expect(native.recordBodyCheckIn(bodyInput())).rejects.toThrow(/different values/i);
    await expect(native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } })).rejects.toThrow(/deleted.*cannot recreate/i);
    await expect(native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original })).rejects.toThrow(/no longer exists/i);
    const replacement = await native.recordBodyCheckIn(bodyInput(3));
    expect(replacement.id).toBeGreaterThan(original.id);
    await native.deleteBodyCheckIn(original.id, original);
    expect((await native.loadAllData()).bodyMeasurementLogs).toEqual([replacement]);
  });

  it("does not replay one account's save attempt after signing into another account", async () => {
    await initialize();
    const first = await native.registerUser({ name: "First", email: "first@example.test", password: "password123" });
    await native.recordBodyCheckIn({ ...bodyInput(), accountId: first.id });
    const saved = rows("body_measurement_logs");
    await native.logoutUser();
    const second = await native.registerUser({ name: "Second", email: "second@example.test", password: "password123" });
    await expect(native.recordBodyCheckIn({ ...bodyInput(), accountId: second.id })).rejects.toThrow(/different values or another account/i);
    await expect(native.recordBodyCheckIn({ ...bodyInput(2), accountId: first.id, loggedDate: "2026-07-02" })).rejects.toThrow(/account changed/i);
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect(rows("body_check_in_write_requests")).toHaveLength(1);
  });

  it("rejects an account switch while the recording is waiting to acquire its transaction", async () => {
    await initialize();
    const first = await native.registerUser({ name: "First", email: "first@example.test", password: "password123" });
    const second = await native.registerUser({ name: "Second", email: "second@example.test", password: "password123" });
    await native.loginUser({ email: first.email, password: "password123" });
    const adapter = await openDatabase.mock.results[0].value as TestSqliteAdapter;
    const exclusiveTransaction = adapter.withExclusiveTransactionAsync;
    vi.spyOn(adapter, "withExclusiveTransactionAsync").mockImplementationOnce(async (action) => {
      sqlite.prepare("UPDATE auth_session SET user_id = ? WHERE id = 1").run(Number(second.id));
      return exclusiveTransaction(action);
    });
    await expect(native.recordBodyCheckIn({ ...bodyInput(), accountId: first.id })).rejects.toThrow(/account changed/i);
    expect(rows("body_measurement_logs")).toEqual([]);
    expect(rows("body_check_in_write_requests")).toEqual([]);
    expect((await native.loadCurrentUser())?.id).toBe(second.id);
  });

  it("leaves the whole check-in intact when updating a deletion tombstone fails first", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    const saved = rows("body_measurement_logs");
    const receipts = rows("body_check_in_write_requests");
    sqlite.exec(`CREATE TRIGGER reject_body_tombstone BEFORE UPDATE ON body_check_in_write_requests
      BEGIN SELECT RAISE(ABORT, 'Body tombstone rejected'); END;`);
    await expect(native.deleteBodyCheckIn(original.id, original)).rejects.toThrow("Body tombstone rejected");
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect(rows("body_check_in_write_requests")).toEqual(receipts);
  });

  it("keeps compatibility edits honest about the affected units while preserving untouched tape metadata", async () => {
    await initialize();
    const original = await native.recordBodyCheckIn({ ...bodyInput(), measurements: { waist: 80 } });
    await native.saveBodyWeightLog({ loggedDate: date, weight: 174, unit: "kg" });
    expect((await native.loadAllData()).bodyMeasurementLogs[0]).toMatchObject({ weight: 174, measurements: { waist: 80 },
      weight_input_unit: "kg", circumference_input_unit: "cm" });
    await native.updateBodyMeasurementLog({ id: original.id, loggedDate: date, weight: 173, measurements: { waist: 79 } });
    expect((await native.loadAllData()).bodyMeasurementLogs[0]).toMatchObject({ weight: 173, measurements: { waist: 79 },
      weight_input_unit: null, circumference_input_unit: null });
  });

  it("preserves unknown provenance on unchanged legacy facts instead of inventing the current display unit", async () => {
    await initialize();
    await native.saveBodyMeasurementLog({ loggedDate: date, weight: 175, measurements: { waist: 80 }, notes: "Legacy" });
    const original = (await native.loadAllData()).bodyMeasurementLogs[0];
    const changedNotes = await native.recordBodyCheckIn({ ...bodyInput(), id: original.id, expected: original,
      measurements: { waist: 80 }, notes: "Reviewed", inputUnits: { weight: "kg", circumference: "in" } });
    expect(changedNotes).toMatchObject({ weight: 175, measurements: { waist: 80 }, weight_input_unit: null, circumference_input_unit: null });
  });

  it("refuses an edit that would silently remove unrepresented historical measurements", async () => {
    await initialize();
    sqlite.prepare(`INSERT INTO body_measurement_logs (weight, measurements, notes, logged_at, logged_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(175, JSON.stringify({ waist: 80, legacy_unknown_tape: 41 }), "Keep evidence", timestamp, date, timestamp, timestamp);
    const original = (await native.loadAllData()).bodyMeasurementLogs[0];
    expect(original.measurements).toEqual({ waist: 80 });
    const saved = rows("body_measurement_logs");
    await expect(native.recordBodyCheckIn({ ...bodyInput(), id: original.id, expected: original, measurements: { waist: 79 } })).rejects.toThrow(/changed.*reload/i);
    expect(rows("body_measurement_logs")).toEqual(saved);
    expect(rows("body_check_in_write_requests")).toEqual([]);
  });

  it("gives even an unchanged saved edit a new revision when the clock has not advanced", async () => {
    await initialize();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(timestamp));
    try {
      const original = await native.recordBodyCheckIn(bodyInput());
      const updated = await native.recordBodyCheckIn({ ...bodyInput(2), id: original.id, expected: original });
      expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(original.updated_at));
      await expect(native.recordBodyCheckIn({ ...bodyInput(3), id: original.id, expected: original })).rejects.toThrow(/changed.*reload/i);
    } finally { now.mockRestore(); }
  });

  it("upgrades existing modern rows without changing historical values or assigning guessed units", async () => {
    sqlite.exec(`CREATE TABLE body_measurement_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, weight REAL, measurements TEXT NOT NULL DEFAULT '{}', notes TEXT,
      logged_at TEXT NOT NULL, logged_date TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO body_measurement_logs VALUES (5, 175, '{"waist":80}', 'Historical', '${timestamp}', '${date}', '${timestamp}', '${timestamp}');`);
    const data = await initialize();
    expect(data.bodyMeasurementLogs).toEqual([expect.objectContaining({ id: 5, weight: 175, measurements: { waist: 80 }, notes: "Historical",
      weight_input_unit: null, circumference_input_unit: null, updated_at: timestamp })]);
    vi.resetModules();
    expect((await initialize()).bodyMeasurementLogs).toEqual(data.bodyMeasurementLogs);
  });

  it("does not resurrect a migrated legacy body observation after whole deletion and reinitialization", async () => {
    sqlite.exec(`CREATE TABLE body_weight_logs (
      id INTEGER PRIMARY KEY, weight REAL NOT NULL, unit TEXT, logged_at TEXT, logged_date TEXT, created_at TEXT);
      INSERT INTO body_weight_logs VALUES (1, 175, 'lb', '${timestamp}', '${date}', '${timestamp}');`);
    const data = await initialize();
    await native.deleteBodyCheckIn(data.bodyMeasurementLogs[0].id, data.bodyMeasurementLogs[0]);
    vi.resetModules();
    expect((await initialize()).bodyMeasurementLogs).toEqual([]);
    expect(rows("body_weight_logs")).toHaveLength(1);
  });
});

describe("native observed workout transactions", () => {
  it("rolls back the session and first set if a later set is rejected", async () => {
    await initialize();
    sqlite.exec(`CREATE TRIGGER reject_second_set BEFORE INSERT ON workout_sets
      WHEN NEW.set_number = 2 BEGIN SELECT RAISE(ABORT, 'Second set rejected'); END;`);
    await expect(native.logWorkout(input())).rejects.toThrow("Second set rejected");
    expect(rows("workout_sessions")).toEqual([]);
    expect(rows("workout_sets")).toEqual([]);
    expect(rows("workout_write_requests")).toEqual([]);
  });

  it("rolls back all observations if recording the retry receipt fails", async () => {
    await initialize();
    sqlite.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON workout_write_requests
      BEGIN SELECT RAISE(ABORT, 'Receipt rejected'); END;`);
    await expect(native.logWorkout(input())).rejects.toThrow("Receipt rejected");
    expect(rows("workout_sessions")).toEqual([]);
    expect(rows("workout_sets")).toEqual([]);
    sqlite.exec("DROP TRIGGER reject_receipt");
    const id = await native.logWorkout(input());
    expect(rows("workout_sessions")).toHaveLength(1);
    expect(rows("workout_sets")).toHaveLength(2);
    expect(await native.logWorkout(input())).toBe(id);
  });

  it("preserves the original metadata and sets if replacement sets fail", async () => {
    await initialize();
    const id = await native.logWorkout(input());
    const previousSessions = rows("workout_sessions");
    const previousSets = rows("workout_sets");
    sqlite.exec(`CREATE TRIGGER reject_replacement BEFORE INSERT ON workout_sets
      WHEN NEW.set_number = 2 BEGIN SELECT RAISE(ABORT, 'Replacement rejected'); END;`);
    await expect(native.updateWorkoutSession({
      ...input(), sessionId: id, workoutDate: "2026-07-02", notes: "Changed note", machineProfileId: "machine-b",
      sets: [{ reps: 9, weight: 110 }, { reps: 8, weight: 110 }]
    })).rejects.toThrow("Replacement rejected");
    expect(rows("workout_sessions")).toEqual(previousSessions);
    expect(rows("workout_sets")).toEqual(previousSets);
  });

  it("preserves sets and the receipt if deleting their session fails", async () => {
    await initialize();
    const id = await native.logWorkout(input());
    const previousSets = rows("workout_sets");
    sqlite.exec(`CREATE TRIGGER reject_session_delete BEFORE DELETE ON workout_sessions
      BEGIN SELECT RAISE(ABORT, 'Session deletion rejected'); END;`);
    await expect(native.deleteWorkoutSession(id)).rejects.toThrow("Session deletion rejected");
    expect(rows("workout_sessions")).toHaveLength(1);
    expect(rows("workout_sets")).toEqual(previousSets);
    expect(await native.logWorkout(input())).toBe(id);
  });

  it("returns one committed identity for retries and rejects a changed save attempt", async () => {
    await initialize();
    const id = await native.logWorkout(input());
    expect(await native.logWorkout(input())).toBe(id);
    await expect(native.logWorkout({ ...input(), notes: "Different work" })).rejects.toThrow(/different values/i);
    expect(rows("workout_sessions")).toHaveLength(1);
    expect(rows("workout_sets")).toHaveLength(2);
  });

  it("does not recreate deleted observations through an old retry after restart", async () => {
    await initialize();
    const saved = input();
    const id = await native.logWorkout(saved);
    await native.deleteWorkoutSession(id);
    vi.resetModules();
    await initialize();
    await expect(native.logWorkout(saved)).rejects.toThrow(/deleted/i);
    expect(rows("workout_sessions")).toEqual([]);
    expect(rows("workout_sets")).toEqual([]);
  });

  it("stores set capture metadata and keeps it for sets a history edit leaves unchanged", async () => {
    await initialize();
    const performedAt = "2026-07-01T18:02:00.000Z";
    const id = await native.logWorkout({ ...input(), sets: [{ reps: 8, weight: 100, performedAt, evidence: "flow" }, { reps: 7, weight: 100, evidence: "typed" }] });
    expect(rows("workout_sets")).toEqual([
      expect.objectContaining({ performed_at: performedAt, evidence: "flow" }), expect.objectContaining({ performed_at: null, evidence: "typed" })
    ]);
    await native.updateWorkoutSession({ ...input(), sessionId: id, sets: [{ reps: 8, weight: 100, evidence: "typed" }, { reps: 6, weight: 100, evidence: "typed" }] });
    expect(rows("workout_sets")).toEqual([
      expect.objectContaining({ reps: 8, performed_at: performedAt, evidence: "flow" }), expect.objectContaining({ reps: 6, performed_at: null, evidence: "typed" })
    ]);
  });

  it("adds capture columns to an existing set table without inventing metadata for its rows", async () => {
    sqlite.exec(`CREATE TABLE workout_sets (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL,
      set_number INTEGER, reps INTEGER, weight REAL, rir REAL, is_warmup INTEGER NOT NULL DEFAULT 0, created_at TEXT);
      INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, created_at) VALUES (1, 1, 1, 8, 100, '${timestamp}');`);
    await initialize();
    expect(rows("workout_sets")).toEqual([expect.objectContaining({ reps: 8, performed_at: null, evidence: null })]);
    expect(() => sqlite.prepare("UPDATE workout_sets SET evidence = 'guessed'").run()).toThrow();
  });

  it("adds a personal exercise once, with its own load type, and never repeats a catalog name", async () => {
    await initialize();
    await native.registerUser({ name: "Lifter", email: "lifter@example.test", password: "password123" });
    const created = await native.createCustomExercise({ name: "Landmine Press", primaryMuscle: "Chest", loadType: "bodyweight_plus_load" });
    expect(await native.createCustomExercise({ name: "landmine  press", primaryMuscle: "Chest", loadType: "bodyweight_plus_load" })).toMatchObject({ id: created.id });
    await expect(native.createCustomExercise({ name: "Landmine Press", primaryMuscle: "Back", loadType: "external" })).rejects.toThrow("You already have an exercise named Landmine Press.");
    await expect(native.createCustomExercise({ name: "Barbell Bench Press", primaryMuscle: "Chest", loadType: "external" })).rejects.toThrow("already in the exercise list");
    expect((await native.loadAllData()).exercises.find((exercise) => exercise.id === created.id))
      .toMatchObject({ name: "Landmine Press", creator_id: expect.any(Number), load_type: "bodyweight_plus_load" });
    expect(() => sqlite.prepare("UPDATE exercises SET load_type = 'kettlebell'").run()).toThrow();
  });

  it("adds personal exercise columns to an existing exercise table without changing its rows", async () => {
    sqlite.exec(`CREATE TABLE exercises (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, primary_muscle TEXT NOT NULL, secondary_muscle TEXT,
      is_strength_exercise INTEGER DEFAULT 1, created_at TEXT);
      INSERT INTO exercises (name, primary_muscle, created_at) VALUES ('Barbell Bench Press', 'Chest', '${timestamp}');`);
    await initialize();
    expect(rows("exercises")[0]).toMatchObject({ id: 1, name: "Barbell Bench Press", creator_id: null, load_type: null });
    expect(rows("exercises").filter((row) => (row as { name: string }).name === "Barbell Bench Press")).toHaveLength(1);
  });

  it("does not overwrite edited observations when the original create attempt is retried", async () => {
    await initialize();
    const original = input();
    const id = await native.logWorkout(original);
    await native.updateWorkoutSession({ ...original, sessionId: id, sets: [{ reps: 10, weight: 110 }, { reps: 9, weight: 110 }] });
    expect(await native.logWorkout(original)).toBe(id);
    expect(rows("workout_sets")).toEqual([
      expect.objectContaining({ reps: 10, weight: 110 }), expect.objectContaining({ reps: 9, weight: 110 })
    ]);
  });

  it("rejects a stale edit without creating orphan sets", async () => {
    await initialize();
    await expect(native.updateWorkoutSession({ ...input(), sessionId: 999 })).rejects.toThrow(/no longer exists/i);
    expect(rows("workout_sets")).toEqual([]);
  });

  it("reports a stale machine-tag edit without changing unrelated history", async () => {
    await initialize();
    await native.logWorkout(input());
    const previousSessions = rows("workout_sessions");
    const previousSets = rows("workout_sets");
    await expect(native.updateWorkoutSessionMachineProfile({ sessionId: 999, machineProfileId: "machine-b" })).rejects.toThrow(/no longer exists/i);
    expect(rows("workout_sessions")).toEqual(previousSessions);
    expect(rows("workout_sets")).toEqual(previousSets);
  });

  it("preserves body observations, workout history and import receipts when later imported work fails", async () => {
    await initialize();
    sqlite.exec(`INSERT INTO users (id, name, email, password_hash, created_at) VALUES (1, 'Lifter', 'lifter@example.test', '', '${timestamp}');
      INSERT INTO auth_session (id, user_id, created_at) VALUES (1, 1, '${timestamp}');`);
    await native.logWorkout(input());
    await native.saveBodyWeightLog({ loggedDate: date, weight: 175, unit: "lb" });
    const originalBody = rows("body_measurement_logs");
    const originalSessions = rows("workout_sessions");
    const originalSets = rows("workout_sets");
    const originalSettings = rows("app_settings");
    const originalPreferences = rows("user_exercise_preferences");
    const imported = {
      bodyWeightLogs: [{ loggedDate: date, weight: 180, unit: "lb" as const }],
      bodyMeasurementLogs: [{ loggedDate: date, weight: null, measurements: { waist: 82 }, notes: "Imported measurement" }],
      workouts: [{ workoutDate: "2026-07-02", notes: "Imported work", exerciseId, exerciseName: "Imported exercise",
        fingerprint: "new-import-fingerprint", sets: [{ reps: 9, weight: 110 }, { reps: 8, weight: 110 }] }],
      exerciseIdsToEnable: [exerciseId]
    };
    sqlite.exec(`CREATE TRIGGER reject_imported_set BEFORE INSERT ON workout_sets
      WHEN NEW.set_number = 2 BEGIN SELECT RAISE(ABORT, 'Imported set rejected'); END;`);
    await expect(native.importTrainingData(imported)).rejects.toThrow("Imported set rejected");
    expect(rows("body_measurement_logs")).toEqual(originalBody);
    expect(rows("workout_sessions")).toEqual(originalSessions);
    expect(rows("workout_sets")).toEqual(originalSets);
    expect(rows("app_settings")).toEqual(originalSettings);
    expect(rows("user_exercise_preferences")).toEqual(originalPreferences);
    sqlite.exec("DROP TRIGGER reject_imported_set");
    const importedResult = await native.importTrainingData(imported);
    expect(importedResult).toEqual({ inserted: { bodyCheckIns: 0, workouts: 1, sets: 2 }, skipped: { bodyCheckIns: 1, workouts: 0 }, failed: 0 });
    expect(rows("workout_sessions")).toHaveLength(2);
    expect(rows("workout_sets")).toHaveLength(4);
    expect(rows("body_measurement_logs")).toEqual(originalBody);
  });
});

describe("native body-entry recovery storage", () => {
  it("isolates account drafts and rejects stale replacements or cleanup", async () => {
    await initialize();
    const drafts = await import("@/database/captureDrafts.native");
    await drafts.writeBodyCheckInDraft(1, null, "first");
    await drafts.writeBodyCheckInDraft("1", null, "typed separately");
    await drafts.writeBodyCheckInDraft(2, null, "second");
    expect(await drafts.readBodyCheckInDraft(1)).toBe("first");
    expect(await drafts.readBodyCheckInDraft("1")).toBe("typed separately");
    expect(await drafts.readBodyCheckInDraft(2)).toBe("second");
    await expect(drafts.writeBodyCheckInDraft(1, null, "stale tab")).rejects.toMatchObject({ name: "CaptureDraftConflictError" });
    await expect(drafts.writeBodyCheckInDraft(1, null, null)).rejects.toMatchObject({ name: "CaptureDraftConflictError" });
    expect(await drafts.readBodyCheckInDraft(1)).toBe("first");
    await drafts.writeBodyCheckInDraft(1, "first", null);
    expect(await drafts.readBodyCheckInDraft(1)).toBeNull();
    expect(await drafts.readBodyCheckInDraft(2)).toBe("second");
  });

  it("preserves pending recovery evidence when native persistence rejects replacement or cleanup", async () => {
    await initialize();
    const drafts = await import("@/database/captureDrafts.native");
    await drafts.writeBodyCheckInDraft(1, null, "pending attempt");
    sqlite.exec(`CREATE TRIGGER reject_capture_replace BEFORE INSERT ON app_settings WHEN NEW.key LIKE 'growth.body-capture.%' BEGIN SELECT RAISE(ABORT, 'Draft disk failure'); END;
      CREATE TRIGGER reject_capture_delete BEFORE DELETE ON app_settings WHEN OLD.key LIKE 'growth.body-capture.%' BEGIN SELECT RAISE(ABORT, 'Draft disk failure'); END;`);
    await expect(drafts.writeBodyCheckInDraft(1, "pending attempt", "new")).rejects.toThrow("Draft disk failure");
    await expect(drafts.writeBodyCheckInDraft(1, "pending attempt", null)).rejects.toThrow("Draft disk failure");
    expect(await drafts.readBodyCheckInDraft(1)).toBe("pending attempt");
    expect(rows("body_measurement_logs")).toEqual([]);
  });
});

describe("native compatibility preserves historical observations", () => {
  it("preserves ambiguous pre-modern weights without inventing a missing unit", async () => {
    sqlite.exec(`CREATE TABLE body_weight_logs (id INTEGER PRIMARY KEY, weight REAL NOT NULL, logged_at TEXT, logged_date TEXT, created_at TEXT);
      INSERT INTO body_weight_logs VALUES (1, 175, '${timestamp}', '${date}', '${timestamp}');`);
    sqlite.exec(baseSchema);
    expect((await initialize()).bodyMeasurementLogs).toEqual([]);
    expect(rows("body_weight_logs")).toEqual([expect.objectContaining({ id: 1, weight: 175, unit: null })]);
    const checkpoint = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'body_measurements_legacy_migrated'").get()!;
    expect(JSON.parse(String(checkpoint.value))).toMatchObject({ mode: "known_legacy_migrated_unknown_preserved", preservedUnknownUnitCount: 1 });
    vi.resetModules();
    expect((await initialize()).bodyMeasurementLogs).toEqual([]);
  });

  it("adds catalog movements without renaming or reclassifying existing historical IDs", async () => {
    sqlite.exec(baseSchema);
    sqlite.exec(`INSERT INTO exercises (id, name, primary_muscle, secondary_muscle, is_strength_exercise, created_at)
      VALUES (998, 'Cable Pushdown', 'Forearms', NULL, 1, '${timestamp}'),
        (999, 'Barbell Bench Press', 'Back', 'Triceps', 1, '${timestamp}');`);
    const data = await initialize();
    expect(data.exercises).toContainEqual(expect.objectContaining({ id: 998, name: "Cable Pushdown", primary_muscle: "Forearms" }));
    expect(data.exercises).toContainEqual(expect.objectContaining({ id: 999, name: "Barbell Bench Press", primary_muscle: "Back", secondary_muscle: "Triceps" }));
  });

  it("keeps a valid local identity accessible when body initialization fails", async () => {
    sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT, created_at TEXT);
      INSERT INTO users VALUES (1, 'Lifter', 'lifter@example.test', '', '${timestamp}');
      CREATE TABLE auth_session (id INTEGER PRIMARY KEY, user_id INTEGER, created_at TEXT);
      INSERT INTO auth_session VALUES (1, 1, '${timestamp}');
      CREATE TABLE body_weight_logs (id INTEGER PRIMARY KEY, weight REAL NOT NULL, unit TEXT, logged_at TEXT, logged_date TEXT, created_at TEXT);
      INSERT INTO body_weight_logs VALUES (1, 175, 'lb', '${timestamp}', '${date}', '${timestamp}');
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TRIGGER reject_body_checkpoint BEFORE INSERT ON app_settings
        WHEN NEW.key = 'body_measurements_legacy_migrated'
        BEGIN SELECT RAISE(ABORT, 'Migration checkpoint rejected'); END;`);
    native = await import("@/database/database.native");
    const identity = { id: 1, name: "Lifter", email: "lifter@example.test", password_hash: "", created_at: timestamp };
    expect(await native.loadCurrentUser()).toEqual(identity);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'body_measurement_logs'").get()).toBeUndefined();
    await expect(native.loadAllData()).rejects.toThrow("Migration checkpoint rejected");
    expect(await native.loadCurrentUser()).toEqual(identity);
    expect(rows("auth_session")).toHaveLength(1);
    expect(rows("body_weight_logs")).toHaveLength(1);
  });

  it("retries a failed first migration without mistaking an empty table for established modern authority", async () => {
    sqlite.exec(`CREATE TABLE body_weight_logs (
      id INTEGER PRIMARY KEY, weight REAL NOT NULL, unit TEXT, logged_at TEXT, logged_date TEXT, created_at TEXT);
      INSERT INTO body_weight_logs VALUES (1, 175, 'lb', '${timestamp}', '${date}', '${timestamp}');
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TRIGGER reject_body_checkpoint BEFORE INSERT ON app_settings
        WHEN NEW.key = 'body_measurements_legacy_migrated'
        BEGIN SELECT RAISE(ABORT, 'Migration checkpoint rejected'); END;`);
    const original = rows("body_weight_logs");
    await expect(initialize()).rejects.toThrow("Migration checkpoint rejected");
    expect(rows("body_weight_logs")).toEqual(original);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'body_measurement_logs'").get()).toBeUndefined();

    sqlite.exec("DROP TRIGGER reject_body_checkpoint");
    vi.resetModules();
    const recovered = await initialize();
    expect(recovered.bodyMeasurementLogs).toEqual([expect.objectContaining({ weight: 175, logged_date: date })]);
    await native.deleteBodyWeightLog(recovered.bodyMeasurementLogs[0].id);
    vi.resetModules();
    expect((await initialize()).bodyMeasurementLogs).toEqual([]);
    expect(rows("body_weight_logs")).toEqual(original);
  });

  it("migrates a pre-modern body record once and respects deletion on next startup", async () => {
    sqlite.exec(`CREATE TABLE body_weight_logs (
      id INTEGER PRIMARY KEY, weight REAL NOT NULL, unit TEXT, logged_at TEXT, logged_date TEXT, created_at TEXT);
      INSERT INTO body_weight_logs VALUES (1, 175, 'lb', '${timestamp}', '${date}', '${timestamp}');`);
    const first = await initialize();
    expect(first.bodyMeasurementLogs).toHaveLength(1);
    await native.deleteBodyWeightLog(first.bodyMeasurementLogs[0].id);
    expect(rows("body_weight_logs")).toHaveLength(1);

    vi.resetModules();
    const restarted = await initialize();
    expect(restarted.bodyMeasurementLogs).toEqual([]);
    expect(rows("body_weight_logs")).toHaveLength(1);
  });

  it("honors an existing empty modern store instead of guessing legacy deletions", async () => {
    sqlite.exec(schema);
    sqlite.prepare("INSERT INTO body_weight_logs (weight, unit, logged_at, logged_date, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(175, "lb", timestamp, date, timestamp);
    expect((await initialize()).bodyMeasurementLogs).toEqual([]);
    expect(rows("body_weight_logs")).toHaveLength(1);
    vi.resetModules();
    expect((await initialize()).bodyMeasurementLogs).toEqual([]);
  });

  it("keeps old custom exercises and their history during catalog initialization", async () => {
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO exercises (id, name, primary_muscle, created_at) VALUES (999, 'Legacy custom machine', 'Chest', '${timestamp}');
      INSERT INTO workout_sessions (id, workout_date, notes, created_at) VALUES (15, '${date}', 'Historical note', '${timestamp}');
      INSERT INTO workout_sets (id, session_id, exercise_id, set_number, reps, weight, created_at) VALUES (25, 15, 999, 1, 8, 100, '${timestamp}');`);
    const data = await initialize();
    expect(data.exercises).toContainEqual(expect.objectContaining({ id: 999, name: "Legacy custom machine" }));
    expect(data.sessions).toContainEqual(expect.objectContaining({ id: 15, notes: "Historical note" }));
    expect(data.sets).toContainEqual(expect.objectContaining({ id: 25, exercise_id: 999, session_id: 15 }));
  });

  it("deletes only the requested part of a compound body record", async () => {
    await initialize();
    await native.saveBodyMeasurementLog({ loggedDate: date, weight: 175, measurements: { waist: 80 }, notes: "Measured" });
    const id = (await native.loadAllData()).bodyMeasurementLogs[0].id;
    await native.deleteBodyWeightLog(id);
    expect((await native.loadAllData()).bodyMeasurementLogs).toEqual([expect.objectContaining({ weight: null, measurements: { waist: 80 } })]);
    await native.saveBodyWeightLog({ loggedDate: date, weight: 176, unit: "lb" });
    await native.deleteBodyMeasurementLog(id);
    expect((await native.loadAllData()).bodyMeasurementLogs).toEqual([expect.objectContaining({ weight: 176, measurements: {} })]);
  });
});

describe("native workout finalization", () => {
  it("can finish an unchanged draft that was reloaded after browser or app suspension", async () => {
    await initialize();
    await native.saveActiveWorkout(workout());
    const resumed = (await native.loadAllData()).activeWorkout!;
    await expect(native.finalizeActiveWorkout(resumed.startedAt, [completed(resumed)], resumed)).resolves.toBeUndefined();
    const finished = await native.loadAllData();
    expect(finished.activeWorkout).toBeNull();
    expect(finished.completedGuidedWorkouts).toEqual([completed(resumed)]);
  });

  it("keeps the active draft and prior archive when draft removal fails after archive writing", async () => {
    await initialize();
    const active = await native.saveActiveWorkout(workout());
    const old = completed({ ...active, startedAt: "2026-06-30T12:00:00.000Z" });
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("completed_guided_workouts", JSON.stringify([old]));
    sqlite.exec(`CREATE TRIGGER reject_draft_delete BEFORE DELETE ON app_settings
      WHEN OLD.key = 'active_workout' BEGIN SELECT RAISE(ABORT, 'Draft removal rejected'); END;`);
    await expect(native.finalizeActiveWorkout(active.startedAt, [completed(active), old], active)).rejects.toThrow("Draft removal rejected");
    const failed = await native.loadAllData();
    expect(failed.activeWorkout).toEqual(active);
    expect(failed.completedGuidedWorkouts).toEqual([old]);
    sqlite.exec("DROP TRIGGER reject_draft_delete");
    await native.finalizeActiveWorkout(active.startedAt, [completed(active), old], active);
    await native.finalizeActiveWorkout(active.startedAt, [completed(active), old], active);
    const retried = await native.loadAllData();
    expect(retried.activeWorkout).toBeNull();
    expect(retried.completedGuidedWorkouts).toEqual([completed(active), old]);
  });

  it("refuses to finish a stale workout while a different draft is active", async () => {
    await initialize();
    const newer = await native.saveActiveWorkout({ ...workout(), startedAt: "2026-07-02T12:00:00.000Z" });
    await expect(native.finalizeActiveWorkout(workout().startedAt, [completed()], workout())).rejects.toThrow(/another workout/i);
    expect((await native.loadAllData()).activeWorkout).toEqual(newer);
    expect((await native.loadAllData()).completedGuidedWorkouts).toEqual([]);
  });

  it.each(["finish", "discard"])("does not resurrect a %s draft through a delayed write", async (action) => {
    await initialize();
    const active = await native.saveActiveWorkout(workout());
    await native.finalizeActiveWorkout(active.startedAt, action === "finish" ? [completed(active)] : null, active);
    await native.saveActiveWorkout(active).catch(() => undefined);
    expect((await native.loadAllData()).activeWorkout).toBeNull();
    const newer = await native.saveActiveWorkout({ ...active, revision: 0, workoutId: "new-workout-id", startedAt: "2026-07-02T12:00:00.000Z" });
    expect((await native.loadAllData()).activeWorkout).toEqual(newer);
  });

  it("preserves newer edits to the same draft when an older snapshot tries to finish", async () => {
    await initialize();
    const active = workout();
    const newer = await native.saveActiveWorkout({ ...active, currentExercise: { ...active.currentExercise, notes: "New unsaved work" } });
    await expect(native.finalizeActiveWorkout(active.startedAt, [completed(active)], active)).rejects.toThrow(/changed|newer|reload|refresh/i);
    expect((await native.loadAllData()).activeWorkout).toEqual(newer);
    expect((await native.loadAllData()).completedGuidedWorkouts).toEqual([]);
  });

  it("refuses unscoped draft removal rather than deleting an active workout", async () => {
    await initialize();
    const saved = await native.saveActiveWorkout(workout());
    await expect(native.saveActiveWorkout(null)).rejects.toThrow();
    expect((await native.loadAllData()).activeWorkout).toEqual(saved);
  });

  it("uses explicit existing archive metadata to keep a historical draft retired", async () => {
    sqlite.exec(schema);
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("completed_guided_workouts", JSON.stringify([completed()]));
    await initialize();
    await native.saveActiveWorkout(workout()).catch(() => undefined);
    const data = await native.loadAllData();
    expect(data.activeWorkout).toBeNull();
    expect(data.completedGuidedWorkouts).toEqual([completed()]);
  });
});

describe("canonical native observation provenance", () => {
  it("captures an explicit unit and keeps unobserved RIR unknown", async () => {
    await initialize();
    const id = await native.logWorkout({ ...input(), inputUnit: "kg", recordingOrigin: "manual", sets: [{ reps: 5, weight: 100 }] });
    expect(sqlite.prepare("SELECT input_unit, recording_origin FROM workout_sessions WHERE id = ?").get(id)).toEqual({ input_unit: "kg", recording_origin: "manual" });
    expect(sqlite.prepare("SELECT rir FROM workout_sets WHERE session_id = ?").get(id)).toEqual({ rir: null });
    await native.updateWorkoutSession({ ...input(), sessionId: id, inputUnit: "lb" });
    expect(sqlite.prepare("SELECT input_unit, recording_origin FROM workout_sessions WHERE id = ?").get(id)).toEqual({ input_unit: "lb", recording_origin: "manual" });
  });

  it("allows a legacy uncertain retry without assigning newly supplied provenance", async () => {
    await initialize();
    const id = await native.logWorkout(input());
    expect(await native.logWorkout({ ...input(), inputUnit: "kg", recordingOrigin: "guided" })).toBe(id);
    expect(sqlite.prepare("SELECT input_unit, recording_origin FROM workout_sessions WHERE id = ?").get(id)).toEqual({ input_unit: null, recording_origin: null });
  });

  it("does not change original observations on invalid replacement or impossible dates", async () => {
    await initialize();
    const id = await native.logWorkout(input());
    const previous = rows("workout_sets");
    await expect(native.updateWorkoutSession({ ...input(), sessionId: id, workoutDate: "2026-02-30" })).rejects.toThrow(/calendar|date/i);
    await expect(native.updateWorkoutSession({ ...input(), sessionId: id, sets: [] })).rejects.toThrow(/at least one/);
    expect(rows("workout_sets")).toEqual(previous);
  });

  it("preserves unmatched raw archive evidence instead of pruning it during completion", async () => {
    await initialize();
    const oldArchives = Array.from({ length: 55 }, (_, index) => ({ ...completed(), startedAt: `old-${index}`, id: `old-${index}` }));
    const evidence = { unknownUnit: true, originalValue: 80 };
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("completed_guided_workouts", JSON.stringify([...oldArchives, evidence]));
    const saved = await native.saveActiveWorkout(workout());
    await native.finalizeActiveWorkout(saved.startedAt, [completed(saved)], saved);
    const raw = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'completed_guided_workouts'").get() as { value: string };
    expect(JSON.parse(raw.value)).toEqual([JSON.parse(JSON.stringify(completed(saved))), ...oldArchives.map((item) => JSON.parse(JSON.stringify(item))), evidence]);
  });
});

describe("native canonical capture lifecycle", () => {
  async function guidedAttempt() {
    const initial = workout();
    const active = await native.saveActiveWorkout({ ...initial, currentExercise: {
      ...initial.currentExercise, exerciseId, muscle: "Chest", requestId: "attempt-a",
      requestUnit: "lb", sets: [{ reps: "8", weight: "100" }, { reps: "7", weight: "100" }].map((set) => confirmGuidedObservation(set, {
        exerciseId, workoutDate: date, machineProfileId: "machine-a", unitSystem: "lb"
      })), machineProfileId: "machine-a", notes: input().notes
    } });
    const recording: WorkoutRecordingInput = { ...input(), workoutId: active.workoutId!, expectedActive: active,
      inputUnit: "lb", recordingOrigin: "guided", completedAt: `${date}T12:30:00.000Z` };
    return { active, recording };
  }

  it("commits observations, explicit workout membership and draft advancement together", async () => {
    await initialize();
    const { active, recording } = await guidedAttempt();
    const saved = await native.recordWorkoutEntry(recording);
    const data = await native.loadAllData();
    expect(saved.activeWorkout?.revision).toBe(active.revision! + 1);
    expect(data.sessions).toHaveLength(1);
    expect(data.sets.map((set) => [set.reps, set.weight])).toEqual([[8, 100], [7, 100]]);
    expect(data.workoutReferences).toEqual([{ workoutId: active.workoutId, sessionId: saved.sessionId, prescription: null, completedAt: recording.completedAt }]);
    expect(data.activeWorkout?.completedExercises).toEqual([expect.objectContaining({ sessionId: saved.sessionId, sets: [] })]);
    expect(data.activeWorkout?.currentExercise.exerciseId).toBeNull();
    expect(JSON.stringify(data.workoutRecords)).not.toContain("sets");
  });

  it.each(["reference", "draft"])("keeps prior valid draft when a later %s commit fails", async (failure) => {
    await initialize();
    const { active, recording } = await guidedAttempt();
    const metadata = rows("workout_records");
    if (failure === "reference") sqlite.exec(`CREATE TRIGGER reject_reference BEFORE INSERT ON workout_entry_references
      BEGIN SELECT RAISE(ABORT, 'Reference rejected'); END;`);
    else sqlite.exec(`CREATE TRIGGER reject_advance BEFORE INSERT ON app_settings WHEN NEW.key = 'active_workout'
      BEGIN SELECT RAISE(ABORT, 'Draft rejected'); END;`);
    await expect(native.recordWorkoutEntry(recording)).rejects.toThrow(/rejected/i);
    const failed = await native.loadAllData();
    expect(failed.activeWorkout).toEqual(active);
    expect(failed.sessions).toEqual([]);
    expect(failed.sets).toEqual([]);
    expect(failed.workoutReferences).toEqual([]);
    expect(rows("workout_write_requests")).toEqual([]);
    expect(rows("workout_records")).toEqual(metadata);
  });

  it("does not append or reset a newer draft when an earlier committed recording is retried", async () => {
    await initialize();
    const { recording } = await guidedAttempt();
    const saved = await native.recordWorkoutEntry(recording);
    const next = await native.saveActiveWorkout({ ...saved.activeWorkout!, currentExercise: {
      ...saved.activeWorkout!.currentExercise, exerciseId, muscle: "Chest", notes: "New observations being entered", requestId: "next-attempt"
    } });
    expect(await native.recordWorkoutEntry(recording)).toEqual({ sessionId: saved.sessionId, activeWorkout: next });
    expect((await native.loadAllData()).activeWorkout).toEqual(next);
    expect(rows("workout_sessions")).toHaveLength(1);
    expect(rows("workout_entry_references")).toHaveLength(1);
  });

  it("preserves both versions of a stale draft and does not commit its observations", async () => {
    await initialize();
    const { active, recording } = await guidedAttempt();
    const newer = await native.saveActiveWorkout({ ...active, currentExercise: { ...active.currentExercise, notes: "Newer edit" } });
    await expect(native.recordWorkoutEntry(recording)).rejects.toThrow(/newer.*draft/i);
    const data = await native.loadAllData();
    expect(data.activeWorkout).toEqual(newer);
    expect(data.recoveredWorkoutDrafts.map((item) => item.draft)).toEqual([active]);
    expect(data.sessions).toEqual([]);
    expect(data.workoutReferences).toEqual([]);
    await expect(native.recordWorkoutEntry(recording)).rejects.toThrow(/newer.*draft/i);
    expect((await native.loadAllData()).recoveredWorkoutDrafts).toHaveLength(1);
  });

  it("returns the same revision for identical draft retries and retains divergent stale versions", async () => {
    await initialize();
    const first = await native.saveActiveWorkout(workout());
    expect(await native.saveActiveWorkout(workout())).toEqual(first);
    const next = await native.saveActiveWorkout({ ...first, scheduleChanges: ["Reviewed plan"] });
    const stale = { ...first, scheduleChanges: ["Changed in another tab"] };
    await expect(native.saveActiveWorkout(stale)).rejects.toThrow(/newer.*draft/i);
    const data = await native.loadAllData();
    expect(data.activeWorkout).toEqual(next);
    expect(data.recoveredWorkoutDrafts.map((item) => item.draft)).toEqual([stale]);
  });

  it("does not reparent observations or resurrect a deleted recording through retries", async () => {
    await initialize();
    const recording = { ...input(), workoutId: "standalone-a", completedAt: timestamp, recordingOrigin: "manual" as const };
    const saved = await native.recordWorkoutEntry(recording);
    await expect(native.recordWorkoutEntry({ ...recording, workoutId: "standalone-b" })).rejects.toThrow(/another workout/i);
    await native.deleteWorkoutSession(saved.sessionId);
    vi.resetModules();
    const restarted = await initialize();
    expect(restarted.workoutReferences).toEqual([]);
    expect(restarted.workoutRecords).toEqual([expect.objectContaining({ id: "standalone-a" })]);
    await expect(native.recordWorkoutEntry(recording)).rejects.toThrow(/deleted/i);
    expect(rows("workout_sessions")).toEqual([]);
  });

  it("keeps reference membership and prior observations if deleting their session is rejected", async () => {
    await initialize();
    const saved = await native.recordWorkoutEntry({ ...input(), workoutId: "standalone-a", completedAt: timestamp, recordingOrigin: "manual" });
    const refs = rows("workout_entry_references");
    const sets = rows("workout_sets");
    sqlite.exec(`CREATE TRIGGER reject_session_delete BEFORE DELETE ON workout_sessions
      BEGIN SELECT RAISE(ABORT, 'Session deletion rejected'); END;`);
    await expect(native.deleteWorkoutSession(saved.sessionId)).rejects.toThrow("Session deletion rejected");
    expect(rows("workout_entry_references")).toEqual(refs);
    expect(rows("workout_sets")).toEqual(sets);
  });

  it("returns an old receipt without adding new group membership or clearing the draft", async () => {
    await initialize();
    const { active, recording } = await guidedAttempt();
    // Seed the pre-Phase-3 receipt without invoking the new guided-write guard.
    const id = await native.logWorkout({ ...input(), requestId: undefined });
    sqlite.prepare("DELETE FROM workout_entry_references WHERE session_id = ?").run(id);
    sqlite.prepare("INSERT INTO workout_write_requests (request_id, session_id, payload) VALUES (?, ?, ?)").run(recording.requestId!, id, workoutWritePayload(recording));
    expect(await native.recordWorkoutEntry(recording)).toEqual({ sessionId: id, activeWorkout: active });
    expect((await native.loadAllData()).workoutReferences).toEqual([]);
  });

  it("closes a discarded lifecycle while preserving its recorded observations", async () => {
    await initialize();
    const { recording } = await guidedAttempt();
    const saved = await native.recordWorkoutEntry(recording);
    await native.finalizeActiveWorkout(saved.activeWorkout!.startedAt, null, saved.activeWorkout);
    const data = await native.loadAllData();
    expect(data.activeWorkout).toBeNull();
    expect(data.workoutRecords).toEqual([expect.objectContaining({ id: recording.workoutId, status: "completed", finishedAt: null })]);
    expect(data.sessions).toHaveLength(1);
    expect(data.sets).toHaveLength(2);
    expect(data.workoutReferences).toHaveLength(1);
  });

  it("does not accept a guided recording without the corresponding saved draft", async () => {
    await initialize();
    await expect(native.recordWorkoutEntry({ ...input(), workoutId: "missing-draft", completedAt: timestamp, recordingOrigin: "guided" })).rejects.toThrow(/saved draft/i);
    expect(rows("workout_sessions")).toEqual([]);
  });

  it("rejects unconfirmed suggested values at the persistence boundary", async () => {
    await initialize();
    const { active, recording } = await guidedAttempt();
    const unconfirmed = await native.saveActiveWorkout({ ...active, currentExercise: { ...active.currentExercise,
      sets: active.currentExercise.sets.map(({ observationConfirmation: _confirmation, ...set }) => set)
    } });
    await expect(native.recordWorkoutEntry({ ...recording, expectedActive: unconfirmed })).rejects.toThrow(/mark it as performed/i);
    expect(rows("workout_sessions")).toEqual([]);
    expect(rows("workout_entry_references")).toEqual([]);
    expect((await native.loadAllData()).activeWorkout).toEqual(unconfirmed);
  });
});

describe("native one-time workout reference migration", () => {
  function seedHistory() {
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO exercises (id, name, primary_muscle, created_at) VALUES (999, 'Legacy exercise', 'Chest', '${timestamp}');
      INSERT INTO workout_sessions (id, workout_date, notes, created_at) VALUES (15, '${date}', 'Observed legacy work', '${timestamp}');
      INSERT INTO workout_sets (id, session_id, exercise_id, set_number, reps, weight, created_at) VALUES (25, 15, 999, 1, 8, 100, '${timestamp}');`);
    const raw = completed({ ...workout(), workoutId: undefined, revision: undefined, completedExercises: [{
      sessionId: 15, exerciseId: 999, exerciseName: "Legacy exercise", muscle: "Chest", sets: [{ reps: "200", weight: "1000" }], completedAt: timestamp
    }] });
    const evidence = { ...raw, unmappedSource: { preserved: true } };
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("completed_guided_workouts", JSON.stringify([evidence]));
    return JSON.stringify([evidence]);
  }

  it("migrates verified explicit links once, preserves source evidence and honors later deletion", async () => {
    const evidence = seedHistory();
    const first = await initialize();
    expect(first.workoutReferences).toEqual([expect.objectContaining({ sessionId: 15, prescription: null })]);
    expect(first.workoutRecords).toEqual([expect.objectContaining({ kind: "guided", legacyId: timestamp })]);
    expect(first.sets).toEqual([expect.objectContaining({ id: 25, reps: 8, weight: 100 })]);
    expect(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'completed_guided_workouts'").get()?.value).toBe(evidence);
    await native.deleteWorkoutSession(15);
    vi.resetModules();
    const restarted = await initialize();
    expect(restarted.sessions).toEqual([]);
    expect(restarted.workoutReferences).toEqual([]);
    expect(restarted.workoutRecords).toEqual(first.workoutRecords);
    expect(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'completed_guided_workouts'").get()?.value).toBe(evidence);
  });

  it("keeps a pre-checkpoint canonical relationship instead of re-parenting it from archived copies", async () => {
    seedHistory();
    const record = { id: "already-recorded", legacyId: null, kind: "standalone", status: "completed", startedAt: null, finishedAt: null,
      label: null, notes: null, templateId: null, scheduledDayId: null, plannedMuscles: [], scheduleChanges: [] };
    sqlite.prepare("INSERT INTO workout_records (id, value) VALUES (?, ?)").run(record.id, JSON.stringify(record));
    sqlite.prepare("INSERT INTO workout_entry_references (session_id, workout_id, completed_at) VALUES (?, ?, ?)").run(15, record.id, timestamp);
    const data = await initialize();
    expect(data.workoutRecords).toEqual([record]);
    expect(data.workoutReferences).toEqual([{ workoutId: record.id, sessionId: 15, prescription: null, completedAt: timestamp }]);
  });

  it("finishes a legacy draft using its raw saved snapshot without persisting normalized defaults", async () => {
    sqlite.exec(schema);
    const raw = { ...workout(), workoutId: undefined, revision: undefined, pendingMuscle: undefined,
      currentExercise: { muscle: null, exerciseId: null, sets: [], originalExerciseField: 7 }, originalField: true };
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("active_workout", JSON.stringify(raw));
    const data = await initialize();
    expect(data.activeWorkoutSnapshot?.currentExercise).not.toHaveProperty("notes");
    expect(data.activeWorkout?.currentExercise.notes).toBe("");
    await native.finalizeActiveWorkout(data.activeWorkout!.startedAt, null, data.activeWorkoutSnapshot);
    expect((await native.loadAllData()).activeWorkout).toBeNull();
  });

  it("does not infer workout grouping when different archives claim one observation", async () => {
    const evidence = JSON.parse(seedHistory());
    const conflicting = { ...evidence[0], id: "2026-07-02T12:00:00.000Z", startedAt: "2026-07-02T12:00:00.000Z" };
    const raw = JSON.stringify([...evidence, conflicting]);
    sqlite.prepare("UPDATE app_settings SET value = ? WHERE key = 'completed_guided_workouts'").run(raw);
    const data = await initialize();
    expect(data.workoutRecords).toEqual([expect.objectContaining({ kind: "standalone", legacyId: null })]);
    expect(data.workoutReferences).toEqual([expect.objectContaining({ sessionId: 15 })]);
    expect(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'completed_guided_workouts'").get()?.value).toBe(raw);
  });

  it("rolls back references and preserves observations when checkpoint commit fails", async () => {
    const raw = seedHistory();
    sqlite.exec(`CREATE TRIGGER reject_workout_checkpoint BEFORE INSERT ON app_settings
      WHEN NEW.key = 'workout_reference_migration_v1'
      BEGIN SELECT RAISE(ABORT, 'Workout checkpoint rejected'); END;`);
    await expect(initialize()).rejects.toThrow("Workout checkpoint rejected");
    expect(rows("workout_records")).toEqual([]);
    expect(rows("workout_entry_references")).toEqual([]);
    expect(rows("workout_sets")).toEqual([expect.objectContaining({ id: 25, reps: 8, weight: 100 })]);
    expect(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'completed_guided_workouts'").get()?.value).toBe(raw);
    sqlite.exec("DROP TRIGGER reject_workout_checkpoint");
    const retried = await initialize();
    expect(retried.workoutRecords).toHaveLength(1);
    expect(retried.workoutReferences).toHaveLength(1);
    vi.resetModules();
    const restarted = await initialize();
    expect(restarted.workoutRecords).toEqual(retried.workoutRecords);
    expect(restarted.workoutReferences).toEqual(retried.workoutReferences);
  });

  it("adds stable identity to a legacy active draft without dropping unknown original fields", async () => {
    sqlite.exec(schema);
    const active = { ...workout(), workoutId: undefined, revision: undefined, legacyField: { original: 1 } };
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("active_workout", JSON.stringify(active));
    const data = await initialize();
    expect(data.activeWorkout?.workoutId).toBeTruthy();
    expect(data.activeWorkout?.revision).toBe(0);
    const raw = JSON.parse(String(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'active_workout'").get()?.value));
    expect(raw.legacyField).toEqual({ original: 1 });
    expect(JSON.parse(String(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'workout_reference_legacy_active_evidence_v1'").get()?.value))).toEqual(JSON.parse(JSON.stringify(active)));
    vi.resetModules();
    expect((await initialize()).activeWorkout?.workoutId).toBe(data.activeWorkout?.workoutId);
  });

  it("preserves an uninterpretable legacy draft instead of silently replacing it with a new one", async () => {
    sqlite.exec(schema);
    const raw = JSON.stringify({ startedAt: timestamp, sourceNote: "Incomplete legacy evidence" });
    sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("active_workout", raw);
    await initialize();
    await expect(native.saveActiveWorkout(workout())).rejects.toThrow(/stored workout draft is invalid/i);
    expect(sqlite.prepare("SELECT value FROM app_settings WHERE key = 'active_workout'").get()?.value).toBe(raw);
    expect(rows("workout_records")).toEqual([]);
  });
});


describe("Phase 6 native import scope and provenance", () => {
  it("combines incoming channels, preserves RIR and provenance, and skips retries after deletion", async () => {
    await initialize();
    const user = await native.registerUser({ name: "Lifter", email: "import@example.test", password: "password123" });
    const data = { expectedAccountId: user.id, bodyWeightLogs: [{ loggedDate: date, weight: 180, unit: "kg" as const, weightInputUnit: "kg" as const }],
      bodyMeasurementLogs: [{ loggedDate: date, weight: null, measurements: { waist: 80 }, notes: "Tape", circumferenceInputUnit: "cm" as const }],
      workouts: [{ workoutDate: date, notes: "Imported", exerciseId, exerciseName: "Bench", inputUnit: "kg" as const, fingerprint: "external:source-one::original", sets: [{ reps: 8, weight: 100, rir: 1 }, { reps: 7, weight: 100 }] }], exerciseIdsToEnable: [] };
    expect(await native.importTrainingData(data)).toEqual({ inserted: { bodyCheckIns: 1, workouts: 1, sets: 2 }, skipped: { bodyCheckIns: 0, workouts: 0 }, failed: 0 });
    expect(rows("body_measurement_logs")[0]).toMatchObject({ weight: 180, weight_input_unit: "kg", circumference_input_unit: "cm" });
    expect(rows("workout_sets").map((set) => (set as { rir: number | null }).rir)).toEqual([1, null]);
    const id = (rows("workout_sessions")[0] as { id: number }).id;
    await native.deleteWorkoutSession(id);
    expect((await native.importTrainingData(data)).skipped).toEqual({ bodyCheckIns: 1, workouts: 1 });
    expect(rows("workout_sessions")).toHaveLength(0);
    const changed = { ...data, workouts: [{ ...data.workouts[0], notes: "Changed source", fingerprint: "external:source-one::changed", sets: [{ reps: 9, weight: 105, rir: 3 }] }] };
    expect((await native.importTrainingData(changed)).skipped.workouts).toBe(1);
    expect(rows("workout_sessions")).toHaveLength(0);
    changed.workouts[0].fingerprint = "external:source-two::changed";
    expect((await native.importTrainingData(changed)).inserted.workouts).toBe(1);
    const secondExerciseId = (await native.loadAllData()).exercises[1].id;
    const entry = (id: number, name: string, reps: number) => ({ workoutDate: "2026-07-03", notes: "Source", exerciseId: id, exerciseName: name, inputUnit: "lb" as const,
      fingerprint: `external:multi::2026-07-03::${name}::Source::${reps}x100`, sets: [{ reps, weight: 100 }] });
    const multi = { expectedAccountId: user.id, bodyWeightLogs: [], workouts: [entry(exerciseId, "bench", 5), entry(secondExerciseId, "row", 8)], exerciseIdsToEnable: [] };
    expect((await native.importTrainingData(multi)).inserted).toEqual({ bodyCheckIns: 0, workouts: 2, sets: 2 });
    expect((await native.importTrainingData({ ...multi, workouts: [entry(exerciseId, "bench", 6), entry(secondExerciseId, "row", 8)] })).skipped.workouts).toBe(2);
    await native.registerUser({ name: "Other", email: "other@example.test", password: "password123" });
    await expect(native.importTrainingData(data)).rejects.toThrow(/account changed/i);
    await expect(native.importTrainingData({ ...data, expectedAccountId: undefined })).rejects.toThrow(/requires one account/i);
  });
});
