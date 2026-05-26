import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { normalizeActiveWorkout } from "@/constants/activeWorkout";
import { catalogExerciseRows } from "@/constants/exercises";
import { createDefaultTrainingSplit, normalizeTrainingSplit } from "@/constants/trainingSplit";
import { buildWorkoutFingerprint, ImportBodyWeightLog, ImportWorkoutLog } from "@/services/import/importService";
import { ActiveWorkout, BodyWeightLog, Exercise, ExerciseScorePoint, Friend, FriendInvite, LeaderboardEntry, MuscleStrengthConfig, SocialData, TrainingSplit, TrainingSplitDay, UnitSystem, User, UserExercisePreference, WorkoutSession, WorkoutSet } from "@/types";
import { hashPassword, normalizeEmail } from "@/utils/password";

const storageKey = "growth.preview.database.v2";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

type WebDatabase = {
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  bodyWeightLogs: BodyWeightLog[];
  configs: MuscleStrengthConfig[];
  exercisePreferences: UserExercisePreference[];
  users: User[];
  currentUserId: number | null;
  unitSystem: UnitSystem;
  importFingerprints: string[];
  trainingSplit: TrainingSplit;
  activeWorkout: ActiveWorkout | null;
};

type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
};

type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: Friend["status"];
  created_at: string;
  updated_at: string;
};

type FriendInviteRow = {
  id: string;
  owner_id: string;
  token: string;
  expires_at: string;
  accepted_by: string | null;
  created_at: string;
};

type SplitSyncRequestRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  updated_at: string;
};

type ScoreSnapshotRow = {
  user_id: string;
  exercise_id: number;
  exercise_name: string;
  best_score: number;
  achieved_at: string;
  updated_at: string;
};

type SharedTrainingSplitRow = {
  split_days: TrainingSplitDay[];
  updated_by_name: string | null;
  updated_at: string;
};

function now() {
  return new Date().toISOString();
}

function seedDatabase(): WebDatabase {
  return { exercises: catalogExerciseRows(now()), sessions: [], sets: [], bodyWeightLogs: [], configs: [], exercisePreferences: [], users: [], currentUserId: null, unitSystem: "lb", importFingerprints: [], trainingSplit: createDefaultTrainingSplit(), activeWorkout: null };
}

function readDatabase(): WebDatabase {
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    const parsed = JSON.parse(existing) as Partial<WebDatabase>;
    const unitSystem: UnitSystem = parsed.unitSystem === "kg" ? "kg" : "lb";
    const exercises = normalizeCatalog(parsed.exercises ?? []);
    return {
      exercises,
      sessions: exercisesAreCatalog(parsed.exercises ?? []) ? parsed.sessions ?? [] : [],
      sets: exercisesAreCatalog(parsed.exercises ?? []) ? parsed.sets ?? [] : [],
      bodyWeightLogs: parsed.bodyWeightLogs ?? [],
      configs: exercisesAreCatalog(parsed.exercises ?? []) ? parsed.configs ?? [] : [],
      exercisePreferences: parsed.exercisePreferences ?? [],
      users: parsed.users ?? [],
      currentUserId: parsed.currentUserId ?? null,
      unitSystem,
      importFingerprints: Array.isArray(parsed.importFingerprints) ? parsed.importFingerprints.filter((value): value is string => typeof value === "string") : [],
      trainingSplit: normalizeTrainingSplit(parsed.trainingSplit),
      activeWorkout: normalizeActiveWorkout(parsed.activeWorkout)
    };
  }
  const seeded = seedDatabase();
  writeDatabase(seeded);
  return seeded;
}

function writeDatabase(data: WebDatabase) {
  window.localStorage.setItem(storageKey, JSON.stringify(data));
}

export async function loadAllData() {
  if (supabase) return loadCloudData(supabase);

  const data = readDatabase();
  const currentUser = data.users.find((user) => user.id === data.currentUserId) ?? null;
  return {
    exercises: withPreferenceFlags(data.exercises, data.exercisePreferences, data.currentUserId).sort((a, b) => a.name.localeCompare(b.name)),
    sessions: [...data.sessions].sort((a, b) => b.workout_date.localeCompare(a.workout_date)),
    sets: [...data.sets].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.set_number - b.set_number),
    bodyWeightLogs: normalizeBodyWeightLogs(data.bodyWeightLogs).sort((a, b) => b.logged_at.localeCompare(a.logged_at) || b.created_at.localeCompare(a.created_at)),
    configs: [...data.configs].sort((a, b) => a.muscle_group.localeCompare(b.muscle_group)),
    currentUser,
    unitSystem: data.unitSystem,
    trainingSplit: data.trainingSplit,
    activeWorkout: data.activeWorkout
  };
}

