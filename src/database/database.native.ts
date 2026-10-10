import * as SQLite from "expo-sqlite";

import { emptyActiveExercise, normalizeActiveWorkout, normalizeCompletedGuidedWorkouts } from "@/constants/activeWorkout";
import { catalogExercises } from "@/constants/exercises";
import { normalizeGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { normalizeMachineProfiles } from "@/constants/machineProfiles";
import { createDefaultTrainingSplit, normalizeTrainingSplit, upgradeUncustomisedTrainingSplit } from "@/constants/trainingSplit";
import { migrateLegacyBodyMeasurements } from "@/database/bodyMigration";
import { assertWorkoutWrite, matchesWorkoutWritePayload, sameStoredJson, WorkoutWriteInput, workoutWritePayload } from "@/database/workoutWrite";
import { baseSchema } from "@/database/schema";
import { buildWorkoutFingerprint, ImportBodyMeasurementLog, ImportBodyWeightLog, ImportWorkoutLog } from "@/services/import/importService";
import { ActiveWorkout, BodyMeasurementLog, BodyMeasurementValues, BodyUnitPreferences, BodyWeightLog, CompletedGuidedWorkout, Exercise, ExerciseScorePoint, GuidedWorkoutPreferences, MachineProfile, MuscleStrengthConfig, SocialData, TrainingSplit, TrainingSplitDay, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
import { defaultBodyUnitPreferences, normalizeBodyMeasurementLog, normalizeBodyUnitPreferences, parseStoredMeasurements } from "@/utils/bodyMeasurements";
import { assertCalendarDate } from "@/domain/calendar";
import { assertBodyCheckInWrite, BodyCheckInConflictError, BodyCheckInWriteInput, bodyCheckInObservationUnits, bodyCheckInWritePayload, sameBodyCheckInSnapshot } from "@/domain/bodyCheckInRecording";
import { advanceWorkoutDraft, assertGuidedRecordingInput, committedWorkoutDraft, DraftConflictError, planWorkoutReferenceMigration, RecoveredWorkoutDraft, standaloneWorkoutRecord, WorkoutEntryReference, WorkoutRecord, WorkoutRecordingInput, WorkoutRecordingResult, workoutRecordFromDraft } from "@/domain/workoutLifecycle";
import { hashPassword, normalizeEmail } from "@/utils/password";
import { emptyImportResult, hasImportedWorkoutReceipt, importedBodyCheckIns, TrainingImportInput } from "./importPersistence";
import { createRequestId } from "@/utils/requestId";

type Database = SQLite.SQLiteDatabase;

let databasePromise: Promise<Database> | null = null;
let connectionPromise: Promise<Database> | null = null;

function openDatabase(): Promise<Database> {
  if (!connectionPromise) {
    connectionPromise = SQLite.openDatabaseAsync("growth.db");
    connectionPromise.catch(() => { connectionPromise = null; });
  }
  return connectionPromise;
}

async function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await openDatabase();
      const modernTable = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["body_measurement_logs"]);
      await db.execAsync(baseSchema);
      await ensureBodyWeightLogSchema(db, !modernTable);
      await migrateLegacyBodyMeasurements(db, Boolean(modernTable));
      await ensureBodyMeasurementSchema(db);
      await ensureWorkoutSessionSchema(db);
      await ensureWorkoutSetSchema(db);
      await preserveLegacyCatalog(db);
      await ensureExerciseCatalog(db);
      await ensureCatalogAdditions(db);
      await seedRetiredWorkouts(db);
      await migrateWorkoutReferences(db);
      return db;
    })();
    databasePromise.catch(() => { databasePromise = null; });
  }
  return databasePromise;
}

async function migrateWorkoutReferences(db: Database) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const checkpoint = await tx.getFirstAsync("SELECT value FROM app_settings WHERE key = ?", ["workout_reference_migration_v1"]);
    if (checkpoint) return;
    const sessions = await tx.getAllAsync<WorkoutSession>("SELECT * FROM workout_sessions");
    const sets = await tx.getAllAsync<WorkoutSet>("SELECT * FROM workout_sets");
    const exercises = await tx.getAllAsync<Exercise>("SELECT * FROM exercises");
    const active = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["active_workout"]);
    const archives = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["completed_guided_workouts"]);
    const rawActive: unknown = active ? JSON.parse(active.value) : null;
    const rawArchive: unknown = archives ? JSON.parse(archives.value) : [];
    const recordRows = await tx.getAllAsync<{ value: string }>("SELECT value FROM workout_records");
    const referenceRows = await tx.getAllAsync<{ session_id: number; workout_id: string; prescription: string | null; completed_at: string | null }>("SELECT * FROM workout_entry_references");
    const workoutRecords = recordRows.map((row) => JSON.parse(row.value) as WorkoutRecord);
    const workoutReferences: WorkoutEntryReference[] = referenceRows.map((row) => ({ sessionId: row.session_id, workoutId: row.workout_id,
      prescription: row.prescription ? JSON.parse(row.prescription) : null, completedAt: row.completed_at }));
    const migration = planWorkoutReferenceMigration({ sessions, sets, exercises,
      activeWorkout: normalizeActiveWorkout(rawActive), workoutArchiveEvidence: rawArchive, workoutRecords, workoutReferences });
    for (const record of migration.records.filter((record) => !workoutRecords.some((existing) => existing.id === record.id))) await tx.runAsync("INSERT INTO workout_records (id, value) VALUES (?, ?)", [record.id, JSON.stringify(record)]);
    for (const reference of migration.references.filter((reference) => !workoutReferences.some((existing) => existing.sessionId === reference.sessionId))) await tx.runAsync(
      "INSERT INTO workout_entry_references (session_id, workout_id, prescription, completed_at) VALUES (?, ?, NULL, NULL)", [reference.sessionId, reference.workoutId]);
    // Keep the original legacy draft for reconciliation even after it is edited
    // or retired. It is evidence only and never supplies recorded observations.
    if (rawActive !== null) await tx.runAsync("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
      ["workout_reference_legacy_active_evidence_v1", JSON.stringify(rawActive)]);
    // Add identity to the original evidence without normalizing away unknown fields.
    if (migration.activeWorkout && rawActive && typeof rawActive === "object") await tx.runAsync(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["active_workout", JSON.stringify({ ...rawActive,
        workoutId: migration.activeWorkout.workoutId, revision: migration.activeWorkout.revision })]);
    await tx.runAsync("INSERT INTO app_settings (key, value) VALUES (?, ?)", ["workout_reference_migration_v1", JSON.stringify({ version: 1, completedAt: new Date().toISOString() })]);
  });
}

