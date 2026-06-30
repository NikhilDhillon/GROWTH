import * as SQLite from "expo-sqlite";

import { normalizeActiveWorkout, normalizeCompletedGuidedWorkouts } from "@/constants/activeWorkout";
import { catalogExercises } from "@/constants/exercises";
import { normalizeGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { normalizeMachineProfiles } from "@/constants/machineProfiles";
import { createDefaultTrainingSplit, normalizeTrainingSplit } from "@/constants/trainingSplit";
import { schema } from "@/database/schema";
import { buildWorkoutFingerprint, ImportBodyWeightLog, ImportWorkoutLog } from "@/services/import/importService";
import { ActiveWorkout, BodyWeightLog, CompletedGuidedWorkout, Exercise, ExerciseScorePoint, GuidedWorkoutPreferences, MachineProfile, MuscleStrengthConfig, SocialData, TrainingSplit, TrainingSplitDay, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
import { hashPassword, normalizeEmail } from "@/utils/password";

type Database = SQLite.SQLiteDatabase;

let database: Database | null = null;

async function getDatabase() {
  if (!database) {
    database = await SQLite.openDatabaseAsync("growth.db");
    await database.execAsync(schema);
    await ensureBodyWeightLogSchema(database);
    await ensureWorkoutSessionSchema(database);
    await ensureWorkoutSetSchema(database);
    await removeLegacySeedData(database);
    await ensureExerciseCatalog(database);
    await ensureCatalogAdditions(database);
  }
  return database;
}

async function ensureWorkoutSessionSchema(db: Database) {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(workout_sessions)");
  if (!columns.some((column) => column.name === "machine_profile_id")) {
    await db.runAsync("ALTER TABLE workout_sessions ADD COLUMN machine_profile_id TEXT");
  }
}

async function ensureWorkoutSetSchema(db: Database) {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(workout_sets)");
  if (!columns.some((column) => column.name === "is_warmup")) {
    await db.runAsync("ALTER TABLE workout_sets ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0");
  }
}

async function ensureBodyWeightLogSchema(db: Database) {
  const renamed = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["bodyweight_logs"]);
  if (renamed) {
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
    await db.runAsync("ALTER TABLE body_weight_logs ADD COLUMN unit TEXT NOT NULL DEFAULT 'lb'");
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

async function removeLegacySeedData(db: Database) {
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((version?.user_version ?? 0) >= 1) return;

  const legacyNames = [
    "Bench Press",
    "Incline Dumbbell Press",
    "Barbell Row",
    "Lat Pulldown",
    "Overhead Press",
    "Barbell Curl",
    "Cable Pushdown",
    "Back Squat",
    "Romanian Deadlift",
    "Weighted Plank"
  ];
  const placeholders = legacyNames.map(() => "?").join(", ");

  await db.runAsync("DELETE FROM workout_sets WHERE session_id IN (SELECT id FROM workout_sessions WHERE notes = ?)", ["Seed workout"]);
  await db.runAsync("DELETE FROM workout_sessions WHERE notes = ?", ["Seed workout"]);
  await db.runAsync(`DELETE FROM muscle_strength_config WHERE exercise_id IN (SELECT id FROM exercises WHERE name IN (${placeholders}))`, legacyNames);
  await db.runAsync(`DELETE FROM exercises WHERE name IN (${placeholders})`, legacyNames);
  await db.execAsync("PRAGMA user_version = 1");
}

async function ensureExerciseCatalog(db: Database) {
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((version?.user_version ?? 0) >= 2) return;

  await db.runAsync("DELETE FROM workout_sets");
  await db.runAsync("DELETE FROM workout_sessions");
  await db.runAsync("DELETE FROM muscle_strength_config");
  await db.runAsync("DELETE FROM user_exercise_preferences");
  await db.runAsync("DELETE FROM exercises");

  const timestamp = new Date().toISOString();
  for (const exercise of catalogExercises) {
    await db.runAsync(
      "INSERT INTO exercises (name, primary_muscle, secondary_muscle, is_strength_exercise, created_at) VALUES (?, ?, ?, 0, ?)",
      [exercise.name, exercise.primary_muscle, exercise.secondary_muscle ?? null, timestamp]
    );
  }

  await db.execAsync("PRAGMA user_version = 2");
}

async function ensureCatalogAdditions(db: Database) {
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((version?.user_version ?? 0) >= 7) return;

  const timestamp = new Date().toISOString();
  await db.runAsync("UPDATE exercises SET name = ? WHERE name = ?", ["Cable Triceps Pushdown", "Cable Pushdown"]);
  for (const exercise of catalogExercises) {
    const existing = await db.getFirstAsync<{ id: number }>("SELECT id FROM exercises WHERE name = ?", [exercise.name]);
    if (existing) {
      await db.runAsync("UPDATE exercises SET primary_muscle = ?, secondary_muscle = ? WHERE id = ?", [exercise.primary_muscle, exercise.secondary_muscle ?? null, existing.id]);
    } else {
      await db.runAsync(
        "INSERT INTO exercises (name, primary_muscle, secondary_muscle, is_strength_exercise, created_at) VALUES (?, ?, ?, 0, ?)",
        [exercise.name, exercise.primary_muscle, exercise.secondary_muscle ?? null, timestamp]
      );
    }
  }

  await db.execAsync("PRAGMA user_version = 7");
}

export async function loadAllData() {
  const db = await getDatabase();
  const [currentUser, unitSetting, trainingSplitSetting, activeWorkoutSetting, guidedWorkoutSetting, completedWorkoutsSetting, machineProfilesSetting] = await Promise.all([
    db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1"),
    db.getFirstAsync<{ value: UnitSystem }>("SELECT value FROM app_settings WHERE key = ?", ["unit_system"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["training_split"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["active_workout"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["guided_workout_preferences"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["completed_guided_workouts"]),
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", ["machine_profiles"])
  ]);
  const [exercises, sessions, sets, bodyWeightLogs, configs] = await Promise.all([
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
    db.getAllAsync<BodyWeightLog>("SELECT id, weight, unit, logged_at, created_at, COALESCE(logged_date, substr(logged_at, 1, 10)) as logged_date FROM body_weight_logs ORDER BY logged_at DESC, created_at DESC"),
    db.getAllAsync<MuscleStrengthConfig>("SELECT * FROM muscle_strength_config ORDER BY muscle_group")
  ]);

  const unitSystem: UnitSystem = unitSetting?.value === "kg" ? "kg" : "lb";
  const trainingSplit = trainingSplitSetting?.value ? normalizeTrainingSplit(JSON.parse(trainingSplitSetting.value)) : createDefaultTrainingSplit();
  const activeWorkout = normalizeActiveWorkout(activeWorkoutSetting?.value ? JSON.parse(activeWorkoutSetting.value) : null);
  const guidedWorkoutPreferences = normalizeGuidedWorkoutPreferences(guidedWorkoutSetting?.value ? JSON.parse(guidedWorkoutSetting.value) : null);
  const completedGuidedWorkouts = normalizeCompletedGuidedWorkouts(completedWorkoutsSetting?.value ? JSON.parse(completedWorkoutsSetting.value) : null);
  const machineProfiles = normalizeMachineProfiles(machineProfilesSetting?.value ? JSON.parse(machineProfilesSetting.value) : null);
  return { exercises, sessions, sets, bodyWeightLogs, configs, currentUser: currentUser ?? null, unitSystem, trainingSplit, activeWorkout, guidedWorkoutPreferences, completedGuidedWorkouts, machineProfiles };
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

export async function logWorkout(input: { exerciseId: number; workoutDate: string; notes: string; machineProfileId?: string | null; sets: { reps: number; weight: number; isWarmup?: boolean }[] }) {
  const db = await getDatabase();
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  const session = await db.runAsync("INSERT INTO workout_sessions (workout_date, notes, machine_profile_id, created_at) VALUES (?, ?, ?, ?)", [input.workoutDate, input.notes, input.machineProfileId ?? null, timestamp]);

  for (const [index, set] of input.sets.entries()) {
    await db.runAsync(
      "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, is_warmup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [session.lastInsertRowId, input.exerciseId, index + 1, set.reps, set.weight, 0, set.isWarmup ? 1 : 0, timestamp]
    );
  }
}

export async function importTrainingData(input: { bodyWeightLogs: ImportBodyWeightLog[]; workouts: ImportWorkoutLog[]; exerciseIdsToEnable: number[] }) {
  const db = await getDatabase();
  const currentUser = await db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1");
  if (!currentUser) throw new Error("Please log in again.");

  const timestamp = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const log of input.bodyWeightLogs) {
      await db.runAsync("DELETE FROM body_weight_logs WHERE COALESCE(logged_date, substr(logged_at, 1, 10)) = ?", [log.loggedDate]);
      await db.runAsync(
        "INSERT INTO body_weight_logs (weight, unit, logged_at, logged_date, created_at) VALUES (?, ?, ?, ?, ?)",
        [log.weight, log.unit, `${log.loggedDate}T12:00:00.000Z`, log.loggedDate, timestamp]
      );
    }

    for (const exerciseId of input.exerciseIdsToEnable) {
      await db.runAsync(
        `
        INSERT INTO user_exercise_preferences (user_id, exercise_id, enabled, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, exercise_id)
        DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
        `,
        [currentUser.id, exerciseId, timestamp, timestamp]
      );
    }

    const importedFingerprints = await getImportedWorkoutFingerprints(db);
    const existingFingerprints = await getExistingWorkoutFingerprints(db);

    for (const workout of input.workouts) {
      if (importedFingerprints.has(workout.fingerprint) || existingFingerprints.has(workout.fingerprint)) continue;

      const createdAt = `${workout.workoutDate}T12:00:00.000Z`;
      const session = await db.runAsync("INSERT INTO workout_sessions (workout_date, notes, created_at) VALUES (?, ?, ?)", [workout.workoutDate, workout.notes, createdAt]);
      for (const [index, set] of workout.sets.entries()) {
        await db.runAsync(
          "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [session.lastInsertRowId, workout.exerciseId, index + 1, set.reps, set.weight, 0, createdAt]
        );
      }

      importedFingerprints.add(workout.fingerprint);
      existingFingerprints.add(workout.fingerprint);
    }

    if (input.workouts.length) {
      await setImportedWorkoutFingerprints(db, importedFingerprints);
    }
  });
}

export async function deleteWorkoutSession(sessionId: number) {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM workout_sets WHERE session_id = ?", [sessionId]);
  await db.runAsync("DELETE FROM workout_sessions WHERE id = ?", [sessionId]);
}

export async function updateWorkoutSession(input: { sessionId: number; exerciseId: number; workoutDate: string; notes: string; machineProfileId?: string | null; sets: { reps: number; weight: number; isWarmup?: boolean }[] }) {
  const db = await getDatabase();
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE workout_sessions SET workout_date = ?, notes = ?, machine_profile_id = ?, created_at = ? WHERE id = ?", [input.workoutDate, input.notes, input.machineProfileId ?? null, timestamp, input.sessionId]);
    await db.runAsync("DELETE FROM workout_sets WHERE session_id = ?", [input.sessionId]);

    for (const [index, set] of input.sets.entries()) {
      await db.runAsync(
        "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, is_warmup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [input.sessionId, input.exerciseId, index + 1, set.reps, set.weight, 0, set.isWarmup ? 1 : 0, timestamp]
      );
    }
  });
}

export async function updateWorkoutSessionMachineProfile(input: { sessionId: number; machineProfileId?: string | null }) {
  const db = await getDatabase();
  await db.runAsync("UPDATE workout_sessions SET machine_profile_id = ? WHERE id = ?", [input.machineProfileId ?? null, input.sessionId]);
}

export async function saveBodyWeightLog(input: { loggedDate: string; weight: number; unit: UnitSystem }) {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO body_weight_logs (weight, unit, logged_at, logged_date, created_at) VALUES (?, ?, ?, ?, ?)",
    [input.weight, input.unit, `${input.loggedDate}T12:00:00.000Z`, input.loggedDate, new Date().toISOString()]
  );
}

export async function updateBodyWeightLog(input: { id: number; loggedDate: string; weight: number; unit: UnitSystem }) {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE body_weight_logs SET weight = ?, unit = ?, logged_at = ?, logged_date = ? WHERE id = ?",
    [input.weight, input.unit, `${input.loggedDate}T12:00:00.000Z`, input.loggedDate, input.id]
  );
}

export async function deleteBodyWeightLog(id: number) {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM body_weight_logs WHERE id = ?", [id]);
}

export async function updateConfigWeight(id: number, weightFactor: number) {
  const db = await getDatabase();
  await db.runAsync("UPDATE muscle_strength_config SET weight_factor = ? WHERE id = ?", [weightFactor, id]);
}

export async function updateUnitSystem(unitSystem: UnitSystem) {
  const db = await getDatabase();
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["unit_system", unitSystem]);
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

export async function saveActiveWorkout(activeWorkout: ActiveWorkout | null) {
  const db = await getDatabase();
  if (!activeWorkout) {
    await db.runAsync("DELETE FROM app_settings WHERE key = ?", ["active_workout"]);
    return;
  }
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["active_workout", JSON.stringify(activeWorkout)]);
}

export async function saveCompletedGuidedWorkouts(workouts: CompletedGuidedWorkout[]) {
  const db = await getDatabase();
  const normalized = normalizeCompletedGuidedWorkouts(workouts);
  await db.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["completed_guided_workouts", JSON.stringify(normalized)]);
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
          sets: sessionSets.map((set) => ({ reps: set.reps, weight: set.weight }))
        })
      ];
    })
  );
}