async function loadCloudData(client: SupabaseClient) {
  const user = await requireCloudUser(client, false);
  if (!user) {
    return { exercises: [], sessions: [], sets: [], bodyWeightLogs: [], configs: [], currentUser: null, unitSystem: "lb" as UnitSystem, trainingSplit: createDefaultTrainingSplit(), activeWorkout: null };
  }

  const [profileResult, exercisesResult, preferencesResult, sessionsResult, setsResult, bodyWeightResult, configsResult, settingResult, activeWorkoutResult] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).maybeSingle<ProfileRow>(),
    client.from("exercises").select("*").order("name"),
    client.from("user_exercise_preferences").select("*").eq("user_id", user.id),
    client.from("workout_sessions").select("*").order("workout_date", { ascending: false }),
    client.from("workout_sets").select("*").order("created_at").order("set_number"),
    client.from("body_weight_logs").select("*").order("logged_date", { ascending: false }).order("created_at", { ascending: false }),
    client.from("muscle_strength_config").select("*").order("muscle_group"),
    client.from("app_settings").select("value").eq("key", "unit_system").maybeSingle<{ value: UnitSystem }>(),
    client.from("app_settings").select("value").eq("key", "active_workout").maybeSingle<{ value: string }>()
  ]);

  throwIfSupabaseError(profileResult.error);
  throwIfSupabaseError(exercisesResult.error);
  throwIfSupabaseError(preferencesResult.error);
  throwIfSupabaseError(sessionsResult.error);
  throwIfSupabaseError(setsResult.error);
  if (bodyWeightResult.error && !isMissingBodyWeightTableError(bodyWeightResult.error)) {
    throwIfSupabaseError(bodyWeightResult.error);
  }
  throwIfSupabaseError(configsResult.error);
  throwIfSupabaseError(settingResult.error);
  throwIfSupabaseError(activeWorkoutResult.error);

  const preferences = (preferencesResult.data ?? []) as UserExercisePreference[];
  const trainingSplit = await loadCloudTrainingSplit(client, user.id);
  return {
    exercises: withPreferenceFlags((exercisesResult.data ?? []) as Exercise[], preferences, user.id),
    sessions: (sessionsResult.data ?? []) as WorkoutSession[],
    sets: (setsResult.data ?? []) as WorkoutSet[],
    bodyWeightLogs: normalizeBodyWeightLogs(bodyWeightResult.error ? [] : (bodyWeightResult.data ?? []) as BodyWeightLog[]),
    configs: (configsResult.data ?? []) as MuscleStrengthConfig[],
    currentUser: cloudUserToAppUser(user, profileResult.data),
    unitSystem: settingResult.data?.value === "kg" ? "kg" : "lb",
    trainingSplit,
    activeWorkout: normalizeActiveWorkout(activeWorkoutResult.data?.value ? JSON.parse(activeWorkoutResult.data.value) : null)
  };
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  if (supabase) {
    const email = normalizeEmail(input.email);
    const result = await supabase.auth.signUp({
      email,
      password: input.password,
      options: { data: { name: input.name.trim() } }
    });
    throwIfSupabaseError(result.error);
    if (!result.data.session || !result.data.user) {
      throw new Error("Check your email to confirm your account, then log in.");
    }
    await upsertProfile(supabase, result.data.user.id, input.name.trim(), email);
    return cloudUserToAppUser(result.data.user, { id: result.data.user.id, name: input.name.trim(), email, created_at: result.data.user.created_at });
  }

  const data = readDatabase();
  const email = normalizeEmail(input.email);
  const existing = data.users.find((user) => user.email === email);
  if (existing) throw new Error("An account already exists for this email.");

  const user = {
    id: Math.max(0, ...data.users.map((item) => Number(item.id))) + 1,
    name: input.name.trim(),
    email,
    password_hash: hashPassword(input.password, email),
    created_at: now()
  };

  data.users.push(user);
  data.currentUserId = user.id;
  writeDatabase(data);
  return user;
}

export async function loginUser(input: { email: string; password: string }) {
  if (supabase) {
    const email = normalizeEmail(input.email);
    const result = await supabase.auth.signInWithPassword({ email, password: input.password });
    throwIfSupabaseError(result.error);
    if (!result.data.user) throw new Error("Could not log in.");
    await upsertProfile(supabase, result.data.user.id, result.data.user.user_metadata?.name ?? email, email);
    const profile = await supabase.from("profiles").select("*").eq("id", result.data.user.id).maybeSingle<ProfileRow>();
    throwIfSupabaseError(profile.error);
    return cloudUserToAppUser(result.data.user, profile.data);
  }

  const data = readDatabase();
  const email = normalizeEmail(input.email);
  const user = data.users.find((item) => item.email === email);
  if (!user || user.password_hash !== hashPassword(input.password, email)) {
    throw new Error("Email or password is incorrect.");
  }

  data.currentUserId = Number(user.id);
  writeDatabase(data);
  return user;
}

export async function requestPasswordReset(input: { email: string }) {
  if (!supabase) throw new Error("Password reset requires Supabase to be configured.");

  const email = normalizeEmail(input.email);
  const profileResult = await supabase.rpc("profile_exists_for_email", { lookup_email: email });
  if (profileResult.error?.message.includes("profile_exists_for_email")) {
    throw new Error("Email does not exist. Register instead.");
  }
  throwIfSupabaseError(profileResult.error);
  if (!profileResult.data) throw new Error("Email does not exist. Register instead.");

  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
  const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  throwIfSupabaseError(result.error);
}

