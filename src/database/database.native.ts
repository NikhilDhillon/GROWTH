import * as SQLite from "expo-sqlite";

import { schema } from "@/database/schema";
import { Exercise, MuscleGroup, MuscleStrengthConfig, User, WorkoutSession, WorkoutSet } from "@/types";
import { hashPassword, normalizeEmail } from "@/utils/password";

type Database = SQLite.SQLiteDatabase;

let database: Database | null = null;

async function getDatabase() {
  if (!database) {
    database = await SQLite.openDatabaseAsync("growth.db");
    await database.execAsync(schema);
    await removeLegacySeedData(database);
  }
  return database;
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

export async function loadAllData() {
  const db = await getDatabase();
  const [exercises, sessions, sets, configs, currentUser] = await Promise.all([
    db.getAllAsync<Exercise>("SELECT * FROM exercises ORDER BY name"),
    db.getAllAsync<WorkoutSession>("SELECT * FROM workout_sessions ORDER BY workout_date DESC"),
    db.getAllAsync<WorkoutSet>("SELECT * FROM workout_sets ORDER BY created_at ASC, set_number ASC"),
    db.getAllAsync<MuscleStrengthConfig>("SELECT * FROM muscle_strength_config ORDER BY muscle_group"),
    db.getFirstAsync<User>("SELECT users.* FROM users INNER JOIN auth_session ON auth_session.user_id = users.id WHERE auth_session.id = 1")
  ]);

  return { exercises, sessions, sets, configs, currentUser: currentUser ?? null };
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

  await setCurrentUser(db, user.id);
  return user;
}

export async function logoutUser() {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM auth_session");
}

export async function createExercise(input: { name: string; primaryMuscle: MuscleGroup; secondaryMuscle?: MuscleGroup | null; strength: boolean }) {
  const db = await getDatabase();
  const result = await db.runAsync(
    "INSERT INTO exercises (name, primary_muscle, secondary_muscle, is_strength_exercise, created_at) VALUES (?, ?, ?, ?, ?)",
    [input.name.trim(), input.primaryMuscle, input.secondaryMuscle ?? null, input.strength ? 1 : 0, new Date().toISOString()]
  );
  return result;
}

export async function logWorkout(input: { exerciseId: number; workoutDate: string; notes: string; sets: { reps: number; weight: number }[] }) {
  const db = await getDatabase();
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  const session = await db.runAsync("INSERT INTO workout_sessions (workout_date, notes, created_at) VALUES (?, ?, ?)", [input.workoutDate, input.notes, timestamp]);

  for (const [index, set] of input.sets.entries()) {
    await db.runAsync(
      "INSERT INTO workout_sets (session_id, exercise_id, set_number, reps, weight, rir, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [session.lastInsertRowId, input.exerciseId, index + 1, set.reps, set.weight, null, timestamp]
    );
  }
}

export async function deleteWorkoutSession(sessionId: number) {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM workout_sets WHERE session_id = ?", [sessionId]);
  await db.runAsync("DELETE FROM workout_sessions WHERE id = ?", [sessionId]);
}

export async function updateConfigWeight(id: number, weightFactor: number) {
  const db = await getDatabase();
  await db.runAsync("UPDATE muscle_strength_config SET weight_factor = ? WHERE id = ?", [weightFactor, id]);
}

async function setCurrentUser(db: Database, userId: number) {
  await db.runAsync("DELETE FROM auth_session");
  await db.runAsync("INSERT INTO auth_session (id, user_id, created_at) VALUES (1, ?, ?)", [userId, new Date().toISOString()]);
}