async function ensureWorkoutSessionSchema(db: Database) {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(workout_sessions)");
  if (!columns.some((column) => column.name === "machine_profile_id")) {
    await db.runAsync("ALTER TABLE workout_sessions ADD COLUMN machine_profile_id TEXT");
  }
  if (!columns.some((column) => column.name === "input_unit")) {
    await db.runAsync("ALTER TABLE workout_sessions ADD COLUMN input_unit TEXT CHECK (input_unit IN ('lb', 'kg'))");
  }
  if (!columns.some((column) => column.name === "recording_origin")) {
    await db.runAsync("ALTER TABLE workout_sessions ADD COLUMN recording_origin TEXT CHECK (recording_origin IN ('manual', 'guided', 'import'))");
  }
}

async function ensureWorkoutSetSchema(db: Database) {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(workout_sets)");
  if (!columns.some((column) => column.name === "is_warmup")) {
    await db.runAsync("ALTER TABLE workout_sets ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0");
  }
}

async function ensureBodyMeasurementSchema(db: Database) {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(body_measurement_logs)");
  if (!columns.some((column) => column.name === "weight_input_unit")) {
    await db.runAsync("ALTER TABLE body_measurement_logs ADD COLUMN weight_input_unit TEXT CHECK (weight_input_unit IN ('lb', 'kg'))");
  }
  if (!columns.some((column) => column.name === "circumference_input_unit")) {
    await db.runAsync("ALTER TABLE body_measurement_logs ADD COLUMN circumference_input_unit TEXT CHECK (circumference_input_unit IN ('cm', 'in'))");
  }
}

async function ensureBodyWeightLogSchema(db: Database, importLegacyAlias: boolean) {
  const renamed = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["bodyweight_logs"]);
  if (renamed && importLegacyAlias) {
    await db.runAsync(`
      INSERT INTO body_weight_logs (weight, unit, logged_at, logged_date, created_at)
      SELECT weight, unit, logged_at, substr(logged_at, 1, 10), created_at
      FROM bodyweight_logs
      WHERE NOT EXISTS (
        SELECT 1 FROM body_weight_logs WHERE body_weight_logs.id = bodyweight_logs.id
      )
    `);
  }

  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(body_weight_logs)");
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("unit")) {
    // Preserve missing legacy metadata rather than assigning an invented unit.
    await db.runAsync("ALTER TABLE body_weight_logs ADD COLUMN unit TEXT");
  }
  if (!columnNames.has("logged_at")) {
    await db.runAsync("ALTER TABLE body_weight_logs ADD COLUMN logged_at TEXT");
  }
  if (!columnNames.has("logged_date")) {
    await db.runAsync("ALTER TABLE body_weight_logs ADD COLUMN logged_date TEXT");
  }

  await db.runAsync("UPDATE body_weight_logs SET logged_date = COALESCE(logged_date, substr(logged_at, 1, 10), substr(created_at, 1, 10))");
  await db.runAsync("UPDATE body_weight_logs SET logged_at = COALESCE(logged_at, logged_date || 'T12:00:00.000Z', created_at)");
}

async function preserveLegacyCatalog(db: Database) {
  // Older releases deleted sample/catalog history here. Never infer that records are disposable.
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((version?.user_version ?? 0) < 1) await db.execAsync("PRAGMA user_version = 1");
}

async function ensureExerciseCatalog(db: Database) {
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((version?.user_version ?? 0) >= 2) return;
  await db.withTransactionAsync(async () => {
    for (const exercise of catalogExercises) {
      const existing = await db.getFirstAsync<{ id: number }>("SELECT id FROM exercises WHERE name = ?", [exercise.name]);
      if (!existing) await db.runAsync("INSERT INTO exercises (name, primary_muscle, secondary_muscle, is_strength_exercise, created_at) VALUES (?, ?, ?, 0, ?)",
        [exercise.name, exercise.primary_muscle, exercise.secondary_muscle ?? null, new Date().toISOString()]);
    }
    await db.execAsync("PRAGMA user_version = 2");
  });
}

async function ensureCatalogAdditions(db: Database) {
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((version?.user_version ?? 0) >= 8) return;

  const timestamp = new Date().toISOString();
  for (const exercise of catalogExercises) {
    const existing = await db.getFirstAsync<{ id: number }>("SELECT id FROM exercises WHERE name = ?", [exercise.name]);
    if (!existing) {
      await db.runAsync(
        "INSERT INTO exercises (name, primary_muscle, secondary_muscle, is_strength_exercise, created_at) VALUES (?, ?, ?, 0, ?)",
        [exercise.name, exercise.primary_muscle, exercise.secondary_muscle ?? null, timestamp]
      );
    }
  }

  await db.execAsync("PRAGMA user_version = 8");
}

export async function loadCurrentUser(): Promise<User | null> {
  const db = await openDatabase();
  const authTable = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["auth_session"]);
  if (!authTable) return null;
  return db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1");
}

