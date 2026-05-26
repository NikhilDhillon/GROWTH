import { create } from "zustand";

import { getExerciseLoadType } from "@/constants/exercises";
import { createDefaultTrainingSplit } from "@/constants/trainingSplit";
import { buildExerciseScorePoints, buildMuscleScorePoints, summarizeMuscles } from "@/services/strength/strengthService";
import { acceptFriendInvite as acceptStoredFriendInvite, createFriendInvite as createStoredFriendInvite, deleteBodyWeightLog as deleteStoredBodyWeightLog, deleteWorkoutSession, importTrainingData as importStoredTrainingData, loadAllData, loadSocialData as loadStoredSocialData, loginUser, logoutUser, logWorkout, registerUser, removeFriend as removeStoredFriend, removeSplitSync as removeStoredSplitSync, requestPasswordReset, requestSplitSync as requestStoredSplitSync, respondSplitSync as respondStoredSplitSync, revokeFriendInvite as revokeStoredFriendInvite, saveActiveWorkout as saveStoredActiveWorkout, saveBodyWeightLog as saveStoredBodyWeightLog, setExerciseEnabled as setStoredExerciseEnabled, syncScoreSnapshots, updateBodyWeightLog as updateStoredBodyWeightLog, updateConfigWeight, updateCurrentUserPassword, updateTrainingSplit as updateStoredTrainingSplit, updateUnitSystem, updateWorkoutSession } from "@/database/database";
import { ParsedImportData } from "@/services/import/importService";
import { ActiveWorkout, BodyWeightLog, Exercise, ExerciseScorePoint, LoggedSetDraft, MuscleScorePoint, MuscleStrengthConfig, MuscleSummary, SocialData, TrainingSplit, TrainingSplitDay, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
import { todayIso } from "@/utils/date";
import { bodyWeightDisplayUnit, bodyWeightToStorageUnit, weightToStorageUnit } from "@/utils/units";

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
  trainingSplit: TrainingSplit;
  activeWorkout: ActiveWorkout | null;
  exercisePoints: ExerciseScorePoint[];
  musclePoints: MuscleScorePoint[];
  muscleSummaries: MuscleSummary[];
  socialData: SocialData;
  socialLoading: boolean;
  socialError: string | null;
  lastInviteUrl: string | null;
  hydrate: () => Promise<void>;
  loadSocial: () => Promise<void>;
  createFriendInvite: () => Promise<void>;
  acceptFriendInvite: (token: string) => Promise<void>;
  revokeFriendInvite: (inviteId: string) => Promise<void>;
  removeFriend: (friendId: string) => Promise<void>;
  requestSplitSync: (friendId: string, days: TrainingSplitDay[]) => Promise<void>;
  respondSplitSync: (requestId: string, accepted: boolean) => Promise<void>;
  removeSplitSync: (friendId: string) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  resetPassword: (input: { email: string }) => Promise<void>;
  updatePassword: (input: { password: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  setExerciseEnabled: (exerciseId: number, enabled: boolean) => Promise<void>;
  saveWorkout: (input: { exerciseId: number; workoutDate: string; notes: string; sets: LoggedSetDraft[] }) => Promise<void>;
  updateWorkoutLog: (input: { sessionId: number; exerciseId: number; workoutDate: string; notes: string; sets: LoggedSetDraft[] }) => Promise<void>;
  deleteWorkoutLog: (sessionId: number) => Promise<void>;
  saveBodyWeightLog: (input: { loggedDate: string; weight: string; unitSystem?: UnitSystem }) => Promise<void>;
  updateBodyWeightLog: (input: { id: number; loggedDate: string; weight: string; unitSystem?: UnitSystem }) => Promise<void>;
  deleteBodyWeightLog: (id: number) => Promise<void>;
  importTrainingData: (input: ParsedImportData) => Promise<void>;
  setUnitSystem: (unitSystem: UnitSystem) => Promise<void>;
  saveTrainingSplit: (days: TrainingSplitDay[]) => Promise<void>;
  startActiveWorkout: (activeWorkout: ActiveWorkout) => Promise<void>;
  updateActiveWorkout: (activeWorkout: ActiveWorkout) => Promise<void>;
  finishActiveWorkout: () => Promise<void>;
  setConfigWeight: (id: number, weightFactor: number) => Promise<void>;
};

function derive(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[], bodyWeightLogs: BodyWeightLog[], configs: MuscleStrengthConfig[]) {
  const exercisePoints = buildExerciseScorePoints(exercises, sessions, sets, bodyWeightLogs);
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
  trainingSplit: createDefaultTrainingSplit(),
  activeWorkout: null,
  exercisePoints: [],
  musclePoints: [],
  muscleSummaries: [],
  socialData: { friends: [], invites: [], leaderboard: [], notice: null },
  socialLoading: false,
  socialError: null,
  lastInviteUrl: null,
  hydrate: async () => {
    try {
      const data = await loadAllData();
      const derived = derive(data.exercises, data.sessions, data.sets, data.bodyWeightLogs, data.configs);
      set({ ...data, ...derived, loading: false, authError: null });
      try {
        await syncScoreSnapshots(derived.exercisePoints);
      } catch (error) {
        set({ socialError: error instanceof Error ? error.message : "Could not sync leaderboard scores." });
      }
      await get().loadSocial();
    } catch (error) {
      set({
        currentUser: null,
        exercises: [],
        sessions: [],
        sets: [],
        bodyWeightLogs: [],
        configs: [],
        trainingSplit: createDefaultTrainingSplit(),
        activeWorkout: null,
        exercisePoints: [],
        musclePoints: [],
        muscleSummaries: [],
        socialData: { friends: [], invites: [], leaderboard: [], notice: null },
        loading: false,
        authError: error instanceof Error ? error.message : "Could not load app data."
      });
    }
  },
  loadSocial: async () => {
    set({ socialLoading: true, socialError: null });
    try {
      const socialData = await loadStoredSocialData();
      set({ socialData, socialLoading: false, socialError: null });
    } catch (error) {
      set({
        socialData: { friends: [], invites: [], leaderboard: [], notice: null },
        socialLoading: false,
        socialError: error instanceof Error ? error.message : "Could not load friend leaderboards."
      });
    }
  },
  createFriendInvite: async () => {
    set({ socialLoading: true, socialError: null });
    try {
      const lastInviteUrl = await createStoredFriendInvite();
      set({ lastInviteUrl, socialLoading: false, socialError: null });
      await get().loadSocial();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not create invite." });
    }
  },
  acceptFriendInvite: async (token) => {
    set({ socialLoading: true, socialError: null });
    try {
      await acceptStoredFriendInvite(token);
      set({ socialLoading: false, socialError: null, lastInviteUrl: null });
      await get().loadSocial();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not accept invite." });
    }
  },
  revokeFriendInvite: async (inviteId) => {
    set({ socialLoading: true, socialError: null });
    try {
      await revokeStoredFriendInvite(inviteId);
      set({ socialLoading: false, socialError: null, lastInviteUrl: null });
      await get().loadSocial();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not revoke invite." });
    }
  },
  removeFriend: async (friendId) => {
    set({ socialLoading: true, socialError: null });
    try {
      await removeStoredFriend(friendId);
      set({ socialLoading: false, socialError: null });
      await get().loadSocial();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not remove friend." });
    }
  },
  requestSplitSync: async (friendId, days) => {
    set({ socialLoading: true, socialError: null });
    try {
      await requestStoredSplitSync(friendId, days);
      await get().loadSocial();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not request split synchronization." });
    }
  },
  respondSplitSync: async (requestId, accepted) => {
    set({ socialLoading: true, socialError: null });
    try {
      await respondStoredSplitSync(requestId, accepted);
      await get().hydrate();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not update split synchronization." });
    }
  },
  removeSplitSync: async (friendId) => {
    set({ socialLoading: true, socialError: null });
    try {
      await removeStoredSplitSync(friendId);
      await get().loadSocial();
    } catch (error) {
      set({ socialLoading: false, socialError: error instanceof Error ? error.message : "Could not disconnect split synchronization." });
    }
  },
  login: async (input) => {
    try {
      const currentUser = await loginUser(input);
      set({ currentUser, authError: null, authNotice: null });
      await get().hydrate();
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not log in." });
    }
  },
  register: async (input) => {
    try {
      const currentUser = await registerUser(input);
      set({ currentUser, authError: null, authNotice: null });
      await get().hydrate();
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
    set({ currentUser: null, authError: null, authNotice: null, socialData: { friends: [], invites: [], leaderboard: [], notice: null }, lastInviteUrl: null });
  },
  clearAuthError: () => set({ authError: null, authNotice: null }),
  setExerciseEnabled: async (exerciseId, enabled) => {
    const previous = get();
    const exercises = previous.exercises.map((exercise) => (exercise.id === exerciseId ? { ...exercise, is_strength_exercise: enabled ? 1 : 0 } : exercise));
    const derived = derive(exercises, previous.sessions, previous.sets, previous.bodyWeightLogs, previous.configs);
    set({ exercises, ...derived });

    try {
      await setStoredExerciseEnabled(exerciseId, enabled);
    } catch (error) {
      const rollbackDerived = derive(previous.exercises, previous.sessions, previous.sets, previous.bodyWeightLogs, previous.configs);
      set({
        exercises: previous.exercises,
        ...rollbackDerived,
        authError: error instanceof Error ? error.message : "Could not update exercise selection."
      });
    }
  },
  saveWorkout: async (input) => {
    const unitSystem = get().unitSystem;
    const exercise = get().exercises.find((item) => item.id === input.exerciseId);
    const sets = parseScoredSets(input.sets, unitSystem, getExerciseLoadType(exercise?.name ?? ""));
    const workoutDate = /^\d{4}-\d{2}-\d{2}$/.test(input.workoutDate) ? input.workoutDate : todayIso();

    await logWorkout({ exerciseId: input.exerciseId, workoutDate, notes: input.notes, sets });
    await get().hydrate();
  },
  updateWorkoutLog: async (input) => {
    const unitSystem = get().unitSystem;
    const exercise = get().exercises.find((item) => item.id === input.exerciseId);
    const sets = parseScoredSets(input.sets, unitSystem, getExerciseLoadType(exercise?.name ?? ""));
    const workoutDate = /^\d{4}-\d{2}-\d{2}$/.test(input.workoutDate) ? input.workoutDate : todayIso();

    await updateWorkoutSession({ sessionId: input.sessionId, exerciseId: input.exerciseId, workoutDate, notes: input.notes, sets });
    await get().hydrate();
  },
  deleteWorkoutLog: async (sessionId) => {
    await deleteWorkoutSession(sessionId);
    await get().hydrate();
  },
  saveBodyWeightLog: async (input) => {
    const weight = parseWeightInput(input.weight);
    const loggedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.loggedDate) ? input.loggedDate : todayIso();
    const unitSystem = input.unitSystem ?? bodyWeightDisplayUnit;

    if (!Number.isFinite(weight) || weight <= 0) return;
    await saveStoredBodyWeightLog({ loggedDate, weight: unitSystem === bodyWeightDisplayUnit ? bodyWeightToStorageUnit(weight) : weightToStorageUnit(weight, unitSystem), unit: unitSystem });
    await get().hydrate();
  },
  updateBodyWeightLog: async (input) => {
    const weight = parseWeightInput(input.weight);
    const loggedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.loggedDate) ? input.loggedDate : todayIso();
    const unitSystem = input.unitSystem ?? bodyWeightDisplayUnit;

    if (!Number.isFinite(weight) || weight <= 0) return;
    await updateStoredBodyWeightLog({ id: input.id, loggedDate, weight: unitSystem === bodyWeightDisplayUnit ? bodyWeightToStorageUnit(weight) : weightToStorageUnit(weight, unitSystem), unit: unitSystem });
    await get().hydrate();
  },
  deleteBodyWeightLog: async (id) => {
    await deleteStoredBodyWeightLog(id);
    await get().hydrate();
  },
  importTrainingData: async (input) => {
    await importStoredTrainingData(input);
    await get().hydrate();
  },
  setUnitSystem: async (unitSystem) => {
    await updateUnitSystem(unitSystem);
    set({ unitSystem });
  },
  saveTrainingSplit: async (days) => {
    const trainingSplit = await updateStoredTrainingSplit(days);
    set({ trainingSplit });
  },
  startActiveWorkout: async (activeWorkout) => {
    set({ activeWorkout });
    await saveStoredActiveWorkout(activeWorkout);
  },
  updateActiveWorkout: async (activeWorkout) => {
    set({ activeWorkout });
    await saveStoredActiveWorkout(activeWorkout);
  },
  finishActiveWorkout: async () => {
    set({ activeWorkout: null });
    await saveStoredActiveWorkout(null);
  },
  setConfigWeight: async (id, weightFactor) => {
    await updateConfigWeight(id, weightFactor);
    await get().hydrate();
  }
}));

function parseWeightInput(value: string) {
  return Number(value.trim().replace(",", "."));
}

function parseScoredSets(sets: LoggedSetDraft[], unitSystem: UnitSystem, loadType: ReturnType<typeof getExerciseLoadType>) {
  const enteredSets = sets.filter((set) => set.reps.trim() || set.weight.trim());
  const parsed = enteredSets.map((set) => ({
    reps: Number(set.reps),
    weight: weightToStorageUnit(Number(set.weight), unitSystem)
  }));

  if (parsed.length < 2) {
    throw new Error("Performance Points require at least two loaded sets.");
  }
  if (parsed.some((set) => !Number.isInteger(set.reps) || set.reps < 1)) {
    throw new Error("Performance Points require positive whole-number reps per set.");
  }
  if (parsed.some((set) => !Number.isFinite(set.weight) || (loadType === "external" ? set.weight <= 0 : set.weight < 0))) {
    throw new Error(loadType === "external"
      ? "Performance Points require external weight on every set."
      : "Added weight or assistance cannot be negative.");
  }

  return parsed;
}