export async function updateCurrentUserPassword(input: { password: string }) {
  if (!supabase) throw new Error("Password reset requires Supabase to be configured.");

  const result = await supabase.auth.updateUser({ password: input.password });
  throwIfSupabaseError(result.error);
}

export async function logoutUser() {
  if (supabase) {
    const result = await supabase.auth.signOut();
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  data.currentUserId = null;
  writeDatabase(data);
}

export async function setExerciseEnabled(exerciseId: number, enabled: boolean) {
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase.from("user_exercise_preferences").upsert(
      {
        user_id: user.id,
        exercise_id: exerciseId,
        enabled: enabled ? 1 : 0,
        updated_at: now()
      },
      { onConflict: "user_id,exercise_id" }
    );
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  if (!data.currentUserId) throw new Error("Please log in again.");
  const existing = data.exercisePreferences.find((preference) => preference.user_id === data.currentUserId && preference.exercise_id === exerciseId);
  if (existing) {
    existing.enabled = enabled ? 1 : 0;
    existing.updated_at = now();
  } else {
    data.exercisePreferences.push({
      user_id: data.currentUserId,
      exercise_id: exerciseId,
      enabled: enabled ? 1 : 0,
      created_at: now(),
      updated_at: now()
    });
  }
  writeDatabase(data);
}

export async function logWorkout(input: { exerciseId: number; workoutDate: string; notes: string; sets: { reps: number; weight: number }[] }) {
  if (supabase) {
    await requireCloudUser(supabase);
    const timestamp = `${input.workoutDate}T12:00:00.000Z`;
    const sessionResult = await supabase
      .from("workout_sessions")
      .insert({ workout_date: input.workoutDate, notes: input.notes, created_at: timestamp })
      .select("id")
      .single<{ id: number }>();
    throwIfSupabaseError(sessionResult.error);
    if (!sessionResult.data) throw new Error("Could not save workout session.");

    const setRows = input.sets.map((set, index) => ({
      session_id: sessionResult.data.id,
      exercise_id: input.exerciseId,
      set_number: index + 1,
      reps: set.reps,
      weight: set.weight,
      rir: 0,
      created_at: timestamp
    }));
    const setsResult = await supabase.from("workout_sets").insert(setRows);
    throwIfSupabaseError(setsResult.error);
    return;
  }

  const data = readDatabase();
  const sessionId = Math.max(0, ...data.sessions.map((session) => session.id)) + 1;
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  data.sessions.push({
    id: sessionId,
    workout_date: input.workoutDate,
    notes: input.notes,
    created_at: timestamp
  });

  for (const [index, set] of input.sets.entries()) {
    data.sets.push({
      id: Math.max(0, ...data.sets.map((item) => item.id)) + 1,
      session_id: sessionId,
      exercise_id: input.exerciseId,
      set_number: index + 1,
      reps: set.reps,
      weight: set.weight,
      rir: 0,
      created_at: timestamp
    });
  }

  writeDatabase(data);
}

export async function importTrainingData(input: { bodyWeightLogs: ImportBodyWeightLog[]; workouts: ImportWorkoutLog[]; exerciseIdsToEnable: number[] }) {
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const timestamp = now();

    if (input.bodyWeightLogs.length) {
      const bodyWeightResult = await supabase.from("body_weight_logs").upsert(
        input.bodyWeightLogs.map((log) => ({
          user_id: user.id,
          logged_date: log.loggedDate,
          weight: log.weight,
          created_at: `${log.loggedDate}T12:00:00.000Z`
        })),
        { onConflict: "user_id,logged_date" }
      );
      if (bodyWeightResult.error && isMissingBodyWeightTableError(bodyWeightResult.error)) {
        throw new Error("Body weight logging needs the Supabase schema update for body_weight_logs.");
      }
      throwIfSupabaseError(bodyWeightResult.error);
    }

    if (input.exerciseIdsToEnable.length) {
      const preferenceResult = await supabase.from("user_exercise_preferences").upsert(
        input.exerciseIdsToEnable.map((exerciseId) => ({
          user_id: user.id,
          exercise_id: exerciseId,
          enabled: 1,
          updated_at: timestamp
        })),
        { onConflict: "user_id,exercise_id" }
      );
      throwIfSupabaseError(preferenceResult.error);
    }

    const [importedFingerprints, existingFingerprints] = await Promise.all([
      getCloudImportedWorkoutFingerprints(supabase),
      getCloudExistingWorkoutFingerprints(supabase)
    ]);

    for (const workout of input.workouts) {
      if (importedFingerprints.has(workout.fingerprint) || existingFingerprints.has(workout.fingerprint)) continue;

      const createdAt = `${workout.workoutDate}T12:00:00.000Z`;
      const sessionResult = await supabase
        .from("workout_sessions")
        .insert({ user_id: user.id, workout_date: workout.workoutDate, notes: workout.notes, created_at: createdAt })
        .select("id")
        .single<{ id: number }>();
      throwIfSupabaseError(sessionResult.error);
      if (!sessionResult.data) throw new Error("Could not import workout session.");

      const setsResult = await supabase.from("workout_sets").insert(
        workout.sets.map((set, index) => ({
          user_id: user.id,
          session_id: sessionResult.data.id,
          exercise_id: workout.exerciseId,
          set_number: index + 1,
          reps: set.reps,
          weight: set.weight,
          rir: 0,
          created_at: createdAt
        }))
      );
      throwIfSupabaseError(setsResult.error);
      importedFingerprints.add(workout.fingerprint);
      existingFingerprints.add(workout.fingerprint);
    }

    if (input.workouts.length) {
      await setCloudImportedWorkoutFingerprints(supabase, importedFingerprints);
    }
    return;
  }

  const data = readDatabase();
  if (!data.currentUserId) throw new Error("Please log in again.");

  const timestamp = now();
  const bodyWeightByDate = new Map(normalizeBodyWeightLogs(data.bodyWeightLogs).map((log) => [log.logged_date ?? log.logged_at.slice(0, 10), log]));
  for (const log of input.bodyWeightLogs) {
    bodyWeightByDate.set(log.loggedDate, {
      id: bodyWeightByDate.get(log.loggedDate)?.id ?? Math.max(0, ...[...bodyWeightByDate.values()].map((item) => item.id)) + 1,
      weight: log.weight,
      unit: log.unit,
      logged_at: `${log.loggedDate}T12:00:00.000Z`,
      logged_date: log.loggedDate,
      created_at: timestamp
    });
  }
  data.bodyWeightLogs = [...bodyWeightByDate.values()];

  for (const exerciseId of input.exerciseIdsToEnable) {
    const existing = data.exercisePreferences.find((preference) => preference.user_id === data.currentUserId && preference.exercise_id === exerciseId);
    if (existing) {
      existing.enabled = 1;
      existing.updated_at = timestamp;
    } else {
      data.exercisePreferences.push({
        user_id: data.currentUserId,
        exercise_id: exerciseId,
        enabled: 1,
        created_at: timestamp,
        updated_at: timestamp
      });
    }
  }

  const importedFingerprints = new Set(data.importFingerprints);
  const existingFingerprints = getExistingWorkoutFingerprints(data.exercises, data.sessions, data.sets);

  for (const workout of input.workouts) {
    if (importedFingerprints.has(workout.fingerprint) || existingFingerprints.has(workout.fingerprint)) continue;

    const sessionId = Math.max(0, ...data.sessions.map((session) => session.id)) + 1;
    const createdAt = `${workout.workoutDate}T12:00:00.000Z`;
    data.sessions.push({
      id: sessionId,
      workout_date: workout.workoutDate,
      notes: workout.notes,
      created_at: createdAt
    });

    for (const [index, set] of workout.sets.entries()) {
      data.sets.push({
        id: Math.max(0, ...data.sets.map((item) => item.id)) + 1,
        session_id: sessionId,
        exercise_id: workout.exerciseId,
        set_number: index + 1,
        reps: set.reps,
        weight: set.weight,
        rir: 0,
        created_at: createdAt
      });
    }

    importedFingerprints.add(workout.fingerprint);
    existingFingerprints.add(workout.fingerprint);
  }

  data.importFingerprints = [...importedFingerprints];
  writeDatabase(data);
}