export async function loadAllData() {
  const db = await getDatabase();
  const [currentUser, unitSetting, bodyUnitSetting, trainingSplitSetting, activeWorkoutSetting, guidedWorkoutSetting, completedWorkoutsSetting, machineProfilesSetting] = await Promise.all([
    db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1"),
    db.getFirstAsync<{ value: UnitSystem }>("SELECT value FROM app_settings WHERE key = ?", ["unit_system"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["body_unit_preferences"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["training_split"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["active_workout"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["guided_workout_preferences"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["completed_guided_workouts"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["machine_profiles"])
  ]);
  const [exercises, sessions, sets, bodyMeasurementRows, configs, recordRows, referenceRows, recoveredSetting] = await Promise.all([
    db.getAllAsync<Exercise>(
      `
      SELECT
        exercises.id,
        exercises.name,
        exercises.primary_muscle,
        exercises.secondary_muscle,
        COALESCE(user_exercise_preferences.enabled, 0) as is_strength_exercise,
        exercises.created_at
      FROM exercises
      LEFT JOIN user_exercise_preferences
        ON user_exercise_preferences.exercise_id = exercises.id
        AND user_exercise_preferences.user_id = ?
      ORDER BY exercises.name
      `,
      [currentUser?.id ?? -1]
    ),
    db.getAllAsync<WorkoutSession>("SELECT * FROM workout_sessions ORDER BY workout_date DESC"),
    db.getAllAsync<WorkoutSet>("SELECT * FROM workout_sets ORDER BY created_at ASC, set_number ASC"),
    db.getAllAsync<Omit<BodyMeasurementLog, "measurements"> & { measurements: string }>("SELECT * FROM body_measurement_logs ORDER BY logged_at DESC, created_at DESC"),
    db.getAllAsync<MuscleStrengthConfig>("SELECT * FROM muscle_strength_config ORDER BY muscle_group"),
    db.getAllAsync<{ value: string }>("SELECT value FROM workout_records ORDER BY rowid"),
    db.getAllAsync<{ session_id: number; workout_id: string; prescription: string | null; completed_at: string | null }>("SELECT * FROM workout_entry_references ORDER BY session_id"),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["recovered_workout_drafts"])
  ]);

  const unitSystem: UnitSystem = unitSetting?.value === "kg" ? "kg" : "lb";
  const bodyUnitPreferences = bodyUnitSetting?.value ? normalizeBodyUnitPreferences(JSON.parse(bodyUnitSetting.value)) : defaultBodyUnitPreferences;
  const bodyMeasurementLogs = bodyMeasurementRows.map((row) => normalizeBodyMeasurementLog({ ...row, measurements: parseStoredMeasurements(row.measurements) }));
  const trainingSplit = trainingSplitSetting?.value ? upgradeUncustomisedTrainingSplit(normalizeTrainingSplit(JSON.parse(trainingSplitSetting.value))) : createDefaultTrainingSplit();
  const activeWorkoutSnapshot: ActiveWorkout | null = activeWorkoutSetting?.value ? JSON.parse(activeWorkoutSetting.value) : null;
  const activeWorkout = normalizeActiveWorkout(activeWorkoutSnapshot);
  const guidedWorkoutPreferences = normalizeGuidedWorkoutPreferences(guidedWorkoutSetting?.value ? JSON.parse(guidedWorkoutSetting.value) : null);
  const completedGuidedWorkouts = normalizeCompletedGuidedWorkouts(completedWorkoutsSetting?.value ? JSON.parse(completedWorkoutsSetting.value) : null);
  const workoutArchiveEvidence: unknown = completedWorkoutsSetting?.value ? JSON.parse(completedWorkoutsSetting.value) : [];
  const machineProfiles = normalizeMachineProfiles(machineProfilesSetting?.value ? JSON.parse(machineProfilesSetting.value) : null);
  const workoutRecords = recordRows.map((row) => JSON.parse(row.value) as WorkoutRecord);
  const workoutReferences: WorkoutEntryReference[] = referenceRows.map((row) => ({
    workoutId: row.workout_id, sessionId: row.session_id,
    prescription: row.prescription ? JSON.parse(row.prescription) : null, completedAt: row.completed_at
  }));
  const recoveredWorkoutDrafts: RecoveredWorkoutDraft[] = recoveredSetting ? JSON.parse(recoveredSetting.value) : [];
  return { exercises, sessions, sets, bodyMeasurementLogs, configs, currentUser: currentUser ?? null, unitSystem, bodyUnitPreferences, trainingSplit, activeWorkout, activeWorkoutSnapshot, guidedWorkoutPreferences, completedGuidedWorkouts, workoutArchiveEvidence, machineProfiles, workoutRecords, workoutReferences, recoveredWorkoutDrafts };
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  const db = await getDatabase();
  const email = normalizeEmail(input.email);
  const existing = await db.getFirstAsync<User>("SELECT * FROM users WHERE email = ?", [email]);
  if (existing) throw new Error("An account already exists for this email.");

  const result = await db.runAsync("INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)", [
    input.name.trim(),
    email,
    hashPassword(input.password, email),
    new Date().toISOString()
  ]);

  await setCurrentUser(db, result.lastInsertRowId);
  const user = await db.getFirstAsync<User>("SELECT * FROM users WHERE id = ?", [result.lastInsertRowId]);
  if (!user) throw new Error("Could not create account.");
  return user;
}

export async function loginUser(input: { email: string; password: string }) {
  const db = await getDatabase();
  const email = normalizeEmail(input.email);
  const user = await db.getFirstAsync<User>("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || user.password_hash !== hashPassword(input.password, email)) {
    throw new Error("Email or password is incorrect.");
  }

  await setCurrentUser(db, Number(user.id));
  return user;
}

export async function logoutUser() {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM auth_session");
}

export async function requestPasswordReset(_input: { email: string }) {
  throw new Error("Password reset is available on the Supabase-powered website.");
}

export async function updateCurrentUserPassword(_input: { password: string }) {
  throw new Error("Password reset is available on the Supabase-powered website.");
}

export async function setExerciseEnabled(exerciseId: number, enabled: boolean) {
  const db = await getDatabase();
  const currentUser = await db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1");
  if (!currentUser) throw new Error("Please log in again.");
  const timestamp = new Date().toISOString();
  await db.runAsync(
    `
    INSERT INTO user_exercise_preferences (user_id, exercise_id, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, exercise_id)
    DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `,
    [currentUser.id, exerciseId, enabled ? 1 : 0, timestamp, timestamp]
  );
}

type Transaction = Pick<Database, "getFirstAsync" | "getAllAsync" | "runAsync">;
async function workoutReceipt(tx: Transaction, input: WorkoutWriteInput): Promise<number | null> {
  const receipt = input.requestId ? await tx.getFirstAsync<{ session_id: number | null; payload: string }>("SELECT session_id, payload FROM workout_write_requests WHERE request_id = ?", [input.requestId]) : null;
  if (!receipt) return null;
  if (!matchesWorkoutWritePayload(receipt.payload, input)) throw new Error("This save attempt already has different values. Resolve the previous attempt before recording another.");
  if (receipt.session_id === null || !await tx.getFirstAsync("SELECT id FROM workout_sessions WHERE id = ?", [receipt.session_id])) throw new Error("This recorded workout was deleted. An old retry cannot recreate it.");
  return receipt.session_id;
}

async function insertWorkoutEntry(tx: Transaction, input: WorkoutWriteInput): Promise<number> {
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  const session = await tx.runAsync("INSERT INTO workout_sessions (workout_date, notes, machine_profile_id, input_unit, recording_origin, created_at) VALUES (?, ?, ?, ?, ?, ?)", [input.workoutDate, input.notes, input.machineProfileId ?? null, input.inputUnit ?? null, input.recordingOrigin ?? null, timestamp]);
  const sessionId = session.lastInsertRowId;
  for (const [index, set] of input.sets.entries()) await tx.runAsync(
    "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, is_warmup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [sessionId, input.exerciseId, index + 1, set.reps, set.weight, null, set.isWarmup ? 1 : 0, timestamp]);
  if (input.requestId) await tx.runAsync("INSERT INTO workout_write_requests (request_id, session_id, payload) VALUES (?, ?, ?)", [input.requestId, sessionId, workoutWritePayload(input)]);
  return sessionId;
}

export async function logWorkout(input: WorkoutWriteInput): Promise<number> {
  assertWorkoutWrite(input);
  const db = await getDatabase();
  let sessionId = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const existing = await workoutReceipt(tx, input);
    if (existing !== null) { sessionId = existing; return; }
    if (input.recordingOrigin === "guided") throw new Error("New guided observations require confirmed atomic recording.");
    sessionId = await insertWorkoutEntry(tx, input);
    const record = standaloneWorkoutRecord(createRequestId());
    await tx.runAsync("INSERT INTO workout_records (id, value) VALUES (?, ?)", [record.id, JSON.stringify(record)]);
    await tx.runAsync("INSERT INTO workout_entry_references (session_id, workout_id, prescription, completed_at) VALUES (?, ?, NULL, NULL)", [sessionId, record.id]);
  });
  return sessionId;
}

export async function recordWorkoutEntry(input: WorkoutRecordingInput): Promise<WorkoutRecordingResult> {
  assertWorkoutWrite(input);
  if (!input.requestId?.trim() || !input.workoutId?.trim()) throw new Error("Recording requires a stable save attempt and workout identity.");
  if (input.recordingOrigin === "guided" && !input.expectedActive) throw new Error("Guided recording requires its saved draft and confirmed observations.");
  if (input.recordingOrigin !== "guided" && input.recordingOrigin !== "manual") throw new Error("A manual or guided recording origin is required.");
  if (input.recordingOrigin === "manual" && input.expectedActive) throw new Error("Manual recording cannot advance a guided draft.");
  const db = await getDatabase();
  let result: WorkoutRecordingResult = { sessionId: 0, activeWorkout: null };
  try {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const active = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["active_workout"]);
      const current = active ? normalizeActiveWorkout(JSON.parse(active.value)) : null;
      const receipt = await workoutReceipt(tx, input);
      if (receipt !== null) {
        const reference = await tx.getFirstAsync<{ workout_id: string }>("SELECT workout_id FROM workout_entry_references WHERE session_id = ?", [receipt]);
        if (reference && reference.workout_id !== input.workoutId) throw new Error("This recording already belongs to another workout. Its observations cannot be moved by a retry.");
        result = { sessionId: receipt, activeWorkout: current };
        return;
      }
      let record: WorkoutRecord;
      if (input.expectedActive) {
        if (!current) throw new DraftConflictError(input.expectedActive, null);
        const retired = await tx.getFirstAsync("SELECT workout_id FROM retired_active_workouts WHERE workout_id = ?", [current.startedAt]);
        if (retired) throw new Error("This workout has already ended. Reload before recording more work.");
        // Check the draft before even attempting to write observations.
        committedWorkoutDraft(current, input, 0);
        const exercise = await tx.getFirstAsync<Exercise>("SELECT * FROM exercises WHERE id = ?", [input.exerciseId]);
        if (!exercise) throw new Error("The selected exercise no longer exists. Review the draft before recording.");
        assertGuidedRecordingInput(input, exercise);
        record = workoutRecordFromDraft(current);
      } else record = standaloneWorkoutRecord(input.workoutId);
      const existingRecord = await tx.getFirstAsync<{ value: string }>("SELECT value FROM workout_records WHERE id = ?", [input.workoutId]);
      if (existingRecord) {
        const stored = JSON.parse(existingRecord.value) as WorkoutRecord;
        if (stored.kind !== record.kind || stored.startedAt !== record.startedAt || (input.expectedActive && stored.status !== "active")) throw new Error("This workout identity is already used by another lifecycle.");
      } else await tx.runAsync("INSERT INTO workout_records (id, value) VALUES (?, ?)", [record.id, JSON.stringify(record)]);
      const sessionId = await insertWorkoutEntry(tx, input);
      await tx.runAsync("INSERT INTO workout_entry_references (session_id, workout_id, prescription, completed_at) VALUES (?, ?, ?, ?)",
        [sessionId, input.workoutId, input.expectedActive?.currentExercise.prescription ? JSON.stringify(input.expectedActive.currentExercise.prescription) : null, input.completedAt]);
      const next = input.expectedActive && current ? committedWorkoutDraft(current, input, sessionId) : current;
      if (input.expectedActive) await tx.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["active_workout", JSON.stringify(next)]);
      result = { sessionId, activeWorkout: next };
    });
  } catch (error) {
    if (error instanceof DraftConflictError) await preserveRecoveredDraft(db, error.draft);
    throw error;
  }
  return result;
}

