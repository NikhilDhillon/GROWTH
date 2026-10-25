import { create } from "zustand";

import { getExerciseLoadType } from "@/constants/exercises";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { createMachineProfile, MachineProfileDraft, touchMachineProfile, upsertMachineProfile } from "@/constants/machineProfiles";
import { createDefaultTrainingSplit } from "@/constants/trainingSplit";
import { buildExerciseScorePoints, buildMuscleScorePoints } from "@/services/strength/strengthService";
import { assertGuidedObservationsConfirmed } from "@/services/guidedWorkout/guidedObservationService";
import { loadCurrentUser, finalizeActiveWorkout as finalizeStoredActiveWorkout } from "@/database/database";
import { sameStoredJson, WorkoutValidationError } from "@/database/workoutWrite";
import { DraftConflictError, RecoveredWorkoutDraft, WorkoutEntryReference, WorkoutRecord } from "@/domain/workoutLifecycle";
import { prepareWorkoutObservations } from "@/services/workouts/workoutRecording";
import { recordWorkoutEntry } from "@/database/database";
import { createRequestId } from "@/utils/requestId";
import { recordBodyCheckIn as recordStoredBodyCheckIn, deleteBodyCheckIn as deleteStoredBodyCheckIn } from "@/database/database";
import { BodyCheckInCaptureInput, prepareBodyCheckInWrite } from "@/services/body/bodyCheckInRecording";
import { acceptFriendInvite as acceptStoredFriendInvite, createCustomExercise as createStoredCustomExercise, createFriendInvite as createStoredFriendInvite, deleteBodyMeasurementLog as deleteStoredBodyMeasurementLog, deleteBodyWeightLog as deleteStoredBodyWeightLog, deleteWorkoutSession, importTrainingData as importStoredTrainingData, loadAllData, loadSocialData as loadStoredSocialData, loginUser, logoutUser, logWorkout, registerUser, removeFriend as removeStoredFriend, removeSplitSync as removeStoredSplitSync, requestPasswordReset, requestSplitSync as requestStoredSplitSync, respondSplitSync as respondStoredSplitSync, revokeFriendInvite as revokeStoredFriendInvite, saveActiveWorkout as saveStoredActiveWorkout, saveBodyMeasurementLog as saveStoredBodyMeasurementLog, saveBodyWeightLog as saveStoredBodyWeightLog, saveCompletedGuidedWorkouts as saveStoredCompletedGuidedWorkouts, saveMachineProfiles as saveStoredMachineProfiles, saveTemplateExercises as saveStoredTemplateExercises, setExerciseEnabled as setStoredExerciseEnabled, updateBodyMeasurementLog as updateStoredBodyMeasurementLog, updateBodyUnitPreferences as updateStoredBodyUnitPreferences, updateBodyWeightLog as updateStoredBodyWeightLog, updateConfigWeight, updateCurrentUserPassword, updateGuidedWorkoutPreferences as updateStoredGuidedWorkoutPreferences, updateTrainingSplit as updateStoredTrainingSplit, updateUnitSystem, updateWorkoutSession, updateWorkoutSessionMachineProfile } from "@/database/database";
import { ImportResult, ParsedImportData } from "@/services/import/importService";
import { ActiveWorkout, BodyMeasurementLog, BodyMeasurementValues, BodyUnitPreferences, BodyWeightLog, CompletedGuidedWorkout, CustomExerciseInput, Exercise, ExerciseScorePoint, GuidedWorkoutPreferences, LoggedSetDraft, MachineProfile, MuscleScorePoint, MuscleStrengthConfig, SocialData, TemplateExercise, TemplateExercises, TrainingSplit, TrainingSplitDay, UnitSystem, User, WorkoutSession, WorkoutSet } from "@/types";
import { assertCalendarDate } from "@/domain/calendar";
import { parseObservedSets } from "@/domain/observations";
import { bodyMeasurementValuesToStorage, bodyWeightLogsFromMeasurements, bodyWeightToStorage, defaultBodyUnitPreferences, hasBodyMeasurementData, normalizeBodyMeasurementValues } from "@/utils/bodyMeasurements";