export async function deleteWorkoutSession(sessionId: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const setsResult = await supabase.from("workout_sets").delete().eq("session_id", sessionId);
    throwIfSupabaseError(setsResult.error);
    const sessionResult = await supabase.from("workout_sessions").delete().eq("id", sessionId);
    throwIfSupabaseError(sessionResult.error);
    return;
  }

  const data = readDatabase();
  data.sets = data.sets.filter((set) => set.session_id !== sessionId);
  data.sessions = data.sessions.filter((session) => session.id !== sessionId);
  writeDatabase(data);
}

export async function saveBodyWeightLog(input: { loggedDate: string; weight: number; unit: UnitSystem }) {
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase.from("body_weight_logs").upsert(
      {
        user_id: user.id,
        logged_date: input.loggedDate,
        weight: input.weight,
        created_at: `${input.loggedDate}T12:00:00.000Z`
      },
      { onConflict: "user_id,logged_date" }
    );
    if (result.error && isMissingBodyWeightTableError(result.error)) {
      throw new Error("Body weight logging needs the Supabase schema update for body_weight_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  const row: BodyWeightLog = {
    id: Math.max(0, ...data.bodyWeightLogs.map((log) => log.id)) + 1,
    weight: input.weight,
    unit: input.unit,
    logged_at: `${input.loggedDate}T12:00:00.000Z`,
    logged_date: input.loggedDate,
    created_at: now()
  };
  data.bodyWeightLogs = [...normalizeBodyWeightLogs(data.bodyWeightLogs), row];
  writeDatabase(data);
}

export async function updateBodyWeightLog(input: { id: number; loggedDate: string; weight: number; unit: UnitSystem }) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase
      .from("body_weight_logs")
      .update({ logged_date: input.loggedDate, weight: input.weight, created_at: `${input.loggedDate}T12:00:00.000Z` })
      .eq("id", input.id);
    if (result.error && isMissingBodyWeightTableError(result.error)) {
      throw new Error("Body weight logging needs the Supabase schema update for body_weight_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  data.bodyWeightLogs = normalizeBodyWeightLogs(data.bodyWeightLogs).map((log) =>
    log.id === input.id
      ? { ...log, weight: input.weight, unit: input.unit, logged_at: `${input.loggedDate}T12:00:00.000Z`, logged_date: input.loggedDate }
      : log
  );
  writeDatabase(data);
}

export async function deleteBodyWeightLog(id: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.from("body_weight_logs").delete().eq("id", id);
    if (result.error && isMissingBodyWeightTableError(result.error)) {
      throw new Error("Body weight logging needs the Supabase schema update for body_weight_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  data.bodyWeightLogs = data.bodyWeightLogs.filter((log) => log.id !== id);
  writeDatabase(data);
}

export async function updateWorkoutSession(input: { sessionId: number; exerciseId: number; workoutDate: string; notes: string; sets: { reps: number; weight: number }[] }) {
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;

  if (supabase) {
    await requireCloudUser(supabase);
    const sessionResult = await supabase
      .from("workout_sessions")
      .update({ workout_date: input.workoutDate, notes: input.notes, created_at: timestamp })
      .eq("id", input.sessionId);
    throwIfSupabaseError(sessionResult.error);

    const deleteResult = await supabase.from("workout_sets").delete().eq("session_id", input.sessionId);
    throwIfSupabaseError(deleteResult.error);

    const setRows = input.sets.map((set, index) => ({
      session_id: input.sessionId,
      exercise_id: input.exerciseId,
      set_number: index + 1,
      reps: set.reps,
      weight: set.weight,
      rir: 0,
      created_at: timestamp
    }));
    const setsResult = await supabase.from("workout_sets").insert(setRows);
    throwIfSupabaseError(setsResult.error);
    return;
  }

  const data = readDatabase();
  data.sessions = data.sessions.map((session) =>
    session.id === input.sessionId
      ? {
          ...session,
          workout_date: input.workoutDate,
          notes: input.notes,
          created_at: timestamp
        }
      : session
  );
  data.sets = data.sets.filter((set) => set.session_id !== input.sessionId);
  for (const [index, set] of input.sets.entries()) {
    data.sets.push({
      id: Math.max(0, ...data.sets.map((item) => item.id)) + 1,
      session_id: input.sessionId,
      exercise_id: input.exerciseId,
      set_number: index + 1,
      reps: set.reps,
      weight: set.weight,
      rir: 0,
      created_at: timestamp
    });
  }

  writeDatabase(data);
}

export async function updateConfigWeight(id: number, weightFactor: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.from("muscle_strength_config").update({ weight_factor: weightFactor }).eq("id", id);
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  data.configs = data.configs.map((config) => (config.id === id ? { ...config, weight_factor: weightFactor } : config));
  writeDatabase(data);
}

export async function updateUnitSystem(unitSystem: UnitSystem) {
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase
      .from("app_settings")
      .upsert({ user_id: user.id, key: "unit_system", value: unitSystem }, { onConflict: "user_id,key" });
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  data.unitSystem = unitSystem;
  writeDatabase(data);
}

export async function updateTrainingSplit(days: TrainingSplitDay[]): Promise<TrainingSplit> {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("save_shared_training_split", { split_days: days });
    if (result.error && isMissingTrainingSplitError(result.error)) {
      throw new Error("Shared training splits need the Supabase schema update before they can sync.");
    }
    throwIfSupabaseError(result.error);
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    return loadCloudTrainingSplit(supabase, user.id);
  }

  const data = readDatabase();
  const currentUser = data.users.find((user) => user.id === data.currentUserId);
  data.trainingSplit = normalizeTrainingSplit({ days, updated_at: now(), updated_by: currentUser?.name ?? "You" });
  writeDatabase(data);
  return data.trainingSplit;
}

export async function saveActiveWorkout(activeWorkout: ActiveWorkout | null) {
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    if (!activeWorkout) {
      const result = await supabase.from("app_settings").delete().eq("user_id", user.id).eq("key", "active_workout");
      throwIfSupabaseError(result.error);
      return;
    }
    const result = await supabase
      .from("app_settings")
      .upsert({ user_id: user.id, key: "active_workout", value: JSON.stringify(activeWorkout) }, { onConflict: "user_id,key" });
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  data.activeWorkout = activeWorkout;
  writeDatabase(data);
}

export async function loadSocialData(): Promise<SocialData> {
  if (!supabase) return localSocialNotice();

  const user = await requireCloudUser(supabase, false);
  if (!user) return localSocialNotice("Log in with a cloud account to use friend leaderboards.");

  const friendshipsResult = await supabase
    .from("friendships")
    .select("*")
    .order("created_at", { ascending: false });

  if (friendshipsResult.error && isMissingSocialTableError(friendshipsResult.error)) {
    return localSocialNotice("Friend leaderboards need the Supabase social schema update before they can sync.");
  }
  throwIfSupabaseError(friendshipsResult.error);

  const friendships = (friendshipsResult.data ?? []) as FriendshipRow[];
  const friendIds = [...new Set(friendships.map((friendship) => otherFriendId(friendship, user.id)).filter(Boolean))];
  const profileIds = [...new Set([user.id, ...friendIds])];
  const [profilesResult, invitesResult, snapshotsResult, splitSyncResult] = await Promise.all([
    supabase.from("profiles").select("id,name,email,created_at").in("id", profileIds),
    supabase.from("friend_invites").select("*").eq("owner_id", user.id).is("accepted_by", null).order("created_at", { ascending: false }),
    supabase.from("leaderboard_score_snapshots").select("*").order("best_score", { ascending: false }),
    supabase.from("split_sync_requests").select("*").order("updated_at", { ascending: false })
  ]);

  throwIfSupabaseError(profilesResult.error);
  throwIfSupabaseError(invitesResult.error);
  throwIfSupabaseError(snapshotsResult.error);
  if (splitSyncResult.error && isMissingTrainingSplitError(splitSyncResult.error)) {
    throw new Error("Shared training splits need the Supabase schema update before they can sync.");
  }
  throwIfSupabaseError(splitSyncResult.error);

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile as ProfileRow]));
  const splitSyncRequests = (splitSyncResult.data ?? []) as SplitSyncRequestRow[];
  const currentProfile = profiles.get(user.id);
  const friends = friendships.map((friendship) => {
    const friendId = otherFriendId(friendship, user.id);
    const profile = profiles.get(friendId);
    const splitSync = splitSyncRequests.find((request) => request.requester_id === friendId || request.addressee_id === friendId);
    const splitSyncStatus = splitSync?.status === "accepted"
      ? ("synced" as const)
      : splitSync?.status === "pending" && splitSync.requester_id === user.id
        ? ("sent" as const)
        : splitSync?.status === "pending"
          ? ("received" as const)
          : ("none" as const);
    return {
      id: friendId,
      name: profileDisplayName(profile, "Friend"),
      email: profile?.email ?? null,
      status: friendship.status,
      direction: friendship.requester_id === user.id ? ("sent" as const) : ("received" as const),
      split_sync_status: splitSyncStatus,
      split_sync_request_id: splitSyncStatus === "none" ? null : splitSync?.id ?? null,
      created_at: friendship.created_at
    };
  });

  const invites = ((invitesResult.data ?? []) as FriendInviteRow[]).map((invite) => ({
    id: invite.id,
    token: invite.token,
    invite_url: inviteUrl(invite.token),
    expires_at: invite.expires_at,
    accepted_by: invite.accepted_by,
    created_at: invite.created_at
  }));

  const leaderboard = ((snapshotsResult.data ?? []) as ScoreSnapshotRow[]).map((snapshot) => {
    const profile = profiles.get(snapshot.user_id);
    return {
      user_id: snapshot.user_id,
      name: snapshot.user_id === user.id ? profileDisplayName(currentProfile, "You") : profileDisplayName(profile, "Friend"),
      exercise_id: snapshot.exercise_id,
      exercise_name: snapshot.exercise_name,
      best_estimated_1rm: Number(snapshot.best_score),
      achieved_at: snapshot.achieved_at
    };
  });

  return { friends, invites, leaderboard, notice: null };
}

