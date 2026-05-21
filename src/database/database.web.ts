import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { BodyWeightLog, Exercise, MuscleStrengthConfig, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
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
  users: User[];
  currentUserId: number | null;
  unitSystem: UnitSystem;
};

type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
};

function now() {
  return new Date().toISOString();
}

function seedDatabase(): WebDatabase {
  return { exercises: [], sessions: [], sets: [], bodyWeightLogs: [], configs: [], users: [], currentUserId: null, unitSystem: "lb" };
}

function readDatabase(): WebDatabase {
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    const parsed = JSON.parse(existing) as Partial<WebDatabase>;
    const unitSystem: UnitSystem = parsed.unitSystem === "kg" ? "kg" : "lb";
    return {
      exercises: parsed.exercises ?? [],
      sessions: parsed.sessions ?? [],
      sets: parsed.sets ?? [],
      bodyWeightLogs: parsed.bodyWeightLogs ?? [],
      configs: parsed.configs ?? [],
      users: parsed.users ?? [],
      currentUserId: parsed.currentUserId ?? null,
      unitSystem
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
  return {
    exercises: [...data.exercises].sort((a, b) => a.name.localeCompare(b.name)),
    sessions: [...data.sessions].sort((a, b) => b.workout_date.localeCompare(a.workout_date)),
    sets: [...data.sets].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.set_number - b.set_number),
    bodyWeightLogs: normalizeBodyWeightLogs(data.bodyWeightLogs).sort((a, b) => b.logged_at.localeCompare(a.logged_at) || b.created_at.localeCompare(a.created_at)),
    configs: [...data.configs].sort((a, b) => a.muscle_group.localeCompare(b.muscle_group)),
    currentUser: data.users.find((user) => user.id === data.currentUserId) ?? null,
    unitSystem: data.unitSystem
  };
}

async function loadCloudData(client: SupabaseClient) {
  const user = await requireCloudUser(client, false);
  if (!user) {
    return { exercises: [], sessions: [], sets: [], bodyWeightLogs: [], configs: [], currentUser: null, unitSystem: "lb" as UnitSystem };
  }

  const [profileResult, exercisesResult, sessionsResult, setsResult, bodyWeightResult, configsResult, settingResult] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).maybeSingle<ProfileRow>(),
    client.from("exercises").select("*").order("name"),
    client.from("workout_sessions").select("*").order("workout_date", { ascending: false }),
    client.from("workout_sets").select("*").order("created_at").order("set_number"),
    client.from("body_weight_logs").select("*").order("logged_date", { ascending: false }).order("created_at", { ascending: false }),
    client.from("muscle_strength_config").select("*").order("muscle_group"),
    client.from("app_settings").select("value").eq("key", "unit_system").maybeSingle<{ value: UnitSystem }>()
  ]);

  throwIfSupabaseError(profileResult.error);
  throwIfSupabaseError(exercisesResult.error);
  throwIfSupabaseError(sessionsResult.error);
  throwIfSupabaseError(setsResult.error);
  if (bodyWeightResult.error && !isMissingBodyWeightTableError(bodyWeightResult.error)) {
    throwIfSupabaseError(bodyWeightResult.error);
  }
  throwIfSupabaseError(configsResult.error);
  throwIfSupabaseError(settingResult.error);

  return {
    exercises: (exercisesResult.data ?? []) as Exercise[],
    sessions: (sessionsResult.data ?? []) as WorkoutSession[],
    sets: (setsResult.data ?? []) as WorkoutSet[],
    bodyWeightLogs: normalizeBodyWeightLogs(bodyWeightResult.error ? [] : (bodyWeightResult.data ?? []) as BodyWeightLog[]),
    configs: (configsResult.data ?? []) as MuscleStrengthConfig[],
    currentUser: cloudUserToAppUser(user, profileResult.data),
    unitSystem: settingResult.data?.value === "kg" ? "kg" : "lb"
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

export async function createExercise(input: { name: string; primaryMuscle: Exercise["primary_muscle"]; secondaryMuscle?: Exercise["secondary_muscle"]; strength: boolean }) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.from("exercises").insert({
      name: input.name.trim(),
      primary_muscle: input.primaryMuscle,
      secondary_muscle: input.secondaryMuscle ?? null,
      is_strength_exercise: input.strength ? 1 : 0,
      created_at: now()
    });
    throwIfSupabaseError(result.error);
    return;
  }

  const data = readDatabase();
  const id = Math.max(0, ...data.exercises.map((exercise) => exercise.id)) + 1;
  data.exercises.push({
    id,
    name: input.name.trim(),
    primary_muscle: input.primaryMuscle,
    secondary_muscle: input.secondaryMuscle ?? null,
    is_strength_exercise: input.strength ? 1 : 0,
    created_at: now()
  });

  writeDatabase(data);
}