export async function importTrainingData(input: TrainingImportInput) {
  const bodyRows = importedBodyCheckIns(input);
  const db = await getDatabase();
  const initiatingUser = await db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1");
  if (!initiatingUser) throw new Error("Please log in again.");
  const expectedAccountId = input.expectedAccountId ?? initiatingUser.id;
  const result = emptyImportResult();
  const timestamp = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const currentUser = await tx.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1");
    if (!currentUser || currentUser.id !== expectedAccountId) throw new Error("Your account changed. Review the import before retrying.");
    const accounts = await tx.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM users");
    if (accounts?.count !== 1) throw new Error("Local import requires one account because existing local history has no account ownership. Use a cloud account to import separately.");
    for (const log of bodyRows) {
      const write = await tx.runAsync(
        `INSERT INTO body_measurement_logs (weight, measurements, notes, logged_at, logged_date, created_at, updated_at, weight_input_unit, circumference_input_unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(logged_date) DO NOTHING`,
        [log.weight, JSON.stringify(log.measurements), log.notes, `${log.loggedDate}T12:00:00.000Z`, log.loggedDate, timestamp, timestamp,
          log.weight == null ? null : log.weightInputUnit ?? null, Object.keys(log.measurements).length ? log.circumferenceInputUnit ?? null : null]
      );
      if (write.changes) result.inserted.bodyCheckIns++; else result.skipped.bodyCheckIns++;
    }

    for (const exerciseId of input.exerciseIdsToEnable) {
      await tx.runAsync(
        `
        INSERT INTO user_exercise_preferences (user_id, exercise_id, enabled, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, exercise_id)
        DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
        `,
        [currentUser.id, exerciseId, timestamp, timestamp]
      );
    }

    const importedFingerprints = await getImportedWorkoutFingerprints(tx);
    const priorReceipts = new Set(importedFingerprints);
    const existingFingerprints = await getExistingWorkoutFingerprints(tx);

    for (const workout of input.workouts) {
      if (hasImportedWorkoutReceipt(priorReceipts, importedFingerprints, workout.fingerprint) || existingFingerprints.has(workout.fingerprint)) { result.skipped.workouts++; continue; }

      const createdAt = `${workout.workoutDate}T12:00:00.000Z`;
      const session = await tx.runAsync("INSERT INTO workout_sessions (workout_date, notes, input_unit, recording_origin, created_at) VALUES (?, ?, ?, 'import', ?)", [workout.workoutDate, workout.notes, workout.inputUnit ?? null, createdAt]);
      for (const [index, set] of workout.sets.entries()) {
        await tx.runAsync(
          "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, is_warmup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [session.lastInsertRowId, workout.exerciseId, index + 1, set.reps, set.weight, set.rir ?? null, set.isWarmup ? 1 : 0, createdAt]
        );
      }
      const record = standaloneWorkoutRecord(createRequestId());
      await tx.runAsync("INSERT INTO workout_records (id, value) VALUES (?, ?)", [record.id, JSON.stringify(record)]);
      await tx.runAsync("INSERT INTO workout_entry_references (session_id, workout_id, prescription, completed_at) VALUES (?, ?, NULL, NULL)", [session.lastInsertRowId, record.id]);

      result.inserted.workouts++;
      result.inserted.sets += workout.sets.length;
      importedFingerprints.add(workout.fingerprint);
      existingFingerprints.add(workout.fingerprint);
    }

    if (input.workouts.length) {
      await setImportedWorkoutFingerprints(tx, importedFingerprints);
    }
  });
  return result;
}

