import { create } from "zustand";

import { buildExerciseScorePoints, buildMuscleScorePoints, summarizeMuscles } from "@/services/strength/strengthService";
import { createExercise, deleteWorkoutSession, loadAllData, loginUser, logoutUser, logWorkout, registerUser, updateConfigWeight } from "@/database/database";
import { Exercise, ExerciseScorePoint, LoggedSetDraft, MuscleGroup, MuscleScorePoint, MuscleStrengthConfig, MuscleSummary, User, WorkoutSession, WorkoutSet } from "@/types";
import { todayIso } from "@/utils/date";

type FitnessState = {
  loading: boolean;
  currentUser: User | null;
  authError: string | null;
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  configs: MuscleStrengthConfig[];
  exercisePoints: ExerciseScorePoint[];
  musclePoints: MuscleScorePoint[];
  muscleSummaries: MuscleSummary[];
  hydrate: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  addExercise: (input: { name: string; primaryMuscle: MuscleGroup; secondaryMuscle?: MuscleGroup | null; strength: boolean }) => Promise<void>;
  saveWorkout: (input: { exerciseId: number; workoutDate: string; notes: string; sets: LoggedSetDraft[] }) => Promise<void>;
  deleteWorkoutLog: (sessionId: number) => Promise<void>;
  setConfigWeight: (id: number, weightFactor: number) => Promise<void>;
};

function derive(exercises: Exercise[], sets: WorkoutSet[], configs: MuscleStrengthConfig[]) {
  const exercisePoints = buildExerciseScorePoints(exercises, sets);
  const musclePoints = buildMuscleScorePoints(exercises, configs, exercisePoints);
  const muscleSummaries = summarizeMuscles(exercises, configs, musclePoints);
  return { exercisePoints, musclePoints, muscleSummaries };
}

export const useFitnessStore = create<FitnessState>((set, get) => ({
  loading: true,
  currentUser: null,
  authError: null,
  exercises: [],
  sessions: [],
  sets: [],
  configs: [],
  exercisePoints: [],
  musclePoints: [],
  muscleSummaries: [],
  hydrate: async () => {
    const data = await loadAllData();
    set({ ...data, ...derive(data.exercises, data.sets, data.configs), loading: false });
  },
  login: async (input) => {
    try {
      const currentUser = await loginUser(input);
      set({ currentUser, authError: null });
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not log in." });
    }
  },
  register: async (input) => {
    try {
      const currentUser = await registerUser(input);
      set({ currentUser, authError: null });
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not create account." });
    }
  },
  logout: async () => {
    await logoutUser();
    set({ currentUser: null, authError: null });
  },
  clearAuthError: () => set({ authError: null }),
  addExercise: async (input) => {
    await createExercise(input);
    await get().hydrate();
  },
  saveWorkout: async (input) => {
    const sets = input.sets
      .map((set) => ({ reps: Number(set.reps), weight: Number(set.weight) }))
      .filter((set) => Number.isFinite(set.reps) && Number.isFinite(set.weight) && set.reps > 0 && set.weight >= 0);
    const workoutDate = /^\d{4}-\d{2}-\d{2}$/.test(input.workoutDate) ? input.workoutDate : todayIso();

    if (!sets.length) return;
    await logWorkout({ exerciseId: input.exerciseId, workoutDate, notes: input.notes, sets });
    await get().hydrate();
  },
  deleteWorkoutLog: async (sessionId) => {
    await deleteWorkoutSession(sessionId);
    await get().hydrate();
  },
  setConfigWeight: async (id, weightFactor) => {
    await updateConfigWeight(id, weightFactor);
    await get().hydrate();
  }
}));
