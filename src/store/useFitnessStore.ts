import { create } from "zustand";

import { buildExerciseScorePoints, buildMuscleScorePoints, summarizeMuscles } from "@/services/strength/strengthService";
import { acceptFriendInvite as acceptStoredFriendInvite, createFriendInvite as createStoredFriendInvite, deleteBodyWeightLog as deleteStoredBodyWeightLog, deleteWorkoutSession, loadAllData, loadSocialData as loadStoredSocialData, loginUser, logoutUser, logWorkout, registerUser, removeFriend as removeStoredFriend, requestPasswordReset, revokeFriendInvite as revokeStoredFriendInvite, saveBodyWeightLog as saveStoredBodyWeightLog, setExerciseEnabled as setStoredExerciseEnabled, syncScoreSnapshots, updateBodyWeightLog as updateStoredBodyWeightLog, updateConfigWeight, updateCurrentUserPassword, updateUnitSystem } from "@/database/database";
import { BodyWeightLog, Exercise, ExerciseScorePoint, LoggedSetDraft, MuscleScorePoint, MuscleStrengthConfig, MuscleSummary, SocialData, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
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
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  resetPassword: (input: { email: string }) => Promise<void>;
  updatePassword: (input: { password: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  setExerciseEnabled: (exerciseId: number, enabled: boolean) => Promise<void>;
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
  socialData: { friends: [], invites: [], leaderboard: [], notice: null },
  socialLoading: false,
  socialError: null,
  lastInviteUrl: null,
  hydrate: async () => {
    try {
      const data = await loadAllData();
      const derived = derive(data.exercises, data.sessions, data.sets, data.configs);
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
    await setStoredExerciseEnabled(exerciseId, enabled);
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