export async function createFriendInvite() {
  if (!supabase) throw new Error("Friend invites need the Supabase-powered web app.");
  const user = await requireCloudUser(supabase);
  if (!user) throw new Error("Please log in again.");

  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const result = await supabase
    .from("friend_invites")
    .insert({ owner_id: user.id, token, expires_at: expiresAt })
    .select("token")
    .single<{ token: string }>();

  if (result.error && isMissingSocialTableError(result.error)) {
    throw new Error("Friend invites need the Supabase social schema update.");
  }
  throwIfSupabaseError(result.error);
  return inviteUrl(result.data?.token ?? token);
}

export async function acceptFriendInvite(token: string) {
  if (!supabase) throw new Error("Friend invites need the Supabase-powered web app.");
  await requireCloudUser(supabase);
  const normalizedToken = token.trim();
  if (!normalizedToken) return;

  const result = await supabase.rpc("accept_friend_invite", { invite_token: normalizedToken });
  if (result.error && isMissingSocialTableError(result.error)) {
    throw new Error("Friend invites need the Supabase social schema update.");
  }
  throwIfSupabaseError(result.error);
}

export async function revokeFriendInvite(inviteId: string) {
  if (!supabase) throw new Error("Friend invites need the Supabase-powered web app.");
  await requireCloudUser(supabase);
  const result = await supabase.from("friend_invites").delete().eq("id", inviteId);
  throwIfSupabaseError(result.error);
}