export async function deleteExercise(exerciseId: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const sessionResult = await supabase.from("workout_sets").select("session_id").eq("exercise_id", exerciseId);
    throwIfSupabaseError(sessionResult.error);
    const affectedSessionIds = [...new Set((sessionResult.data ?? []).map((row) => row.session_id as number))];

    const setsResult = await supabase.from("workout_sets").delete().eq("exercise_id", exerciseId);
    throwIfSupabaseError(setsResult.error);
    const configsResult = await supabase.from("muscle_strength_config").delete().eq("exercise_id", exerciseId);
    throwIfSupabaseError(configsResult.error);
    const exerciseResult = await supabase.from("exercises").delete().eq("id", exerciseId);
    throwIfSupabaseError(exerciseResult.error);

    if (affectedSessionIds.length) {
      const remainingSetsResult = await supabase.from("workout_sets").select("session_id").in("session_id", affectedSessionIds);
      throwIfSupabaseError(remainingSetsResult.error);
      const sessionsWithSets = new Set((remainingSetsResult.data ?? []).map((row) => row.session_id as number));
      const emptySessionIds = affectedSessionIds.filter((sessionId) => !sessionsWithSets.has(sessionId));
      if (emptySessionIds.length) {
        const sessionsResult = await supabase.from("workout_sessions").delete().in("id", emptySessionIds);
        throwIfSupabaseError(sessionsResult.error);
      }
    }
    return;
  }

  const data = readDatabase();
  const affectedSessionIds = [...new Set(data.sets.filter((set) => set.exercise_id === exerciseId).map((set) => set.session_id))];
  data.sets = data.sets.filter((set) => set.exercise_id !== exerciseId);
  const sessionsWithSets = new Set(data.sets.map((set) => set.session_id));
  data.sessions = data.sessions.filter((session) => !affectedSessionIds.includes(session.id) || sessionsWithSets.has(session.id));
  data.configs = data.configs.filter((config) => config.exercise_id !== exerciseId);
  data.exercises = data.exercises.filter((exercise) => exercise.id !== exerciseId);
  writeDatabase(data);
}

export async function updateExerciseMuscle(exerciseId: number, primaryMuscle: Exercise["primary_muscle"]) {
  if (supabase) {
    await requireCloudUser(supabase);
    const exerciseResult = await supabase.from("exercises").update({ primary_muscle: primaryMuscle }).eq("id", exerciseId);
    throwIfSupabaseError(exerciseResult.error);
    const configResult = await supabase.from("muscle_strength_config").update({ muscle_group: primaryMuscle }).eq("exercise_id", exerciseId);
    throwIfSupabaseError(configResult.error);
    return;
  }

  const data = readDatabase();
  data.exercises = data.exercises.map((exercise) => (exercise.id === exerciseId ? { ...exercise, primary_muscle: primaryMuscle } : exercise));
  data.configs = data.configs.map((config) => (config.exercise_id === exerciseId ? { ...config, muscle_group: primaryMuscle } : config));
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
      rir: null,
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
      rir: null,
      created_at: timestamp
    });
  }

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

function isMissingBodyWeightTableError(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return error.message.includes("body_weight_logs") && (error.message.includes("schema cache") || error.message.includes("does not exist") || error.code === "PGRST205");
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