export async function deleteWorkoutSession(sessionId: number) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM workout_sets WHERE session_id = ?", [sessionId]);
    await tx.runAsync("DELETE FROM workout_entry_references WHERE session_id = ?", [sessionId]);
    await tx.runAsync("DELETE FROM workout_sessions WHERE id = ?", [sessionId]);
    await tx.runAsync("UPDATE workout_write_requests SET session_id = NULL WHERE session_id = ?", [sessionId]);
  });
}

export async function updateWorkoutSession(input: WorkoutWriteInput & { sessionId: number }) {
  assertWorkoutWrite(input);
  const db = await getDatabase();
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const existing = await tx.getFirstAsync<{ id: number }>("SELECT id FROM workout_sessions WHERE id = ?", [input.sessionId]);
    if (!existing) throw new Error("This workout no longer exists. Reload before editing it.");
    await tx.runAsync("UPDATE workout_sessions SET workout_date = ?, notes = ?, machine_profile_id = ?, input_unit = ? WHERE id = ?", [input.workoutDate, input.notes, input.machineProfileId ?? null, input.inputUnit ?? null, input.sessionId]);
    await tx.runAsync("DELETE FROM workout_sets WHERE session_id = ?", [input.sessionId]);

    for (const [index, set] of input.sets.entries()) {
      await tx.runAsync(
        "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, is_warmup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [input.sessionId, input.exerciseId, index + 1, set.reps, set.weight, null, set.isWarmup ? 1 : 0, timestamp]
      );
    }
  });
}

export async function updateWorkoutSessionMachineProfile(input: { sessionId: number; machineProfileId?: string | null }) {
  const db = await getDatabase();
  const result = await db.runAsync("UPDATE workout_sessions SET machine_profile_id = ? WHERE id = ?", [input.machineProfileId ?? null, input.sessionId]);
  if (!result.changes) throw new Error("This workout no longer exists. Reload before editing it.");
}

type StoredBodyCheckIn = Omit<BodyMeasurementLog, "measurements"> & { measurements: string };

/** Preserve the saved snapshot when checking edits, including legacy values
 * that the display normalizer may omit. Ambiguous evidence is never replaced
 * merely because it cannot be represented by the current form. */
function readStoredBodyCheckIn(row: StoredBodyCheckIn): BodyMeasurementLog {
  try {
    return { ...row, measurements: JSON.parse(row.measurements) };
  } catch {
    throw new BodyCheckInConflictError("This body check-in contains unreadable historical measurements. Reload and reconcile it before editing.");
  }
}

async function currentBodyAccount(db: Database) {
  const session = await db.getFirstAsync<{ user_id: number }>("SELECT user_id FROM auth_session WHERE id = 1");
  return session?.user_id ?? null;
}