export async function removeFriend(friendId: string) {
  if (!supabase) throw new Error("Friend management needs the Supabase-powered web app.");
  const user = await requireCloudUser(supabase);
  if (!user) throw new Error("Please log in again.");

  const result = await supabase
    .from("friendships")
    .delete()
    .or(`and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`);
  throwIfSupabaseError(result.error);
}

export async function requestSplitSync(friendId: string, days: TrainingSplitDay[]) {
  if (!supabase) throw new Error("Split synchronization needs the Supabase-powered web app.");
  await requireCloudUser(supabase);
  const result = await supabase.rpc("request_split_sync", { friend_id: friendId, split_days: days });
  if (result.error && isMissingTrainingSplitError(result.error)) {
    throw new Error("Shared training splits need the Supabase schema update before they can sync.");
  }
  throwIfSupabaseError(result.error);
}

export async function respondSplitSync(requestId: string, accepted: boolean) {
  if (!supabase) throw new Error("Split synchronization needs the Supabase-powered web app.");
  await requireCloudUser(supabase);
  const result = await supabase.rpc("respond_split_sync", { request_id: requestId, accept_request: accepted });
  if (result.error && isMissingTrainingSplitError(result.error)) {
    throw new Error("Shared training splits need the Supabase schema update before they can sync.");
  }
  throwIfSupabaseError(result.error);
}

