import { Exercise, MuscleStrengthConfig, User, WorkoutSession, WorkoutSet } from "@/types";
import { hashPassword, normalizeEmail } from "@/utils/password";

const storageKey = "growth.preview.database.v2";

type WebDatabase = {
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  configs: MuscleStrengthConfig[];
  users: User[];
  currentUserId: number | null;
};

function now() {
  return new Date().toISOString();
}

function seedDatabase(): WebDatabase {
  return { exercises: [], sessions: [], sets: [], configs: [], users: [], currentUserId: null };
}

function readDatabase() {
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    const parsed = JSON.parse(existing) as Partial<WebDatabase>;
    return {
      exercises: parsed.exercises ?? [],
      sessions: parsed.sessions ?? [],
      sets: parsed.sets ?? [],
      configs: parsed.configs ?? [],
      users: parsed.users ?? [],
      currentUserId: parsed.currentUserId ?? null
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
  const data = readDatabase();
  return {
    exercises: [...data.exercises].sort((a, b) => a.name.localeCompare(b.name)),
    sessions: [...data.sessions].sort((a, b) => b.workout_date.localeCompare(a.workout_date)),
    sets: [...data.sets].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.set_number - b.set_number),
    configs: [...data.configs].sort((a, b) => a.muscle_group.localeCompare(b.muscle_group)),
    currentUser: data.users.find((user) => user.id === data.currentUserId) ?? null
  };
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  const data = readDatabase();
  const email = normalizeEmail(input.email);
  const existing = data.users.find((user) => user.email === email);
  if (existing) throw new Error("An account already exists for this email.");

  const user = {
    id: Math.max(0, ...data.users.map((item) => item.id)) + 1,
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
  const data = readDatabase();
  const email = normalizeEmail(input.email);
  const user = data.users.find((item) => item.email === email);
  if (!user || user.password_hash !== hashPassword(input.password, email)) {
    throw new Error("Email or password is incorrect.");
  }

  data.currentUserId = user.id;
  writeDatabase(data);
  return user;
}

export async function logoutUser() {
  const data = readDatabase();
  data.currentUserId = null;
  writeDatabase(data);
}

export async function createExercise(input: { name: string; primaryMuscle: Exercise["primary_muscle"]; secondaryMuscle?: Exercise["secondary_muscle"]; strength: boolean }) {
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

export async function logWorkout(input: { exerciseId: number; workoutDate: string; notes: string; sets: { reps: number; weight: number }[] }) {
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
  const data = readDatabase();
  data.sets = data.sets.filter((set) => set.session_id !== sessionId);
  data.sessions = data.sessions.filter((session) => session.id !== sessionId);
  writeDatabase(data);
}

export async function updateConfigWeight(id: number, weightFactor: number) {
  const data = readDatabase();
  data.configs = data.configs.map((config) => (config.id === id ? { ...config, weight_factor: weightFactor } : config));
  writeDatabase(data);
}