type FitnessState = {
  loading: boolean;
  currentUser: User | null;
  authError: string | null;
  authNotice: string | null;
  dataError: string | null;
  dataLoading: boolean;
  operationNotice: string | null;
  unitSystem: UnitSystem;
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  bodyMeasurementLogs: BodyMeasurementLog[];
  bodyWeightLogs: BodyWeightLog[];
  bodyUnitPreferences: BodyUnitPreferences;
  configs: MuscleStrengthConfig[];
  trainingSplit: TrainingSplit;
  activeWorkout: ActiveWorkout | null;
  activeWorkoutFinalizing: boolean;
  activeWorkoutDirty: boolean;
  activeDraftConflict: boolean;
  savedActiveWorkout: ActiveWorkout | null;
  workoutRecords: WorkoutRecord[];
  workoutReferences: WorkoutEntryReference[];
  recoveredWorkoutDrafts: RecoveredWorkoutDraft[];
  reloadSavedWorkoutDraft: () => Promise<void>;
  completedGuidedWorkouts: CompletedGuidedWorkout[];
  /** Preserved migration evidence; recorded facts still come exclusively from sessions and sets. */
  workoutArchiveEvidence: unknown;
  machineProfiles: MachineProfile[];
  /** Exercises each template remembers, keyed by its muscles. */
  templateExercises: TemplateExercises;
  guidedWorkoutPreferences: GuidedWorkoutPreferences;
  exercisePoints: ExerciseScorePoint[];
  musclePoints: MuscleScorePoint[];
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
  updatePassword: (input: { password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  setExerciseEnabled: (exerciseId: number, enabled: boolean) => Promise<void>;
  /** Adds a personal exercise (or returns the one a retry already made) and lists it. */
  createCustomExercise: (input: CustomExerciseInput) => Promise<Exercise>;
  saveWorkout: (input: { origin: "manual" | "guided"; requestId: string; expectedActive?: ActiveWorkout; unitSystem?: UnitSystem; exerciseId: number; workoutDate: string; notes: string; machineProfileId?: string | null; sets: LoggedSetDraft[] }) => Promise<number>;
  updateWorkoutLog: (input: { sessionId: number; exerciseId: number; workoutDate: string; notes: string; unitSystem?: UnitSystem; machineProfileId?: string | null; sets: LoggedSetDraft[] }) => Promise<void>;
  updateWorkoutMachineProfile: (input: { sessionId: number; exerciseId: number; machineProfileId?: string | null }) => Promise<void>;
  deleteWorkoutLog: (sessionId: number) => Promise<void>;
  saveBodyWeightLog: (input: { loggedDate: string; weight: string; unitSystem?: UnitSystem }) => Promise<void>;
  updateBodyWeightLog: (input: { id: number; loggedDate: string; weight: string; unitSystem?: UnitSystem }) => Promise<void>;
  deleteBodyWeightLog: (id: number) => Promise<void>;
  saveBodyMeasurementLog: (input: { loggedDate: string; weight: string; measurements: BodyMeasurementValues; notes?: string }) => Promise<void>;
  updateBodyMeasurementLog: (input: { id: number; loggedDate: string; weight: string; measurements: BodyMeasurementValues; notes?: string }) => Promise<void>;
  deleteBodyMeasurementLog: (id: number) => Promise<void>;
  recordBodyCheckIn: (input: BodyCheckInCaptureInput) => Promise<BodyMeasurementLog>;
  deleteBodyCheckIn: (id: number, expected?: BodyMeasurementLog) => Promise<void>;
  importTrainingData: (input: ParsedImportData & { expectedAccountId?: string | number }) => Promise<ImportResult>;
  setUnitSystem: (unitSystem: UnitSystem) => Promise<void>;
  setBodyUnitPreferences: (preferences: BodyUnitPreferences) => Promise<void>;
  saveTrainingSplit: (days: TrainingSplitDay[]) => Promise<void>;
  startActiveWorkout: (activeWorkout: ActiveWorkout) => Promise<void>;
  updateActiveWorkout: (activeWorkout: ActiveWorkout) => Promise<void>;
  finishActiveWorkout: (summary?: CompletedGuidedWorkout) => Promise<void>;
  saveGuidedWorkoutPreferences: (preferences: GuidedWorkoutPreferences) => Promise<void>;
  saveTemplateExercises: (key: string, exercises: TemplateExercise[]) => Promise<void>;
  saveMachineProfile: (profile: MachineProfileDraft) => Promise<MachineProfile>;
  deleteMachineProfile: (profileId: string) => Promise<void>;
  setConfigWeight: (id: number, weightFactor: number) => Promise<void>;
};

function derive(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[], bodyWeightLogs: BodyWeightLog[], configs: MuscleStrengthConfig[]) {
  const exercisePoints = buildExerciseScorePoints(exercises, sessions, sets, bodyWeightLogs);
  const musclePoints = buildMuscleScorePoints(exercises, configs, exercisePoints);
  return { exercisePoints, musclePoints };
}

let hydrationVersion = 0;
let activeWriteQueue: Promise<void> = Promise.resolve();
const finalizingWorkouts = new Set<string>();

function serializeActiveWrite<T>(action: () => Promise<T>): Promise<T> {
  const next = activeWriteQueue.then(action);
  activeWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

function emptyApplicationData() {
  return {
    exercises: [], sessions: [], sets: [], bodyMeasurementLogs: [], bodyWeightLogs: [], configs: [],
    bodyUnitPreferences: defaultBodyUnitPreferences, trainingSplit: createDefaultTrainingSplit(),
    activeWorkout: null, activeWorkoutFinalizing: false, activeWorkoutDirty: false, activeDraftConflict: false, savedActiveWorkout: null, workoutRecords: [], workoutReferences: [], recoveredWorkoutDrafts: [], completedGuidedWorkouts: [], workoutArchiveEvidence: undefined, machineProfiles: [], templateExercises: {},
    guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences(), exercisePoints: [], musclePoints: [],
    socialData: { friends: [], invites: [], leaderboard: [], notice: null }, socialError: null, socialLoading: false
  };
}

export const useFitnessStore = create<FitnessState>((set, get) => ({
  loading: true,
  currentUser: null,
  authError: null,
  authNotice: null,
  dataError: null,
  dataLoading: false,
  operationNotice: null,
  unitSystem: "lb",
  exercises: [],
  sessions: [],
  sets: [],
  bodyMeasurementLogs: [],
  bodyWeightLogs: [],
  bodyUnitPreferences: defaultBodyUnitPreferences,
  configs: [],
  trainingSplit: createDefaultTrainingSplit(),
  activeWorkout: null,
  activeWorkoutFinalizing: false,
  activeWorkoutDirty: false, activeDraftConflict: false, savedActiveWorkout: null, workoutRecords: [], workoutReferences: [], recoveredWorkoutDrafts: [],
  completedGuidedWorkouts: [],
  workoutArchiveEvidence: undefined,
  machineProfiles: [],
  templateExercises: {},
  guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences(),
  exercisePoints: [],
  musclePoints: [],
  socialData: { friends: [], invites: [], leaderboard: [], notice: null },
  socialLoading: false,
  socialError: null,
  lastInviteUrl: null,
  hydrate: async () => {
    const version = ++hydrationVersion;
    set({ dataLoading: true, dataError: null });
    try {
      // Session identity is loaded independently of application-data queries.
      const currentUser = await loadCurrentUser();
      if (version !== hydrationVersion) return;
      if (currentUser?.id !== get().currentUser?.id) set(emptyApplicationData());
      set({ currentUser });
      if (!currentUser) { set({ loading: false, dataLoading: false }); return; }
      const data = await loadAllData();
      if (version !== hydrationVersion) return;
      if (data.currentUser?.id !== currentUser.id) throw new Error("Your session changed while loading data. Retry the refresh.");
      const bodyWeightLogs = bodyWeightLogsFromMeasurements(data.bodyMeasurementLogs, data.bodyUnitPreferences.weight);
      const derived = derive(data.exercises, data.sessions, data.sets, bodyWeightLogs, data.configs);
      const preserveDraft = get().activeWorkoutDirty || get().activeWorkoutFinalizing;
      const { activeWorkoutSnapshot, ...applicationData } = data;
      set({ ...applicationData, templateExercises: applicationData.templateExercises ?? {},
        savedActiveWorkout: preserveDraft ? get().savedActiveWorkout : activeWorkoutSnapshot ?? data.activeWorkout,
        ...(preserveDraft ? { activeWorkout: get().activeWorkout } : {}),
        bodyWeightLogs, ...derived, loading: false, dataLoading: false, dataError: null, authError: null });
      // Friend rankings derive from authorized canonical observations. Hydration
      // no longer republishes a second copy of derived performance facts.
      if (version !== hydrationVersion) return;
      await get().loadSocial();
    } catch (error) {
      if (version !== hydrationVersion) return;
      // Preserve the authenticated identity, previous valid observations and unsaved draft.
      set({ loading: false, dataLoading: false, dataError: error instanceof Error ? error.message : "Could not load app data." });
    }
  },
  loadSocial: async () => {
    const version = hydrationVersion;
    const userId = get().currentUser?.id;
    set({ socialLoading: true, socialError: null });
    try {
      const socialData = await loadStoredSocialData();
      if (version !== hydrationVersion || userId !== get().currentUser?.id) return;
      set({ socialData, socialLoading: false, socialError: null });
    } catch (error) {
      if (version !== hydrationVersion || userId !== get().currentUser?.id) return;
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
      hydrationVersion += 1;
      set({ ...emptyApplicationData(), currentUser, authError: null, authNotice: null, operationNotice: null });
      await get().hydrate();
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not log in." });
    }
  },
  register: async (input) => {
    try {
      const currentUser = await registerUser(input);
      hydrationVersion += 1;
      set({ ...emptyApplicationData(), currentUser, authError: null, authNotice: null, operationNotice: null });
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
      return true;
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : "Could not update password.", authNotice: null });
      return false;
    }
  },
  logout: async () => {
    await logoutUser();
    hydrationVersion += 1;
    set({ ...emptyApplicationData(), currentUser: null, authError: null, authNotice: null, dataError: null, dataLoading: false, operationNotice: null, lastInviteUrl: null });
  },
  clearAuthError: () => set({ authError: null, authNotice: null }),
  createCustomExercise: async (input) => {
    const created = await createStoredCustomExercise(input);
    const current = get();
    if (current.exercises.some((exercise) => exercise.id === created.id)) return created;
    const exercises = [...current.exercises, created].sort((a, b) => a.name.localeCompare(b.name));
    set({ exercises, ...derive(exercises, current.sessions, current.sets, current.bodyWeightLogs, current.configs) });
    return created;
  },
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
    const unitSystem = input.unitSystem ?? get().unitSystem;
    const exercise = get().exercises.find((item) => item.id === input.exerciseId);
    const observations = prepareWorkoutObservations(input, exercise, unitSystem);
    if (input.origin === "guided" && !input.expectedActive) throw new WorkoutValidationError("A guided recording requires its saved draft.");
    const userId = get().currentUser?.id;
    set({ operationNotice: null });
    const record = async () => {
      if (get().currentUser?.id !== userId) throw new Error("Your account changed. Keep the draft and retry from the correct account.");
      const expectedActive = input.expectedActive;
      if (expectedActive && (!sameStoredJson(get().activeWorkout, expectedActive) || get().activeDraftConflict)) throw new Error("The workout draft changed. Review it before recording.");
      try {
        const result = await recordWorkoutEntry({ ...observations, requestId: input.requestId,
          workoutId: expectedActive?.workoutId ?? input.requestId, expectedActive, completedAt: new Date().toISOString() });
        const committedActive = result.activeWorkout;
        if (get().currentUser?.id === userId && expectedActive && committedActive && committedActive.workoutId === expectedActive.workoutId) {
          const latest = get().activeWorkout;
          const unchanged = sameStoredJson(latest, expectedActive);
          if (unchanged) set({ activeWorkout: committedActive, savedActiveWorkout: committedActive, activeWorkoutDirty: false });
          else if (latest && latest.workoutId === expectedActive.workoutId) set({
            savedActiveWorkout: committedActive, activeWorkoutDirty: true,
            activeWorkout: { ...latest, revision: committedActive.revision,
              completedExercises: [...latest.completedExercises.filter((item) => !committedActive.completedExercises.some((entry) => entry.sessionId === item.sessionId)), ...committedActive.completedExercises] }
          });
        }
        return result.sessionId;
      } catch (error) {
        if (error instanceof DraftConflictError && get().currentUser?.id === userId) set({
          activeDraftConflict: true, activeWorkoutDirty: true, savedActiveWorkout: error.current,
          recoveredWorkoutDrafts: [...get().recoveredWorkoutDrafts, { id: createRequestId(), savedAt: new Date().toISOString(), draft: error.draft }],
          operationNotice: error.message
        });
        throw error;
      }
    };
    const sessionId = input.origin === "guided" ? await serializeActiveWrite(record) : await record();
    if (get().currentUser?.id === userId) {
      try { await touchStoredMachineProfile(input.machineProfileId, input.exerciseId); }
      catch { set({ operationNotice: "Workout saved. The machine's recent-use metadata could not be updated." }); }
      await get().hydrate();
    }
    return sessionId;
  },
  updateWorkoutLog: async (input) => {
    const unitSystem = input.unitSystem ?? get().unitSystem;
    const exercise = get().exercises.find((item) => item.id === input.exerciseId);
    const { sets, workoutDate } = prepareWorkoutObservations(input, exercise, unitSystem);

    await updateWorkoutSession({ sessionId: input.sessionId, exerciseId: input.exerciseId, workoutDate, notes: input.notes, machineProfileId: input.machineProfileId ?? null, inputUnit: unitSystem, sets });
    try { await touchStoredMachineProfile(input.machineProfileId, input.exerciseId); }
    catch { set({ operationNotice: "Changes saved. The machine's recent-use metadata could not be updated." }); }
    await get().hydrate();
  },
  updateWorkoutMachineProfile: async (input) => {
    await updateWorkoutSessionMachineProfile({ sessionId: input.sessionId, machineProfileId: input.machineProfileId ?? null });
    try { await touchStoredMachineProfile(input.machineProfileId, input.exerciseId); }
    catch { set({ operationNotice: "Changes saved. The machine's recent-use metadata could not be updated." }); }
    await get().hydrate();
  },
  deleteWorkoutLog: async (sessionId) => {
    await deleteWorkoutSession(sessionId);
    const sessions = get().sessions.filter((session) => session.id !== sessionId);
    const sets = get().sets.filter((item) => item.session_id !== sessionId);
    set({ sessions, sets, ...derive(get().exercises, sessions, sets, get().bodyWeightLogs, get().configs) });
    await get().hydrate();
  },
  recordBodyCheckIn: async (input) => {
    const userId = get().currentUser?.id;
    if (userId == null) throw new Error("Sign in before recording a check-in.");
    const prepared = prepareBodyCheckInWrite(input);
    const row = await recordStoredBodyCheckIn({ ...prepared, accountId: userId });
    if (get().currentUser?.id === userId) {
      const bodyMeasurementLogs = [row, ...get().bodyMeasurementLogs.filter((log) => log.id !== row.id)]
        .sort((left, right) => right.logged_date.localeCompare(left.logged_date) || right.id - left.id);
      const bodyWeightLogs = bodyWeightLogsFromMeasurements(bodyMeasurementLogs, get().bodyUnitPreferences.weight);
      set({ bodyMeasurementLogs, bodyWeightLogs, ...derive(get().exercises, get().sessions, get().sets, bodyWeightLogs, get().configs) });
      // Refresh is a separate state: a failed read cannot make this committed
      // observation appear to have failed, or discard its retry receipt.
      await get().hydrate();
    }
    return row;
  },
  deleteBodyCheckIn: async (id, expected) => {
    const userId = get().currentUser?.id;
    if (userId == null) throw new Error("Sign in before deleting a check-in.");
    await deleteStoredBodyCheckIn(id, expected, userId);
    if (get().currentUser?.id === userId) {
      const bodyMeasurementLogs = get().bodyMeasurementLogs.filter((log) => log.id !== id);
      const bodyWeightLogs = bodyWeightLogsFromMeasurements(bodyMeasurementLogs, get().bodyUnitPreferences.weight);
      set({ bodyMeasurementLogs, bodyWeightLogs, ...derive(get().exercises, get().sessions, get().sets, bodyWeightLogs, get().configs) });
      await get().hydrate();
    }
  },
  saveBodyWeightLog: async (input) => {
    const weight = parseWeightInput(input.weight);
    const loggedDate = assertCalendarDate(input.loggedDate);
    const unitSystem = input.unitSystem ?? get().bodyUnitPreferences.weight;

    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error("Bodyweight must be a number greater than zero.");
    }
    await saveStoredBodyWeightLog({ loggedDate, weight: bodyWeightToStorage(weight, unitSystem), unit: unitSystem });
    await get().hydrate();
  },
  updateBodyWeightLog: async (input) => {
    const weight = parseWeightInput(input.weight);
    const loggedDate = assertCalendarDate(input.loggedDate);
    const unitSystem = input.unitSystem ?? get().bodyUnitPreferences.weight;

    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error("Bodyweight must be a number greater than zero.");
    }
    const storedWeight = bodyWeightToStorage(weight, unitSystem);
    const conflictingLog = get().bodyMeasurementLogs.find(
      (log) => log.id !== input.id && log.logged_date === loggedDate
    );
    if (conflictingLog) {
      throw new Error("A body check-in already exists for this date. Edit that check-in or choose another date; both records have been preserved.");
    }
    await updateStoredBodyWeightLog({ id: input.id, loggedDate, weight: storedWeight, unit: unitSystem });
    await get().hydrate();
  },
  deleteBodyWeightLog: async (id) => {
    await deleteStoredBodyWeightLog(id);
    removeBodyObservationFromCache(id, "weight");
    await get().hydrate();
  },
  saveBodyMeasurementLog: async (input) => {
    const bodyUnitPreferences = get().bodyUnitPreferences;
    const parsedWeight = input.weight.trim() ? parseWeightInput(input.weight) : null;
    if (input.weight.trim() && (!Number.isFinite(parsedWeight) || Number(parsedWeight) <= 0)) {
      throw new Error("Body weight must be a number greater than zero.");
    }
    const measurements = normalizeBodyMeasurementValues(input.measurements);
    const storedMeasurements = bodyMeasurementValuesToStorage(measurements, bodyUnitPreferences.circumference);
    const storedWeight = parsedWeight === null ? null : bodyWeightToStorage(parsedWeight, bodyUnitPreferences.weight);
    const loggedDate = assertCalendarDate(input.loggedDate);
    const existing = get().bodyMeasurementLogs.find((log) => log.logged_date === loggedDate);
    const mergedWeight = storedWeight ?? existing?.weight ?? null;
    const mergedMeasurements = { ...(existing?.measurements ?? {}), ...storedMeasurements };
    if (!hasBodyMeasurementData(mergedWeight, mergedMeasurements)) {
      throw new Error("Enter at least one body measurement.");
    }
    if (existing) {
      await updateStoredBodyMeasurementLog({
        id: existing.id,
        loggedDate,
        weight: mergedWeight,
        measurements: mergedMeasurements,
        notes: input.notes?.trim() ? input.notes : existing.notes
      });
    } else {
      await saveStoredBodyMeasurementLog({ loggedDate, weight: mergedWeight, measurements: mergedMeasurements, notes: input.notes });
    }
    await get().hydrate();
  },
  updateBodyMeasurementLog: async (input) => {
    const bodyUnitPreferences = get().bodyUnitPreferences;
    const existing = get().bodyMeasurementLogs.find((log) => log.id === input.id);
    const parsedWeight = input.weight.trim() ? parseWeightInput(input.weight) : null;
    if (input.weight.trim() && (!Number.isFinite(parsedWeight) || Number(parsedWeight) <= 0)) {
      throw new Error("Body weight must be a number greater than zero.");
    }
    const measurements = normalizeBodyMeasurementValues(input.measurements);
    const storedMeasurements = bodyMeasurementValuesToStorage(measurements, bodyUnitPreferences.circumference);
    const storedWeight = parsedWeight === null ? existing?.weight ?? null : bodyWeightToStorage(parsedWeight, bodyUnitPreferences.weight);
    const loggedDate = assertCalendarDate(input.loggedDate);
    if (!hasBodyMeasurementData(storedWeight, storedMeasurements)) {
      throw new Error("Enter at least one body measurement.");
    }
    const conflictingLog = get().bodyMeasurementLogs.find(
      (log) => log.id !== input.id && log.logged_date === loggedDate
    );
    if (conflictingLog) {
      throw new Error("A body check-in already exists for this date. Edit that check-in or choose another date; both records have been preserved.");
    }
    await updateStoredBodyMeasurementLog({ id: input.id, loggedDate, weight: storedWeight, measurements: storedMeasurements, notes: input.notes });
    await get().hydrate();
  },
  deleteBodyMeasurementLog: async (id) => {
    await deleteStoredBodyMeasurementLog(id);
    removeBodyObservationFromCache(id, "measurements");
    await get().hydrate();
  },
  importTrainingData: async (input) => {
    const accountId = get().currentUser?.id;
    if (accountId == null) throw new Error("Please log in again.");
    if (input.expectedAccountId != null && input.expectedAccountId !== accountId) throw new Error("Your account changed. Create a new import preview before continuing.");
    const result = await importStoredTrainingData({ ...input, expectedAccountId: accountId });
    if (get().currentUser?.id === accountId) await get().hydrate();
    return result;
  },
  setUnitSystem: async (unitSystem) => {
    await updateUnitSystem(unitSystem);
    set({ unitSystem });
  },
  setBodyUnitPreferences: async (preferences) => {
    const bodyUnitPreferences = await updateStoredBodyUnitPreferences(preferences);
    set({ bodyUnitPreferences });
  },
  saveTrainingSplit: async (days) => {
    const trainingSplit = await updateStoredTrainingSplit(days);
    set({ trainingSplit });
  },
  reloadSavedWorkoutDraft: async () => {
    const data = await loadAllData();
    if (data.currentUser?.id !== get().currentUser?.id) throw new Error("Your account changed. Reload GROWTH before reviewing drafts.");
    set({ activeWorkout: data.activeWorkout, savedActiveWorkout: data.activeWorkoutSnapshot ?? data.activeWorkout,
      recoveredWorkoutDrafts: data.recoveredWorkoutDrafts, activeWorkoutDirty: false, activeDraftConflict: false, operationNotice: null });
  },
  startActiveWorkout: async (activeWorkout) => {
    const userId = get().currentUser?.id;
    await serializeActiveWrite(async () => {
      if (get().currentUser?.id !== userId) throw new Error("Your account changed. Start the workout again.");
      const saved = await saveStoredActiveWorkout(activeWorkout);
      if (get().currentUser?.id === userId) set({ activeWorkout: saved, savedActiveWorkout: saved, activeWorkoutDirty: false, activeDraftConflict: false });
    });
  },
  updateActiveWorkout: async (activeWorkout) => {
    const userId = get().currentUser?.id;
    if (get().activeDraftConflict) throw new Error("Review the saved draft and your recovered version before continuing.");
    if (finalizingWorkouts.has(JSON.stringify([userId, activeWorkout.startedAt]))) throw new Error("This workout is finishing. Wait for completion before editing.");
    if (get().activeWorkout?.startedAt !== activeWorkout.startedAt) throw new Error("This workout is no longer active. Reload before editing.");
    set({ activeWorkout, activeWorkoutDirty: true });
    await serializeActiveWrite(async () => {
      if (get().currentUser?.id !== userId) throw new Error("Your account changed. Resume your workout from the current account.");
      if (get().activeDraftConflict) throw new Error("Resolve the workout draft conflict before saving more changes.");
      if (get().activeWorkout?.startedAt !== activeWorkout.startedAt) throw new Error("This workout is no longer active. Reload before editing.");
      const candidate = { ...activeWorkout, revision: get().savedActiveWorkout?.revision ?? activeWorkout.revision };
      try {
        const saved = await saveStoredActiveWorkout(candidate);
        if (get().currentUser?.id !== userId) return;
        const latest = get().activeWorkout;
        const sameContent = latest && sameStoredJson({ ...latest, revision: 0 }, { ...activeWorkout, revision: 0 });
        set({ savedActiveWorkout: saved,
          activeWorkout: sameContent ? saved : latest ? { ...latest, revision: saved.revision } : null,
          activeWorkoutDirty: !sameContent });
      } catch (error) {
        if (get().currentUser?.id !== userId) throw error;
        if (error instanceof DraftConflictError) set({ activeDraftConflict: true, savedActiveWorkout: error.current,
          recoveredWorkoutDrafts: [...get().recoveredWorkoutDrafts, { id: createRequestId(), savedAt: new Date().toISOString(), draft: error.draft }] });
        set({ operationNotice: error instanceof DraftConflictError ? error.message : "Workout draft could not be saved. Keep this page open and retry before leaving." });
        throw error;
      }
    });
  },
  finishActiveWorkout: async (summary) => {
    if (get().activeWorkoutDirty || get().activeDraftConflict) throw new Error("Save or reconcile the workout draft before finishing.");
    const workoutId = summary?.startedAt ?? get().activeWorkout?.startedAt;
    if (!workoutId) return;
    const expectedActive = get().activeWorkout;
    if (!expectedActive && summary && get().completedGuidedWorkouts.some((workout) => workout.startedAt === workoutId)) return;
    if (!expectedActive || expectedActive.startedAt !== workoutId) throw new Error("This workout is no longer active. Reload before finishing.");
    const userId = get().currentUser?.id;
    const finishingKey = JSON.stringify([userId, workoutId]);
    if (finalizingWorkouts.has(finishingKey)) throw new Error("This workout is already finishing. Wait for completion.");
    finalizingWorkouts.add(finishingKey);
    set({ activeWorkoutFinalizing: true });
    try {
      await serializeActiveWrite(async () => {
        if (get().currentUser?.id !== userId) throw new Error("Your account changed. Resume your workout from the current account.");
        if (get().activeWorkout !== expectedActive) {
          if (!get().activeWorkout && summary && get().completedGuidedWorkouts.some((workout) => workout.startedAt === workoutId)) return;
          throw new Error("The workout draft changed. Review it before finishing.");
        }
        const completedGuidedWorkouts = summary
          ? [summary, ...get().completedGuidedWorkouts.filter((workout) => workout.startedAt !== workoutId)]
          : get().completedGuidedWorkouts;
        // Use the exact persisted snapshot for CAS. UI normalization may add
        // defaults to a legacy draft; those defaults are not stored evidence.
        await finalizeStoredActiveWorkout(workoutId, summary ? completedGuidedWorkouts : null, get().savedActiveWorkout ?? expectedActive);
        if (get().currentUser?.id === userId && get().activeWorkout === expectedActive) {
          const evidence = get().workoutArchiveEvidence;
          set({ activeWorkout: null, savedActiveWorkout: null, activeWorkoutDirty: false, completedGuidedWorkouts,
            workoutArchiveEvidence: summary && Array.isArray(evidence)
              ? [summary, ...evidence.filter((record) => !record || record.startedAt !== workoutId)] : evidence });
        }
      });
      if (get().currentUser?.id === userId) await get().hydrate();
    } finally {
      finalizingWorkouts.delete(finishingKey);
      if (get().currentUser?.id === userId) set({ activeWorkoutFinalizing: false });
    }
  },
  saveGuidedWorkoutPreferences: async (preferences) => {
    const guidedWorkoutPreferences = await updateStoredGuidedWorkoutPreferences(preferences);
    set({ guidedWorkoutPreferences });
  },
  saveTemplateExercises: async (key, exercises) => {
    const previous = get().templateExercises;
    const next = { ...previous };
    if (exercises.length) next[key] = exercises;
    else delete next[key];
    set({ templateExercises: next });
    try {
      set({ templateExercises: await saveStoredTemplateExercises(next) });
    } catch (error) {
      if (get().templateExercises === next) set({ templateExercises: previous });
      throw error;
    }
  },
  saveMachineProfile: async (input) => {
    const previous = get().machineProfiles;
    const existing = input.id ? previous.find((profile) => profile.id === input.id) : undefined;
    const profile = createMachineProfile(input, existing);
    const machineProfiles = upsertMachineProfile(previous, profile);
    set({ machineProfiles });
    try {
      const saved = await saveStoredMachineProfiles(machineProfiles);
      set({ machineProfiles: saved });
      return saved.find((item) => item.id === profile.id) ?? profile;
    } catch (error) {
      set({ machineProfiles: previous, authError: error instanceof Error ? error.message : "Could not save machine profile." });
      throw error;
    }
  },
  deleteMachineProfile: async (profileId) => {
    const previous = get().machineProfiles;
    const machineProfiles = previous.filter((profile) => profile.id !== profileId);
    set({ machineProfiles });
    try {
      const saved = await saveStoredMachineProfiles(machineProfiles);
      set({ machineProfiles: saved });
    } catch (error) {
      set({ machineProfiles: previous, authError: error instanceof Error ? error.message : "Could not delete machine tag." });
      throw error;
    }
  },
  setConfigWeight: async (id, weightFactor) => {
    await updateConfigWeight(id, weightFactor);
    await get().hydrate();
  }
}));