export async function removeSplitSync(friendId: string) {
  if (!supabase) throw new Error("Split synchronization needs the Supabase-powered web app.");
  await requireCloudUser(supabase);
  const result = await supabase.rpc("remove_split_sync", { friend_id: friendId });
  if (result.error && isMissingTrainingSplitError(result.error)) {
    throw new Error("Shared training splits need the Supabase schema update before they can sync.");
  }
  throwIfSupabaseError(result.error);
}

export async function syncScoreSnapshots(points: ExerciseScorePoint[]) {
  if (!supabase) return;
  const user = await requireCloudUser(supabase, false);
  if (!user) return;

  const bestByExercise = new Map<number, ExerciseScorePoint>();
  for (const point of points) {
    const existing = bestByExercise.get(point.exerciseId);
    if (!existing || point.estimated1RM > existing.estimated1RM || (point.estimated1RM === existing.estimated1RM && point.date > existing.date)) {
      bestByExercise.set(point.exerciseId, point);
    }
  }

  const rows = [...bestByExercise.values()].map((point) => ({
    user_id: user.id,
    exercise_id: point.exerciseId,
    exercise_name: point.exerciseName,
    best_score: point.estimated1RM,
    achieved_at: point.date,
    updated_at: now()
  }));

  const deleteResult = await supabase
    .from("leaderboard_score_snapshots")
    .delete()
    .eq("user_id", user.id);
  if (deleteResult.error && isMissingSocialTableError(deleteResult.error)) return;
  throwIfSupabaseError(deleteResult.error);
  if (!rows.length) return;
  const insertResult = await supabase.from("leaderboard_score_snapshots").insert(rows);
  if (insertResult.error && isMissingSocialTableError(insertResult.error)) return;
  throwIfSupabaseError(insertResult.error);
}

async function requireCloudUser(client: SupabaseClient, throwOnMissing = true) {
  const result = await client.auth.getUser();
  if (result.error) {
    if (!throwOnMissing && result.error.message.toLowerCase().includes("session")) return null;
    throwIfSupabaseError(result.error);
  }
  if (!result.data.user && throwOnMissing) throw new Error("Please log in again.");
  return result.data.user;
}

async function upsertProfile(client: SupabaseClient, id: string, name: string, email: string) {
  const result = await client.from("profiles").upsert({ id, name, email }, { onConflict: "id" });
  throwIfSupabaseError(result.error);
}

function cloudUserToAppUser(user: NonNullable<Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>["data"]["user"]>, profile?: ProfileRow | null): User {
  return {
    id: user.id,
    name: profile?.name ?? user.user_metadata?.name ?? user.email ?? "User",
    email: profile?.email ?? user.email ?? "",
    password_hash: "",
    created_at: profile?.created_at ?? user.created_at ?? now()
  };
}

function throwIfSupabaseError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function localSocialNotice(notice = "Friend leaderboards need the Supabase-powered web app so scores can sync between accounts."): SocialData {
  return { friends: [], invites: [], leaderboard: [], notice };
}

function isMissingBodyWeightTableError(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return error.message.includes("body_weight_logs") && (error.message.includes("schema cache") || error.message.includes("does not exist") || error.code === "PGRST205");
}

function isMissingSocialTableError(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return (
    (error.message.includes("friendships") ||
      error.message.includes("friend_invites") ||
      error.message.includes("leaderboard_score_snapshots") ||
      error.message.includes("accept_friend_invite")) &&
    (error.message.includes("schema cache") || error.message.includes("does not exist") || error.code === "PGRST205")
  );
}

function isMissingTrainingSplitError(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return (
    (error.message.includes("shared_training_splits") ||
      error.message.includes("split_sync_requests") ||
      error.message.includes("save_shared_training_split") ||
      error.message.includes("request_split_sync") ||
      error.message.includes("respond_split_sync") ||
      error.message.includes("remove_split_sync")) &&
    (error.message.includes("schema cache") || error.message.includes("does not exist") || error.code === "PGRST205")
  );
}

