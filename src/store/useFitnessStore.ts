import { create } from "zustand";

import { buildExerciseScorePoints, buildMuscleScorePoints, summarizeMuscles } from "@/services/strength/strengthService";
import { createExercise, deleteBodyWeightLog as deleteStoredBodyWeightLog, deleteExercise, deleteWorkoutSession, loadAllData, loginUser, logoutUser, logWorkout, registerUser, requestPasswordReset, saveBodyWeightLog as saveStoredBodyWeightLog, updateBodyWeightLog as updateStoredBodyWeightLog, updateConfigWeight, updateCurrentUserPassword, updateExerciseMuscle, updateUnitSystem } from "@/database/database";
import { BodyWeightLog, Exercise, ExerciseScorePoint, LoggedSetDraft, MuscleGroup, MuscleScorePoint, MuscleStrengthConfig, MuscleSummary, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
import { todayIso } from "@/utils/date";
import { weightToStorageUnit } from "@/utils/units";

type FitnessState = {
  loading: boolean;
  currentUser: User | null;
  authError: string | null;
  authNotice: string | null;
  unitSystem: UnitSystem;
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  bodyWeightLogs: BodyWeightLog[];
  configs: MuscleStrengthConfig[];
  exercisePoints: ExerciseScorePoint[];
  musclePoints: MuscleScorePoint[];
  muscleSummaries: MuscleSummary[];
  hydrate: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  resetPassword: (input: { email: string }) => Promise<void>;
  updatePassword: (input: { password: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  addExercise: (input: { name: string; primaryMuscle: MuscleGroup; secondaryMuscle?: MuscleGroup | null; strength: boolean }) => Promise<void>;
  removeExercise: (exerciseId: number) => Promise<void>;
  setExerciseMuscle: (exerciseId: number, muscle: MuscleGroup) => Promise<void>;
  saveWorkout: (input: { exerciseId: number; workoutDate: string; notes: string; sets: LoggedSetDraft[] }) => Promise<void>;
  deleteWorkoutLog: (sessionId: number) => Promise<void>;
  saveBodyWeightLog: (input: { loggedDate: string; weight: string; unitSystem?: UnitSystem }) => Promise<void>;
  updateBodyWeightLog: (input: { id: number; loggedDate: string; weight: string; unitSystem?: UnitSystem }) => Promise<void>;
  deleteBodyWeightLog: (id: number) => Promise<void>;
  setUnitSystem: (unitSystem: UnitSystem) => Promise<void>;
  setConfigWeight: (id: number, weightFactor: number) => Promise<void>;
};

function derive(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[], configs: MuscleStrengthConfig[]) {
  const exercisePoints = buildExerciseScorePoints(exercises, sessions, sets);
  const musclePoints = buildMuscleScorePoints(exercises, configs, exercisePoints);
  const muscleSummaries = summarizeMuscles(exercises, configs, musclePoints);
  return { exercisePoints, musclePoints, muscleSummaries };
}

export const useFitnessStore = create<FitnessState>((set, get) => ({
  loading: true,
  currentUser: null,
  authError: null,
  authNotice: null,
  unitSystem: "lb",
  exercises: [],
  sessions: [],
  sets: [],
  bodyWeightLogs: [],
  configs: [],
  exercisePoints: [],
  musclePoints: [],
  muscleSummaries: [],
  hydrate: async () => {
    try {
      const data = await loadAllData();
      set({ ...data, ...derive(data.exercises, data.sessions, data.sets, data.configs), loading: false, authError: null });
    } catch (error) {
      set({
        currentUser: null,
        exercises: [],
        sessions: [],
        sets: [],
        bodyWeightLogs: [],
        configs: [],
        exercisePoints: [],
        musclePoints: [],
        muscleSummaries: [],
        loading: false,
        authError: error instanceof Error ? error.message : "Could not load app data."
      });
    }
  },
  login: async (input) => {
    try {
      const currentUser = await loginUser(input);
      set({ currentUser, authError: null, authNotice: null });
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not log in." });
    }
  },
  register: async (input) => {
    try {
      const currentUser = await registerUser(input);
      set({ currentUser, authError: null, authNotice: null });
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not create account." });
    }
  },
  resetPassword: async (input) => {
    try {
      await requestPasswordReset(input);
      set({ authError: null, authNotice: "Password reset email sent. Open the link in your email to choose a new password." });
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not send password reset email.", authNotice: null });
    }
  },
  updatePassword: async (input) => {
    try {
      await updateCurrentUserPassword(input);
      set({ authError: null, authNotice: "Password updated. You can continue using the app." });
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not update password.", authNotice: null });
    }
  },
  logout: async () => {
    await logoutUser();
    set({ currentUser: null, authError: null, authNotice: null });
  },
  clearAuthError: () => set({ authError: null, authNotice: null }),
  addExercise: async (input) => {
    await createExercise(input);
    await get().hydrate();
  },
  removeExercise: async (exerciseId) => {
    await deleteExercise(exerciseId);
    await get().hydrate();
  },
  setExerciseMuscle: async (exerciseId, muscle) => {
    await updateExerciseMuscle(exerciseId, muscle);
    await get().hydrate();
  },
  saveWorkout: async (input) => {
    const unitSystem = get().unitSystem;
    const sets = input.sets
      .map((set) => ({ reps: Number(set.reps), weight: weightToStorageUnit(Number(set.weight), unitSystem) }))
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
  saveBodyWeightLog: async (input) => {
    const weight = parseWeightInput(input.weight);
    const loggedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.loggedDate) ? input.loggedDate : todayIso();
    const unitSystem = input.unitSystem ?? get().unitSystem;

    if (!Number.isFinite(weight) || weight <= 0) return;
    await saveStoredBodyWeightLog({ loggedDate, weight: weightToStorageUnit(weight, unitSystem), unit: unitSystem });
    await get().hydrate();
  },
  updateBodyWeightLog: async (input) => {
    const weight = parseWeightInput(input.weight);
    const loggedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.loggedDate) ? input.loggedDate : todayIso();
    const unitSystem = input.unitSystem ?? get().unitSystem;

    if (!Number.isFinite(weight) || weight <= 0) return;
    await updateStoredBodyWeightLog({ id: input.id, loggedDate, weight: weightToStorageUnit(weight, unitSystem), unit: unitSystem });
    await get().hydrate();
  },
  deleteBodyWeightLog: async (id) => {
    await deleteStoredBodyWeightLog(id);
    await get().hydrate();
  },
  setUnitSystem: async (unitSystem) => {
    await updateUnitSystem(unitSystem);
    set({ unitSystem });
  },
  setConfigWeight: async (id, weightFactor) => {
    await updateConfigWeight(id, weightFactor);
    await get().hydrate();
  }
}));

function parseWeightInput(value: string) {
  return Number(value.trim().replace(",", "."));
}