function removeBodyObservationFromCache(id: number, kind: "weight" | "measurements") {
  const state = useFitnessStore.getState();
  const bodyMeasurementLogs = state.bodyMeasurementLogs.flatMap((log) => {
    if (log.id !== id) return [log];
    if (kind === "weight") return Object.keys(log.measurements).length ? [{ ...log, weight: null }] : [];
    return log.weight !== null && log.weight > 0 ? [{ ...log, measurements: {}, notes: null }] : [];
  });
  const bodyWeightLogs = bodyWeightLogsFromMeasurements(bodyMeasurementLogs, state.bodyUnitPreferences.weight);
  useFitnessStore.setState({ bodyMeasurementLogs, bodyWeightLogs, ...derive(state.exercises, state.sessions, state.sets, bodyWeightLogs, state.configs) });
}

function parseWeightInput(value: string) {
  return Number(value.trim().replace(",", "."));
}

async function touchStoredMachineProfile(machineProfileId: string | null | undefined, exerciseId: number) {
  if (!machineProfileId) return;
  const current = useFitnessStore.getState().machineProfiles;
  if (!current.some((profile) => profile.id === machineProfileId)) return;
  const machineProfiles = touchMachineProfile(current, machineProfileId, exerciseId);
  useFitnessStore.setState({ machineProfiles });
  await saveStoredMachineProfiles(machineProfiles);
}