function bodyUpdatedAt(previous?: BodyMeasurementLog) {
  // Keep the saved version distinct even when repeated mobile taps or edits
  // happen within one clock tick.
  const previousTime = previous ? Date.parse(previous.updated_at) : NaN;
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

/** One receipt and one whole canonical check-in commit together. A retry
 * returns the current observation by its original ID; it never reapplies an
 * older value over subsequent edits. */
export async function recordBodyCheckIn(input: BodyCheckInWriteInput): Promise<BodyMeasurementLog> {
  assertBodyCheckInWrite(input);
  const db = await getDatabase();
  const accountId = await currentBodyAccount(db);
  if (input.accountId !== undefined && String(input.accountId) !== String(accountId)) throw new BodyCheckInConflictError("The account changed. Reload before saving this body check-in.");
  const payload = JSON.stringify({ accountId, write: bodyCheckInWritePayload(input) });
  let recorded: BodyMeasurementLog | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await currentBodyAccount(tx) !== accountId) throw new BodyCheckInConflictError("The account changed. Reload before saving this body check-in.");
    const receipt = await tx.getFirstAsync<{ body_id: number | null; payload: string }>(
      "SELECT body_id, payload FROM body_check_in_write_requests WHERE request_id = ?", [input.requestId]);
    if (receipt) {
      if (!sameStoredJson(JSON.parse(receipt.payload), JSON.parse(payload))) throw new Error("This body check-in save attempt has already been used with different values or another account.");
      const existing = receipt.body_id === null ? null : await tx.getFirstAsync<StoredBodyCheckIn>(
        "SELECT * FROM body_measurement_logs WHERE id = ?", [receipt.body_id]);
      if (!existing) throw new BodyCheckInConflictError("The recorded body check-in was deleted. This save attempt cannot recreate it.");
      recorded = readStoredBodyCheckIn(existing);
      return;
    }

    let previous: BodyMeasurementLog | undefined;
    if (input.id !== undefined) {
      const row = await tx.getFirstAsync<StoredBodyCheckIn>("SELECT * FROM body_measurement_logs WHERE id = ?", [input.id]);
      if (!row) throw new BodyCheckInConflictError("This body check-in no longer exists. Reload before editing it.");
      previous = readStoredBodyCheckIn(row);
      if (!input.expected || !sameBodyCheckInSnapshot(previous, input.expected)) throw new BodyCheckInConflictError("This body check-in changed. Reload and review it before saving.");
    }
    const occupied = await tx.getFirstAsync<{ id: number }>("SELECT id FROM body_measurement_logs WHERE logged_date = ?", [input.loggedDate]);
    if (occupied && occupied.id !== input.id) throw new BodyCheckInConflictError("A body check-in already exists for this date. Open and edit that check-in instead.");
    const updatedAt = bodyUpdatedAt(previous);
    const units = bodyCheckInObservationUnits(input);
    const weightUnit = units.weight_input_unit;
    const circumferenceUnit = units.circumference_input_unit;
    let bodyId: number;
    if (previous) {
      await tx.runAsync(`UPDATE body_measurement_logs
        SET weight = ?, measurements = ?, notes = ?, logged_at = ?, logged_date = ?, updated_at = ?,
          weight_input_unit = ?, circumference_input_unit = ? WHERE id = ?`,
      [input.weight, JSON.stringify(input.measurements), input.notes?.trim() || null, `${input.loggedDate}T12:00:00.000Z`,
        input.loggedDate, updatedAt, weightUnit, circumferenceUnit, previous.id]);
      bodyId = previous.id;
    } else {
      const result = await tx.runAsync(`INSERT INTO body_measurement_logs
        (weight, measurements, notes, logged_at, logged_date, created_at, updated_at, weight_input_unit, circumference_input_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.weight, JSON.stringify(input.measurements), input.notes?.trim() || null, `${input.loggedDate}T12:00:00.000Z`,
        input.loggedDate, updatedAt, updatedAt, weightUnit, circumferenceUnit]);
      bodyId = result.lastInsertRowId;
    }
    await tx.runAsync("INSERT INTO body_check_in_write_requests (request_id, body_id, payload) VALUES (?, ?, ?)",
      [input.requestId, bodyId, payload]);
    recorded = readStoredBodyCheckIn((await tx.getFirstAsync<StoredBodyCheckIn>("SELECT * FROM body_measurement_logs WHERE id = ?", [bodyId]))!);
  });
  if (!recorded) throw new Error("The body check-in was not saved.");
  return recorded;
}

/** Whole deletion preserves retry tombstones and rolls them back with the
 * observation if persistence fails at any step. */
export async function deleteBodyCheckIn(id: number, expected?: BodyMeasurementLog, initiatingAccountId?: number | string): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Choose a valid body check-in.");
  const db = await getDatabase();
  const accountId = await currentBodyAccount(db);
  if (initiatingAccountId !== undefined && String(initiatingAccountId) !== String(accountId)) throw new BodyCheckInConflictError("The account changed. Reload before deleting this body check-in.");
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await currentBodyAccount(tx) !== accountId) throw new BodyCheckInConflictError("The account changed. Reload before deleting this body check-in.");
    const row = await tx.getFirstAsync<StoredBodyCheckIn>("SELECT * FROM body_measurement_logs WHERE id = ?", [id]);
    if (!row) return;
    if (expected && !sameBodyCheckInSnapshot(readStoredBodyCheckIn(row), expected)) throw new BodyCheckInConflictError("This body check-in changed. Reload and review it before deleting.");
    await tx.runAsync("UPDATE body_check_in_write_requests SET body_id = NULL WHERE body_id = ?", [id]);
    await tx.runAsync("DELETE FROM body_measurement_logs WHERE id = ?", [id]);
  });
}

export async function saveBodyWeightLog(input: { loggedDate: string; weight: number; unit: UnitSystem }) {
  assertCalendarDate(input.loggedDate);
  const db = await getDatabase();
  const timestamp = new Date().toISOString();
  await db.runAsync(
    `
    INSERT INTO body_measurement_logs (weight, measurements, notes, logged_at, logged_date, created_at, updated_at, weight_input_unit)
    VALUES (?, '{}', NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(logged_date)
    DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at, weight_input_unit = excluded.weight_input_unit
    `,
    [input.weight, `${input.loggedDate}T12:00:00.000Z`, input.loggedDate, timestamp, timestamp, input.unit]
  );
}

export async function updateBodyWeightLog(input: { id: number; loggedDate: string; weight: number; unit: UnitSystem }) {
  assertCalendarDate(input.loggedDate);
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE body_measurement_logs SET weight = ?, logged_at = ?, logged_date = ?, updated_at = ?, weight_input_unit = ? WHERE id = ?",
    [input.weight, `${input.loggedDate}T12:00:00.000Z`, input.loggedDate, new Date().toISOString(), input.unit, input.id]
  );
}

export async function deleteBodyWeightLog(id: number) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ weight: number | null; measurements: string }>("SELECT weight, measurements FROM body_measurement_logs WHERE id = ?", [id]);
    if (!row) return;
    if (Object.keys(parseStoredMeasurements(row.measurements)).length) await tx.runAsync("UPDATE body_measurement_logs SET weight = NULL, weight_input_unit = NULL, updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    else await tx.runAsync("DELETE FROM body_measurement_logs WHERE id = ?", [id]);
  });
}

export async function saveBodyMeasurementLog(input: { loggedDate: string; weight: number | null; measurements: BodyMeasurementValues; notes?: string | null }) {
  assertCalendarDate(input.loggedDate);
  const db = await getDatabase();
  const timestamp = new Date().toISOString();
  await db.runAsync(
    `
    INSERT INTO body_measurement_logs (weight, measurements, notes, logged_at, logged_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(logged_date)
    DO UPDATE SET
      weight = excluded.weight,
      measurements = excluded.measurements,
      notes = excluded.notes,
      logged_at = excluded.logged_at,
      updated_at = excluded.updated_at,
      weight_input_unit = NULL,
      circumference_input_unit = NULL
    `,
    [input.weight, JSON.stringify(input.measurements), input.notes?.trim() || null, `${input.loggedDate}T12:00:00.000Z`, input.loggedDate, timestamp, timestamp]
  );
}

export async function updateBodyMeasurementLog(input: { id: number; loggedDate: string; weight: number | null; measurements: BodyMeasurementValues; notes?: string | null }) {
  assertCalendarDate(input.loggedDate);
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE body_measurement_logs SET weight = ?, measurements = ?, notes = ?, logged_at = ?, logged_date = ?, updated_at = ?, weight_input_unit = NULL, circumference_input_unit = NULL WHERE id = ?",
    [input.weight, JSON.stringify(input.measurements), input.notes?.trim() || null, `${input.loggedDate}T12:00:00.000Z`, input.loggedDate, new Date().toISOString(), input.id]
  );
}

export async function deleteBodyMeasurementLog(id: number) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ weight: number | null; measurements: string }>("SELECT weight, measurements FROM body_measurement_logs WHERE id = ?", [id]);
    if (!row) return;
    if (Number.isFinite(row.weight) && Number(row.weight) > 0) await tx.runAsync("UPDATE body_measurement_logs SET measurements = '{}', notes = NULL, circumference_input_unit = NULL, updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    else await tx.runAsync("DELETE FROM body_measurement_logs WHERE id = ?", [id]);
  });
}

export async function updateConfigWeight(id: number, weightFactor: number) {
  const db = await getDatabase();
  await db.runAsync("UPDATE muscle_strength_config SET weight_factor = ? WHERE id = ?", [weightFactor, id]);
}

export async function updateUnitSystem(unitSystem: UnitSystem) {
  const db = await getDatabase();
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["unit_system", unitSystem]);
}

export async function updateBodyUnitPreferences(preferences: BodyUnitPreferences) {
  const db = await getDatabase();
  const normalized = normalizeBodyUnitPreferences(preferences);
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["body_unit_preferences", JSON.stringify(normalized)]);
  return normalized;
}

export async function updateGuidedWorkoutPreferences(preferences: GuidedWorkoutPreferences) {
  const db = await getDatabase();
  const normalized = normalizeGuidedWorkoutPreferences(preferences);
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["guided_workout_preferences", JSON.stringify(normalized)]);
  return normalized;
}

export async function updateTrainingSplit(days: TrainingSplitDay[]): Promise<TrainingSplit> {
  const db = await getDatabase();
  const currentUser = await db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1");
  const trainingSplit = normalizeTrainingSplit({
    days,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.name ?? "You"
  });
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["training_split", JSON.stringify(trainingSplit)]);
  return trainingSplit;
}

async function seedRetiredWorkouts(db: Database) {
  const archives = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["completed_guided_workouts"]);
  if (!archives) return;
  let parsed: unknown;
  try { parsed = JSON.parse(archives.value); } catch { return; }
  if (!Array.isArray(parsed)) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const record of parsed) {
      if (record && typeof record.startedAt === "string" && record.startedAt.trim()) {
        await tx.runAsync("INSERT OR IGNORE INTO retired_active_workouts (workout_id) VALUES (?)", [record.startedAt]);
      }
    }
  });
}

async function preserveRecoveredDraft(db: Database, draft: ActiveWorkout) {
  // The stale operation rolled back. Recovery must commit independently of it.
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["recovered_workout_drafts"]);
    const existing: RecoveredWorkoutDraft[] = row ? JSON.parse(row.value) : [];
    if (!Array.isArray(existing)) throw new Error("Stored recovered drafts are invalid. Your active workout has been preserved.");
    if (existing.some((item) => sameStoredJson(item.draft, draft))) return;
    const recovered: RecoveredWorkoutDraft = { id: createRequestId(), savedAt: new Date().toISOString(), draft };
    await tx.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["recovered_workout_drafts", JSON.stringify([...existing, recovered])]);
  });
}

export async function saveActiveWorkout(activeWorkout: ActiveWorkout | null): Promise<ActiveWorkout> {
  if (!activeWorkout?.startedAt) throw new Error("Use atomic workout completion or discard to clear an active workout.");
  const db = await getDatabase();
  let saved = activeWorkout;
  try {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["active_workout"]);
      const current = row ? normalizeActiveWorkout(JSON.parse(row.value)) : null;
      if (row && !current) throw new Error("The stored workout draft is invalid. Its original has been preserved; resolve it before starting another workout.");
      const retired = await tx.getFirstAsync("SELECT workout_id FROM retired_active_workouts WHERE workout_id = ?", [activeWorkout.startedAt]);
      if (retired) throw new DraftConflictError(activeWorkout, current);
      saved = advanceWorkoutDraft(current, activeWorkout);
      const record = workoutRecordFromDraft(saved);
      const existing = await tx.getFirstAsync<{ value: string }>("SELECT value FROM workout_records WHERE id = ?", [record.id]);
      if (existing) {
        const previous = JSON.parse(existing.value) as WorkoutRecord;
        if (previous.kind !== "guided" || previous.startedAt !== record.startedAt || previous.status !== "active") throw new Error("This workout identity already belongs to another lifecycle.");
      }
      await tx.runAsync("INSERT INTO workout_records (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", [record.id, JSON.stringify(record)]);
      await tx.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["active_workout", JSON.stringify(saved)]);
    });
  } catch (error) {
    if (error instanceof DraftConflictError) await preserveRecoveredDraft(db, error.draft);
    throw error;
  }
  return saved;
}

export async function finalizeActiveWorkout(workoutId: string, workouts: CompletedGuidedWorkout[] | null, expectedActive?: ActiveWorkout | null) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const active = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["active_workout"]);
    const archives = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["completed_guided_workouts"]);
    const rawArchive: unknown = archives ? JSON.parse(archives.value) : [];
    if (!Array.isArray(rawArchive)) throw new Error("Stored workout summaries are invalid. Your data has been preserved.");
    const existing = normalizeCompletedGuidedWorkouts(rawArchive);
    if (!active) {
      if (workouts && !existing.some((workout) => workout.startedAt === workoutId)) throw new Error("The active workout was removed. Reload before finishing.");
      return;
    }
    const current = normalizeActiveWorkout(JSON.parse(active.value));
    if (!current || current.startedAt !== workoutId) throw new Error("Another workout is active. Reload before finishing this one.");
    if (!expectedActive || (!sameStoredJson(JSON.parse(active.value), expectedActive) && !sameStoredJson(current, expectedActive))) throw new Error("The workout draft changed. Reload and review it before finishing.");
    let finishedAt: string | null = null;
    if (workouts) {
      const summary = normalizeCompletedGuidedWorkouts(workouts).find((workout) => workout.startedAt === workoutId);
      if (!summary) throw new Error("The completed workout does not match the active draft.");
      const references = await tx.getAllAsync<{ session_id: number }>("SELECT session_id FROM workout_entry_references WHERE workout_id = ?", [current.workoutId!]);
      const links = new Set(references.map((reference) => reference.session_id));
      const referenceOnly = { ...current, id: current.startedAt, finishedAt: summary.finishedAt, currentExercise: emptyActiveExercise(),
        completedExercises: current.completedExercises.filter((entry) => links.has(entry.sessionId!)).map((entry) => ({ ...entry, sets: [] })) };
      const merged = [referenceOnly, ...rawArchive];
      await tx.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["completed_guided_workouts", JSON.stringify(merged)]);
      finishedAt = summary.finishedAt;
    }
    const record = workoutRecordFromDraft(current);
    await tx.runAsync("INSERT INTO workout_records (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", [record.id, JSON.stringify({ ...record, status: "completed", finishedAt })]);
    await tx.runAsync("INSERT OR IGNORE INTO retired_active_workouts (workout_id) VALUES (?)", [workoutId]);
    await tx.runAsync("DELETE FROM app_settings WHERE key = ?", ["active_workout"]);
  });
}

export async function saveCompletedGuidedWorkouts(_workouts: CompletedGuidedWorkout[]) {
  throw new Error("Completed workout summaries must be saved through atomic workout completion.");
}

export async function saveMachineProfiles(profiles: MachineProfile[]) {
  const db = await getDatabase();
  const normalized = normalizeMachineProfiles(profiles);
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["machine_profiles", JSON.stringify(normalized)]);
  return normalized;
}

export async function loadSocialData(): Promise<SocialData> {
  return {
    friends: [],
    invites: [],
    leaderboard: [],
    notice: "Friend leaderboards need the Supabase-powered web app so scores can sync between accounts."
  };
}

export async function createFriendInvite(): Promise<string> {
  throw new Error("Friend invites need the Supabase-powered web app.");
}

export async function acceptFriendInvite(_token: string): Promise<void> {
  throw new Error("Friend invites need the Supabase-powered web app.");
}

export async function revokeFriendInvite(_inviteId: string): Promise<void> {
  throw new Error("Friend invites need the Supabase-powered web app.");
}

export async function removeFriend(_friendId: string): Promise<void> {
  throw new Error("Friend management needs the Supabase-powered web app.");
}

export async function requestSplitSync(_friendId: string, _days: TrainingSplitDay[]): Promise<void> {
  throw new Error("Split synchronization needs the Supabase-powered web app.");
}

export async function respondSplitSync(_requestId: string, _accepted: boolean): Promise<void> {
  throw new Error("Split synchronization needs the Supabase-powered web app.");
}

export async function removeSplitSync(_friendId: string): Promise<void> {
  throw new Error("Split synchronization needs the Supabase-powered web app.");
}

export async function syncScoreSnapshots(_points: ExerciseScorePoint[]): Promise<void> {
  return;
}

async function setCurrentUser(db: Database, userId: number) {
  await db.runAsync("DELETE FROM auth_session");
  await db.runAsync("INSERT INTO auth_session (id, user_id, created_at) VALUES (1, ?, ?)", [userId, new Date().toISOString()]);
}

async function getImportedWorkoutFingerprints(db: Database) {
  const setting = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["imported_workout_fingerprints"]);
  if (!setting?.value) return new Set<string>();
  try {
    const parsed = JSON.parse(setting.value);
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

async function setImportedWorkoutFingerprints(db: Database, fingerprints: Set<string>) {
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["imported_workout_fingerprints", JSON.stringify([...fingerprints])]);
}

async function getExistingWorkoutFingerprints(db: Database) {
  const [exercises, sessions, sets] = await Promise.all([
    db.getAllAsync<Exercise>("SELECT * FROM exercises"),
    db.getAllAsync<WorkoutSession>("SELECT * FROM workout_sessions"),
    db.getAllAsync<WorkoutSet>("SELECT * FROM workout_sets ORDER BY set_number ASC")
  ]);
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const setsBySession = sets.reduce<Map<number, WorkoutSet[]>>((groups, set) => {
    groups.set(set.session_id, [...(groups.get(set.session_id) ?? []), set]);
    return groups;
  }, new Map());

  return new Set(
    [...setsBySession.entries()].flatMap(([sessionId, sessionSets]) => {
      const session = sessionById.get(sessionId);
      const exercise = exerciseById.get(sessionSets[0]?.exercise_id);
      if (!session || !exercise || !sessionSets.length) return [];
      return [
        buildWorkoutFingerprint({
          workoutDate: session.workout_date,
          exerciseName: exercise.name,
          notes: session.notes ?? "",
          sets: sessionSets.map((set) => ({ reps: set.reps, weight: set.weight, rir: set.rir ?? undefined, isWarmup: Boolean(set.is_warmup) }))
        })
      ];
    })
  );
}