async function loadCloudTrainingSplit(client: SupabaseClient, userId: string) {
  const result = await client
    .from("shared_training_splits")
    .select("split_days,updated_by_name,updated_at")
    .eq("user_id", userId)
    .maybeSingle<SharedTrainingSplitRow>();
  if (result.error && isMissingTrainingSplitError(result.error)) return createDefaultTrainingSplit();
  throwIfSupabaseError(result.error);
  if (!result.data) return createDefaultTrainingSplit();
  return normalizeTrainingSplit({
    days: result.data.split_days,
    updated_by: result.data.updated_by_name,
    updated_at: result.data.updated_at
  });
}

function otherFriendId(friendship: FriendshipRow, currentUserId: string) {
  return friendship.requester_id === currentUserId ? friendship.addressee_id : friendship.requester_id;
}

function profileDisplayName(profile: ProfileRow | undefined, fallback: string) {
  const name = profile?.name?.trim();
  if (name) return name.split(/\s+/)[0];
  const email = profile?.email?.trim();
  if (email) return email.split("@")[0] || fallback;
  return fallback;
}

function inviteUrl(token: string) {
  if (typeof window === "undefined") return token;
  const url = new URL(window.location.origin);
  url.searchParams.set("invite", token);
  return url.toString();
}

function createInviteToken() {
  const bytes = new Uint8Array(18);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizeBodyWeightLogs(logs: BodyWeightLog[]) {
  return logs.map((log) => {
    const loggedDate = log.logged_at?.slice(0, 10) ?? log.logged_date ?? log.created_at.slice(0, 10);
    return {
      ...log,
      unit: log.unit ?? "lb",
      logged_at: log.logged_at ?? `${loggedDate}T12:00:00.000Z`,
      logged_date: loggedDate
    };
  });
}

async function getCloudImportedWorkoutFingerprints(client: SupabaseClient) {
  const result = await client.from("app_settings").select("value").eq("key", "imported_workout_fingerprints").maybeSingle<{ value: string }>();
  throwIfSupabaseError(result.error);
  return parseFingerprintSetting(result.data?.value);
}

async function setCloudImportedWorkoutFingerprints(client: SupabaseClient, fingerprints: Set<string>) {
  const user = await requireCloudUser(client);
  if (!user) throw new Error("Please log in again.");
  const result = await client
    .from("app_settings")
    .upsert({ user_id: user.id, key: "imported_workout_fingerprints", value: JSON.stringify([...fingerprints]), updated_at: now() }, { onConflict: "user_id,key" });
  throwIfSupabaseError(result.error);
}

async function getCloudExistingWorkoutFingerprints(client: SupabaseClient) {
  const [exercisesResult, sessionsResult, setsResult] = await Promise.all([
    client.from("exercises").select("*"),
    client.from("workout_sessions").select("*"),
    client.from("workout_sets").select("*").order("set_number")
  ]);
  throwIfSupabaseError(exercisesResult.error);
  throwIfSupabaseError(sessionsResult.error);
  throwIfSupabaseError(setsResult.error);
  return getExistingWorkoutFingerprints(
    (exercisesResult.data ?? []) as Exercise[],
    (sessionsResult.data ?? []) as WorkoutSession[],
    (setsResult.data ?? []) as WorkoutSet[]
  );
}

function getExistingWorkoutFingerprints(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[]) {
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
      const orderedSets = [...sessionSets].sort((a, b) => a.set_number - b.set_number);
      return [
        buildWorkoutFingerprint({
          workoutDate: session.workout_date,
          exerciseName: exercise.name,
          notes: session.notes ?? "",
          sets: orderedSets.map((set) => ({ reps: set.reps, weight: set.weight }))
        })
      ];
    })
  );
}

function parseFingerprintSetting(value: string | undefined | null) {
  if (!value) return new Set<string>();
  try {
    const parsed = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function normalizeCatalog(existing: Exercise[]) {
  if (!exercisesAreCatalog(existing)) return catalogExerciseRows(now());

  let nextId = existing.reduce((max, exercise) => Math.max(max, exercise.id), 0);
  const existingByName = new Map(existing.map((exercise) => [exercise.name, exercise]));

  return catalogExerciseRows(now()).map((catalogExercise) => {
    const existingExercise = existingByName.get(catalogExercise.name);
    if (existingExercise) {
      return {
        ...existingExercise,
        primary_muscle: catalogExercise.primary_muscle,
        secondary_muscle: catalogExercise.secondary_muscle,
        is_strength_exercise: 0
      };
    }

    nextId += 1;
    return {
      ...catalogExercise,
      id: nextId
    };
  });
}

function exercisesAreCatalog(exercises: Exercise[]) {
  const catalogNames = new Set(catalogExerciseRows("").map((exercise) => exercise.name));
  return exercises.every((exercise) => catalogNames.has(exercise.name));
}

function withPreferenceFlags(exercises: Exercise[], preferences: UserExercisePreference[], userId: number | string | null) {
  const enabledByExercise = new Map(
    preferences
      .filter((preference) => String(preference.user_id) === String(userId) && Boolean(preference.enabled))
      .map((preference) => [preference.exercise_id, true])
  );
  return exercises.map((exercise) => ({
    ...exercise,
    is_strength_exercise: enabledByExercise.has(exercise.id) ? 1 : 0
  }));
}
