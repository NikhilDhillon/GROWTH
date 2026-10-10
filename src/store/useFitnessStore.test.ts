import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const names = [
    "loadCurrentUser", "loadAllData", "loadSocialData", "syncScoreSnapshots", "finalizeActiveWorkout",
    "loginUser", "registerUser", "logoutUser", "requestPasswordReset", "updateCurrentUserPassword",
    "logWorkout", "recordWorkoutEntry", "updateWorkoutSession", "updateWorkoutSessionMachineProfile", "deleteWorkoutSession",
    "saveActiveWorkout", "saveCompletedGuidedWorkouts", "saveMachineProfiles", "setExerciseEnabled",
    "recordBodyCheckIn", "deleteBodyCheckIn", "saveBodyWeightLog", "updateBodyWeightLog", "deleteBodyWeightLog", "saveBodyMeasurementLog",
    "updateBodyMeasurementLog", "deleteBodyMeasurementLog", "updateBodyUnitPreferences", "importTrainingData",
    "updateGuidedWorkoutPreferences", "updateTrainingSplit", "updateUnitSystem", "updateConfigWeight",
    "acceptFriendInvite", "createFriendInvite", "removeFriend", "removeSplitSync", "requestSplitSync",
    "respondSplitSync", "revokeFriendInvite"
  ];
  return Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/database/database", () => database);

import { createActiveWorkout } from "@/constants/activeWorkout";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { createDefaultTrainingSplit } from "@/constants/trainingSplit";
import { WorkoutValidationError } from "@/database/workoutWrite";
import { DraftConflictError, WorkoutRecordingInput, WorkoutRecordingResult } from "@/domain/workoutLifecycle";
import type { Prescription } from "@/domain/types";
import { confirmGuidedObservation } from "@/services/guidedWorkout/guidedObservationService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { ActiveWorkout, BodyMeasurementLog, CompletedGuidedWorkout, Exercise, LoggedSetDraft, MachineProfile, SocialData, User, WorkoutSession, WorkoutSet } from "@/types";
import { bodyWeightLogsFromMeasurements } from "@/utils/bodyMeasurements";

const date = "2026-07-01";
const timestamp = `${date}T12:00:00.000Z`;
const user: User = { id: "user-a", name: "Lifter", email: "lifter@example.test", password_hash: "", created_at: timestamp };
const exercise: Exercise = { id: 1, name: "Bench Press", primary_muscle: "Chest", is_strength_exercise: 1, created_at: timestamp };
const session: WorkoutSession = { id: 10, workout_date: date, notes: "Observed work", created_at: timestamp };
const observedSets: WorkoutSet[] = [1, 2].map((number) => ({
  id: number, session_id: session.id, exercise_id: exercise.id, set_number: number,
  reps: 8, weight: 100, is_warmup: 0, created_at: timestamp
}));
const bodyLog: BodyMeasurementLog = {
  id: 20, weight: 175, measurements: { waist: 80 }, notes: "Observed check-in",
  logged_date: date, logged_at: timestamp, created_at: timestamp, updated_at: timestamp
};
const machine: MachineProfile = {
  id: "machine-a", label: "Gym A", machineType: "selectorized", stackUnit: "lb",
  increment: 5, minLoad: 0, maxLoad: 300, pulleyRatio: "unknown", exerciseIds: [1],
  createdAt: timestamp, updatedAt: timestamp
};

function activeWorkout() {
  return { ...createActiveWorkout({ key: "mon", label: "Monday", muscles: ["Chest"] }), workoutId: "workout-a", revision: 1, startedAt: timestamp, workoutDate: date };
}
function summary(): CompletedGuidedWorkout {
  return { ...activeWorkout(), id: "workout-a", finishedAt: `${date}T13:00:00.000Z` };
}
function applicationData(currentUser: User | null = user) {
  return {
    currentUser, exercises: [exercise], sessions: [session], sets: observedSets,
    bodyMeasurementLogs: [bodyLog], bodyUnitPreferences: { weight: "lb" as const, circumference: "cm" as const },
    configs: [], unitSystem: "lb" as const, trainingSplit: createDefaultTrainingSplit(),
    activeWorkout: activeWorkout(), completedGuidedWorkouts: [], machineProfiles: [machine],
    workoutRecords: [], workoutReferences: [], recoveredWorkoutDrafts: [],
    guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences()
  };
}
function seedExistingObservations() {
  const data = applicationData();
  useFitnessStore.setState({
    ...data, savedActiveWorkout: data.activeWorkout, loading: false, bodyWeightLogs: bodyWeightLogsFromMeasurements(data.bodyMeasurementLogs, "lb")
  });
  return data;
}
type SaveWorkoutInput = Parameters<ReturnType<typeof useFitnessStore.getState>["saveWorkout"]>[0];
function workoutInput(origin: "manual" | "guided" = "guided"): SaveWorkoutInput {
  const sets: LoggedSetDraft[] = [{ reps: "8", weight: "100" }, { reps: "8", weight: "100" }];
  return { origin, requestId: "recording-a", exerciseId: 1, workoutDate: date, notes: "", machineProfileId: null, sets };
}
function confirmedInput() {
  const input = workoutInput();
  const sets = input.sets.map((set) => confirmGuidedObservation(set, { ...input, unitSystem: "lb" }));
  return bindGuidedDraft({ ...input, sets });
}
function bindGuidedDraft(input: SaveWorkoutInput): SaveWorkoutInput {
  const existing = useFitnessStore.getState().activeWorkout ?? activeWorkout();
  const expectedActive: ActiveWorkout = { ...existing, workoutDate: input.workoutDate, currentExercise: {
    ...existing.currentExercise, requestId: input.requestId, requestUnit: input.unitSystem ?? "lb", muscle: "Chest",
    exerciseId: input.exerciseId, machineProfileId: input.machineProfileId, notes: input.notes, sets: input.sets
  } };
  useFitnessStore.setState({ activeWorkout: expectedActive, savedActiveWorkout: expectedActive, activeWorkoutDirty: false });
  return { ...input, expectedActive };
}
function recordedResult(input: WorkoutRecordingInput): WorkoutRecordingResult {
  const expected = input.expectedActive;
  return { sessionId: 42, activeWorkout: expected ? { ...expected, revision: (expected.revision ?? 0) + 1,
    completedExercises: [...expected.completedExercises, { exerciseId: input.exerciseId, sessionId: 42, exerciseName: "", muscle: "Chest", sets: [], completedAt: timestamp }],
    currentExercise: activeWorkout().currentExercise
  } : null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

beforeEach(() => {
  useFitnessStore.setState(useFitnessStore.getInitialState(), true);
  for (const mock of Object.values(database)) mock.mockReset();
  database.loadCurrentUser.mockResolvedValue(user);
  database.loadAllData.mockResolvedValue(applicationData());
  database.loadSocialData.mockResolvedValue({ friends: [], invites: [], leaderboard: [], notice: null });
  database.syncScoreSnapshots.mockResolvedValue(undefined);
  database.recordWorkoutEntry.mockImplementation(async (input: WorkoutRecordingInput) => recordedResult(input));
  database.saveActiveWorkout.mockImplementation(async (draft: ActiveWorkout) => ({ ...draft, revision: (draft.revision ?? 0) + 1 }));
  database.finalizeActiveWorkout.mockResolvedValue(undefined);
  database.logoutUser.mockResolvedValue(undefined);
});

describe("whole body recording uses one observation authority", () => {
  function capture() {
    return { requestId: "53000000-0000-0000-0000-000000000001", loggedDate: "2026-10-09", weight: "80", measurements: {}, notes: "Daily weigh-in", inputUnits: { weight: "kg" as const, circumference: "cm" as const } };
  }
  it("binds input units and account, then preserves an acknowledged save when refresh fails", async () => {
    seedExistingObservations();
    const saved = { ...bodyLog, id: 21, logged_date: "2026-10-09", weight: 176.369809744, measurements: {}, weight_input_unit: "kg" as const };
    database.recordBodyCheckIn.mockResolvedValue(saved);
    database.loadAllData.mockRejectedValue(new Error("Refresh offline"));
    await expect(useFitnessStore.getState().recordBodyCheckIn(capture())).resolves.toEqual(saved);
    expect(database.recordBodyCheckIn).toHaveBeenCalledWith(expect.objectContaining({ accountId: user.id, weight: 80 * 2.2046226218, inputUnits: { weight: "kg", circumference: "cm" }, measurements: {} }));
    expect(database.saveBodyWeightLog).not.toHaveBeenCalled();
    expect(database.saveBodyMeasurementLog).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([saved, bodyLog]);
    expect(useFitnessStore.getState().bodyWeightLogs.map((row) => row.id)).toEqual([21, 20]);
    expect(useFitnessStore.getState().currentUser).toEqual(user);
    expect(useFitnessStore.getState().dataError).toBe("Refresh offline");
  });

  it("keeps all previous facts when recording or whole deletion is rejected", async () => {
    seedExistingObservations();
    database.recordBodyCheckIn.mockRejectedValue(new Error("Date occupied"));
    database.deleteBodyCheckIn.mockRejectedValue(new Error("Snapshot changed"));
    await expect(useFitnessStore.getState().recordBodyCheckIn(capture())).rejects.toThrow("Date occupied");
    await expect(useFitnessStore.getState().deleteBodyCheckIn(bodyLog.id, bodyLog)).rejects.toThrow("Snapshot changed");
    expect(database.deleteBodyCheckIn).toHaveBeenCalledWith(bodyLog.id, bodyLog, user.id);
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([bodyLog]);
    expect(useFitnessStore.getState().bodyWeightLogs).toHaveLength(1);
    expect(database.loadAllData).not.toHaveBeenCalled();
  });

  it("whole deletion removes both projections after acknowledgement even if refresh fails", async () => {
    seedExistingObservations(); database.deleteBodyCheckIn.mockResolvedValue(undefined);
    database.loadAllData.mockRejectedValue(new Error("Offline"));
    await expect(useFitnessStore.getState().deleteBodyCheckIn(bodyLog.id, bodyLog)).resolves.toBeUndefined();
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([]);
    expect(useFitnessStore.getState().bodyWeightLogs).toEqual([]);
    expect(useFitnessStore.getState().currentUser).toEqual(user);
  });

  it("late recording acknowledgements cannot replace another account's cache", async () => {
    seedExistingObservations(); const operation = deferred<BodyMeasurementLog>();
    database.recordBodyCheckIn.mockReturnValue(operation.promise);
    const pending = useFitnessStore.getState().recordBodyCheckIn(capture());
    const other = { ...user, id: "user-b" };
    useFitnessStore.setState({ currentUser: other, bodyMeasurementLogs: [], bodyWeightLogs: [] });
    operation.resolve(bodyLog); await pending;
    expect(useFitnessStore.getState().currentUser).toEqual(other);
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([]);
    expect(database.loadAllData).not.toHaveBeenCalled();
  });
});

describe("authentication remains separate from application loading", () => {
  it("keeps an initially valid session accessible when the data query fails", async () => {
    database.loadAllData.mockRejectedValue(new Error("Data unavailable."));
    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().currentUser).toEqual(user);
    expect(useFitnessStore.getState().authError).toBeNull();
    expect(useFitnessStore.getState().dataError).toBe("Data unavailable.");
    expect(useFitnessStore.getState().loading).toBe(false);
    expect(useFitnessStore.getState().dataLoading).toBe(false);
  });

  it("preserves existing observations and resumable work after failed refresh", async () => {
    const previous = seedExistingObservations();
    database.loadAllData.mockRejectedValue(new Error("Offline."));
    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().currentUser).toEqual(user);
    expect(useFitnessStore.getState().sessions).toEqual(previous.sessions);
    expect(useFitnessStore.getState().sets).toEqual(previous.sets);
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual(previous.bodyMeasurementLogs);
    expect(useFitnessStore.getState().activeWorkout).toEqual(previous.activeWorkout);
    expect(useFitnessStore.getState().dataError).toBe("Offline.");
  });

  it("does not assume logout when the identity lookup itself fails", async () => {
    seedExistingObservations();
    database.loadCurrentUser.mockRejectedValue(new Error("Session lookup offline."));
    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().currentUser).toEqual(user);
    expect(useFitnessStore.getState().sets).toEqual(observedSets);
    expect(useFitnessStore.getState().dataError).toBe("Session lookup offline.");
    expect(database.loadAllData).not.toHaveBeenCalled();
  });

  it("clears an explicitly absent session without accepting stale application identity", async () => {
    seedExistingObservations();
    database.loadCurrentUser.mockResolvedValue(null);
    // A stale data response must not override the independent session authority.
    database.loadAllData.mockResolvedValue(applicationData(user));
    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().currentUser).toBeNull();
    expect(useFitnessStore.getState().sessions).toEqual([]);
    expect(useFitnessStore.getState().sets).toEqual([]);
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
  });

  it("does not display another account's previous facts if new account loading fails", async () => {
    seedExistingObservations();
    const other = { ...user, id: "user-b" };
    database.loadCurrentUser.mockResolvedValue(other);
    database.loadAllData.mockRejectedValue(new Error("New account data unavailable."));
    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().currentUser).toEqual(other);
    expect(useFitnessStore.getState().sessions).toEqual([]);
    expect(useFitnessStore.getState().sets).toEqual([]);
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
  });

  it("refuses a different account's data response without changing the valid identity", async () => {
    const previous = seedExistingObservations();
    database.loadAllData.mockResolvedValue({
      ...applicationData({ ...user, id: "user-b" }),
      sets: observedSets.map((set) => ({ ...set, weight: 999 }))
    });
    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().currentUser).toEqual(user);
    expect(useFitnessStore.getState().sets).toEqual(previous.sets);
    expect(useFitnessStore.getState().activeWorkout).toEqual(previous.activeWorkout);
    expect(useFitnessStore.getState().dataError).toMatch(/session changed/i);
  });

  it("keeps a newer successful refresh when an older response arrives later", async () => {
    seedExistingObservations();
    const old = deferred<ReturnType<typeof applicationData>>();
    const newerSets = observedSets.map((set) => ({ ...set, weight: 110 }));
    database.loadAllData.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...applicationData(), sets: newerSets });
    const previousRefresh = useFitnessStore.getState().hydrate();
    await vi.waitFor(() => expect(database.loadAllData).toHaveBeenCalledTimes(1));
    await useFitnessStore.getState().hydrate();
    old.resolve(applicationData());
    await previousRefresh;

    expect(useFitnessStore.getState().sets).toEqual(newerSets);
    expect(useFitnessStore.getState().dataError).toBeNull();
  });

  it("does not restore observations from a late response after logout", async () => {
    seedExistingObservations();
    const pending = deferred<ReturnType<typeof applicationData>>();
    database.loadAllData.mockReturnValue(pending.promise);
    const hydration = useFitnessStore.getState().hydrate();
    await vi.waitFor(() => expect(database.loadAllData).toHaveBeenCalledTimes(1));
    await useFitnessStore.getState().logout();
    pending.resolve(applicationData());
    await hydration;

    expect(useFitnessStore.getState().currentUser).toBeNull();
    expect(useFitnessStore.getState().sets).toEqual([]);
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
    expect(useFitnessStore.getState().dataLoading).toBe(false);
  });

  it("does not restore identity from a late identity lookup after logout", async () => {
    seedExistingObservations();
    const pending = deferred<User | null>();
    database.loadCurrentUser.mockReturnValue(pending.promise);
    const hydration = useFitnessStore.getState().hydrate();
    await useFitnessStore.getState().logout();
    pending.resolve(user);
    await hydration;

    expect(useFitnessStore.getState().currentUser).toBeNull();
    expect(useFitnessStore.getState().sets).toEqual([]);
    expect(database.loadAllData).not.toHaveBeenCalled();
  });

  it("does not restore private social data from hydration after logout", async () => {
    seedExistingObservations();
    const pending = deferred<SocialData>();
    database.loadSocialData.mockReturnValueOnce(pending.promise);
    const hydration = useFitnessStore.getState().hydrate();
    await vi.waitFor(() => expect(database.loadSocialData).toHaveBeenCalledTimes(1));
    await useFitnessStore.getState().logout();
    pending.resolve({
      friends: [{ id: "private-friend", name: "Old account friend", status: "accepted", direction: "sent", created_at: timestamp }],
      invites: [], leaderboard: [], notice: null
    });
    await hydration;

    expect(useFitnessStore.getState().currentUser).toBeNull();
    expect(useFitnessStore.getState().socialData).toEqual({ friends: [], invites: [], leaderboard: [], notice: null });
  });

  it("reports password failure as failure without a success notice", async () => {
    seedExistingObservations();
    database.updateCurrentUserPassword.mockRejectedValue(new Error("Password rejected."));
    expect(await useFitnessStore.getState().updatePassword({ password: "test-password" })).toBe(false);
    expect(useFitnessStore.getState().authNotice).toBeNull();
    expect(useFitnessStore.getState().authError).toBe("Password rejected.");
    expect(useFitnessStore.getState().currentUser).toEqual(user);
  });

  it("reports password success only after the password write succeeds", async () => {
    const pending = deferred<void>();
    database.updateCurrentUserPassword.mockReturnValue(pending.promise);
    const updating = useFitnessStore.getState().updatePassword({ password: "test-password" });
    expect(useFitnessStore.getState().authNotice).toBeNull();
    pending.resolve(undefined);
    expect(await updating).toBe(true);
    expect(useFitnessStore.getState().authError).toBeNull();
    expect(useFitnessStore.getState().authNotice).toMatch(/Password updated/);
  });
});

describe("recording-boundary observation safety", () => {
  it("rejects complete suggested values before the persistence boundary", async () => {
    seedExistingObservations();
    await expect(useFitnessStore.getState().saveWorkout(workoutInput())).rejects.toThrow(/mark it as performed/);
    expect(database.recordWorkoutEntry).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().sets).toEqual(observedSets);
  });

  it.each(["reps", "weight", "warmup", "date", "machine", "exercise", "unit"])(
    "requires reconfirmation when the %s context changes", async (changed) => {
      seedExistingObservations();
      const input = confirmedInput();
      if (changed === "reps") input.sets[0] = { ...input.sets[0], reps: "9" };
      if (changed === "weight") input.sets[0] = { ...input.sets[0], weight: "105" };
      if (changed === "warmup") input.sets[0] = { ...input.sets[0], isWarmup: true };
      if (changed === "date") input.workoutDate = "2026-07-02";
      if (changed === "machine") input.machineProfileId = "different-machine";
      if (changed === "exercise") {
        useFitnessStore.setState({ exercises: [exercise, { ...exercise, id: 2, name: "Other Exercise" }] });
        input.exerciseId = 2;
      }
      if (changed === "unit") useFitnessStore.setState({ unitSystem: "kg" });

      await expect(useFitnessStore.getState().saveWorkout(input)).rejects.toThrow(/mark it as performed/);
      expect(database.recordWorkoutEntry).not.toHaveBeenCalled();
    }
  );

  it.each(["manual", "guided"] as const)("returns the committed ID for %s work despite failed refresh", async (origin) => {
    seedExistingObservations();
    database.loadAllData.mockRejectedValue(new Error("Refresh offline."));
    const input = origin === "guided" ? confirmedInput() : workoutInput("manual");
    expect(await useFitnessStore.getState().saveWorkout(input)).toBe(42);
    expect(database.recordWorkoutEntry).toHaveBeenCalledTimes(1);
    expect(useFitnessStore.getState().dataError).toBe("Refresh offline.");
    expect(useFitnessStore.getState().currentUser).toEqual(user);
  });

  it("does not turn machine-metadata failure into a failed workout commit", async () => {
    seedExistingObservations();
    database.saveMachineProfiles.mockRejectedValue(new Error("Machine metadata offline."));
    const input = workoutInput("manual");
    input.machineProfileId = machine.id;
    expect(await useFitnessStore.getState().saveWorkout(input)).toBe(42);
    expect(database.recordWorkoutEntry).toHaveBeenCalledTimes(1);
    expect(useFitnessStore.getState().operationNotice).toMatch(/Workout saved/);
  });

  it("preserves previous work and the draft when the workout write fails", async () => {
    const previous = seedExistingObservations();
    const input = confirmedInput();
    const previousDraft = useFitnessStore.getState().activeWorkout;
    database.recordWorkoutEntry.mockRejectedValue(new Error("Write rejected."));
    await expect(useFitnessStore.getState().saveWorkout(input)).rejects.toThrow("Write rejected.");
    expect(useFitnessStore.getState().sessions).toEqual(previous.sessions);
    expect(useFitnessStore.getState().sets).toEqual(previous.sets);
    expect(useFitnessStore.getState().activeWorkout).toEqual(previousDraft);
    expect(database.loadAllData).not.toHaveBeenCalled();
  });

  it.each(["manual", "guided"] as const)("keeps %s retry loads bound to the original unit after preferences change", async (origin) => {
    seedExistingObservations();
    const input = { ...(origin === "guided" ? confirmedInput() : workoutInput("manual")), unitSystem: "lb" as const };
    database.recordWorkoutEntry.mockRejectedValueOnce(new Error("Connection lost before acknowledgement.")).mockImplementationOnce(async (input: WorkoutRecordingInput) => recordedResult(input));
    const uncertain = await useFitnessStore.getState().saveWorkout(input).then(() => null, (error: unknown) => error);
    expect(uncertain).not.toBeInstanceOf(WorkoutValidationError);
    useFitnessStore.setState({ unitSystem: "kg" });
    expect(await useFitnessStore.getState().saveWorkout(input)).toBe(42);

    const firstWrite = database.recordWorkoutEntry.mock.calls[0][0];
    const retryWrite = database.recordWorkoutEntry.mock.calls[1][0];
    const { completedAt: _firstAttemptTime, ...firstObservationWrite } = firstWrite;
    const { completedAt: _retryAttemptTime, ...retryObservationWrite } = retryWrite;
    expect(retryObservationWrite).toEqual(firstObservationWrite);
    expect(retryWrite.sets.map((set: { weight: number }) => set.weight)).toEqual([100, 100]);
    expect(retryWrite.requestId).toBe(input.requestId);
  });

  it.each(["unconfirmed-guidance", "invalid-manual-input"])("identifies %s rejection as safe pre-write validation", async (kind) => {
    seedExistingObservations();
    const input = kind === "unconfirmed-guidance" ? workoutInput() : workoutInput("manual");
    if (kind === "invalid-manual-input") input.sets[0].reps = "not-reps";
    await expect(useFitnessStore.getState().saveWorkout(input)).rejects.toBeInstanceOf(WorkoutValidationError);
    expect(database.recordWorkoutEntry).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().sets).toEqual(observedSets);
  });
});

describe("completion and deletion preserve valid prior state", () => {
  it("interprets a historical edit in its explicit form unit instead of a changed preference", async () => {
    seedExistingObservations();
    useFitnessStore.setState({ unitSystem: "kg" });
    await useFitnessStore.getState().updateWorkoutLog({ sessionId: session.id, exerciseId: exercise.id, workoutDate: date,
      notes: "Edited", unitSystem: "lb", sets: [{ reps: "8", weight: "100" }] });
    expect(database.updateWorkoutSession).toHaveBeenCalledWith(expect.objectContaining({ inputUnit: "lb", sets: [{ reps: 8, weight: 100, isWarmup: false }] }));
  });
  it("uses the raw saved legacy snapshot for finishing instead of adding UI defaults to CAS", async () => {
    const data = applicationData();
    const raw = { ...data.activeWorkout!, pendingMuscle: undefined, legacyField: true };
    database.loadAllData.mockResolvedValueOnce({ ...data, activeWorkoutSnapshot: raw });
    await useFitnessStore.getState().hydrate();
    database.loadAllData.mockResolvedValue({ ...data, activeWorkout: null });
    await useFitnessStore.getState().finishActiveWorkout();
    expect(database.finalizeActiveWorkout).toHaveBeenCalledWith(raw.startedAt, null, raw);
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
  });
  it("retains resumable work and the existing archive when finalization fails", async () => {
    const previous = seedExistingObservations();
    const oldSummary = { ...summary(), id: "older-workout", startedAt: "2026-06-30T12:00:00.000Z" };
    useFitnessStore.setState({ completedGuidedWorkouts: [oldSummary] });
    database.finalizeActiveWorkout.mockRejectedValue(new Error("Archive write failed."));

    await expect(useFitnessStore.getState().finishActiveWorkout(summary())).rejects.toThrow("Archive write failed.");
    expect(useFitnessStore.getState().activeWorkout).toEqual(previous.activeWorkout);
    expect(useFitnessStore.getState().completedGuidedWorkouts).toEqual([oldSummary]);
  });

  it("keeps the draft until atomic finalization succeeds and deduplicates retry summaries", async () => {
    seedExistingObservations();
    const pending = deferred<void>();
    database.finalizeActiveWorkout.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    database.loadAllData.mockResolvedValue({ ...applicationData(), activeWorkout: null, completedGuidedWorkouts: [summary()] });
    const finishing = useFitnessStore.getState().finishActiveWorkout(summary());
    await vi.waitFor(() => expect(database.finalizeActiveWorkout).toHaveBeenCalledTimes(1));
    expect(useFitnessStore.getState().activeWorkout).not.toBeNull();
    expect(useFitnessStore.getState().completedGuidedWorkouts).toEqual([]);

    pending.resolve(undefined);
    await finishing;
    await useFitnessStore.getState().finishActiveWorkout(summary());
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
    expect(useFitnessStore.getState().completedGuidedWorkouts).toEqual([summary()]);
  });

  it("does not finalize a queued old snapshot after a preceding draft save advances its revision", async () => {
    seedExistingObservations();
    const previous = activeWorkout();
    const newer = { ...previous, currentExercise: { ...previous.currentExercise, notes: "Newer observed work" } };
    const pending = deferred<ActiveWorkout>();
    database.saveActiveWorkout.mockReturnValueOnce(pending.promise);
    const priorSave = useFitnessStore.getState().updateActiveWorkout(previous);
    await vi.waitFor(() => expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1));
    const finishing = useFitnessStore.getState().finishActiveWorkout(summary()).then(() => null, (error: unknown) => error);
    database.loadAllData.mockResolvedValue({ ...applicationData(), activeWorkout: newer });
    await useFitnessStore.getState().hydrate();
    const savedPrevious = { ...previous, revision: 2 };
    pending.resolve(savedPrevious);
    await priorSave;

    expect(await finishing).toEqual(expect.objectContaining({ message: expect.stringMatching(/save or reconcile|draft changed/i) }));
    expect(database.finalizeActiveWorkout).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().activeWorkout).toEqual(savedPrevious);
    expect(useFitnessStore.getState().completedGuidedWorkouts).toEqual([]);
  });

  it("does not accept edits that would become unsaveable during in-flight finalization", async () => {
    const previous = seedExistingObservations().activeWorkout;
    const newer = { ...previous, currentExercise: { ...previous.currentExercise, notes: "Entered while finishing" } };
    const pending = deferred<void>();
    database.finalizeActiveWorkout.mockReturnValueOnce(pending.promise);
    database.loadAllData.mockResolvedValue({ ...applicationData(), activeWorkout: null, completedGuidedWorkouts: [summary()] });
    const finishing = useFitnessStore.getState().finishActiveWorkout(summary());
    await vi.waitFor(() => expect(database.finalizeActiveWorkout).toHaveBeenCalledTimes(1));
    const editing = useFitnessStore.getState().updateActiveWorkout(newer).then(() => null, (error: unknown) => error);
    const draftDuringFinish = useFitnessStore.getState().activeWorkout;
    pending.resolve(undefined);
    await finishing;
    const editResult = await editing;

    expect(draftDuringFinish).toEqual(previous);
    expect(editResult).toBeInstanceOf(Error);
    expect(database.saveActiveWorkout).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
    expect(useFitnessStore.getState().completedGuidedWorkouts).toEqual([summary()]);
  });

  it.each([
    ["deleteWorkoutLog", "deleteWorkoutSession", 10],
    ["deleteBodyWeightLog", "deleteBodyWeightLog", 20],
    ["deleteBodyMeasurementLog", "deleteBodyMeasurementLog", 20]
  ] as const)("keeps observations after failed %s", async (action, adapter, id) => {
    const previous = seedExistingObservations();
    database[adapter].mockRejectedValue(new Error("Deletion rejected."));
    await expect(useFitnessStore.getState()[action](id)).rejects.toThrow("Deletion rejected.");
    expect(useFitnessStore.getState().sessions).toEqual(previous.sessions);
    expect(useFitnessStore.getState().sets).toEqual(previous.sets);
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual(previous.bodyMeasurementLogs);
  });

  it("keeps successfully deleted workout observations removed when refresh fails", async () => {
    seedExistingObservations();
    database.deleteWorkoutSession.mockResolvedValue(undefined);
    database.loadAllData.mockRejectedValue(new Error("Refresh offline."));
    await expect(useFitnessStore.getState().deleteWorkoutLog(10)).resolves.toBeUndefined();
    expect(useFitnessStore.getState().sessions).toEqual([]);
    expect(useFitnessStore.getState().sets).toEqual([]);
    expect(useFitnessStore.getState().dataError).toBe("Refresh offline.");
  });

  it("removes successfully deleted weight and preserves tape when refresh fails", async () => {
    seedExistingObservations();
    database.deleteBodyWeightLog.mockResolvedValue(undefined);
    database.loadAllData.mockRejectedValue(new Error("Refresh offline."));
    await expect(useFitnessStore.getState().deleteBodyWeightLog(20)).resolves.toBeUndefined();
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([expect.objectContaining({ id: 20, weight: null, measurements: { waist: 80 } })]);
    expect(useFitnessStore.getState().bodyWeightLogs).toEqual([]);
  });

  it("removes successfully deleted tape and preserves weight when refresh fails", async () => {
    seedExistingObservations();
    database.deleteBodyMeasurementLog.mockResolvedValue(undefined);
    database.loadAllData.mockRejectedValue(new Error("Refresh offline."));
    await expect(useFitnessStore.getState().deleteBodyMeasurementLog(20)).resolves.toBeUndefined();
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([expect.objectContaining({ id: 20, weight: 175, measurements: {} })]);
    expect(useFitnessStore.getState().bodyWeightLogs).toEqual([expect.objectContaining({ id: 20, weight: 175 })]);
  });
});

describe("mobile draft persistence ordering", () => {
  it("keeps the most recent entered draft when earlier writes finish later", async () => {
    seedExistingObservations();
    const first = { ...activeWorkout(), currentExercise: { ...activeWorkout().currentExercise, notes: "First entry" } };
    const latest = { ...first, currentExercise: { ...first.currentExercise, notes: "Latest entry" } };
    const pending = deferred<ActiveWorkout>();
    let durable: ActiveWorkout | null = null;
    database.saveActiveWorkout
      .mockImplementationOnce(async () => { const saved = await pending.promise; durable = saved; return saved; })
      .mockImplementationOnce(async (draft: ActiveWorkout) => { durable = { ...draft, revision: (draft.revision ?? 0) + 1 }; return durable; });
    const firstSave = useFitnessStore.getState().updateActiveWorkout(first);
    await vi.waitFor(() => expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1));
    const latestSave = useFitnessStore.getState().updateActiveWorkout(latest);
    expect(useFitnessStore.getState().activeWorkout).toEqual(latest);
    expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1);

    pending.resolve({ ...first, revision: 2 });
    await Promise.all([firstSave, latestSave]);
    expect(durable).toEqual({ ...latest, revision: 3 });
    expect(useFitnessStore.getState().activeWorkout).toEqual({ ...latest, revision: 3 });
    expect(database.saveActiveWorkout.mock.calls.map(([candidate]) => candidate.revision)).toEqual([1, 2]);
    expect(useFitnessStore.getState().activeWorkoutDirty).toBe(false);
  });

  it("retains an unsaved draft and reports failure so the user can retry", async () => {
    seedExistingObservations();
    const latest = { ...activeWorkout(), currentExercise: { ...activeWorkout().currentExercise, notes: "Unsaved entry" } };
    database.saveActiveWorkout.mockRejectedValue(new Error("Draft offline."));
    await expect(useFitnessStore.getState().updateActiveWorkout(latest)).rejects.toThrow("Draft offline.");
    expect(useFitnessStore.getState().activeWorkout).toEqual(latest);
    expect(useFitnessStore.getState().operationNotice).toMatch(/draft could not be saved/i);

    database.saveActiveWorkout.mockImplementation(async (candidate: ActiveWorkout) => ({ ...candidate, revision: (candidate.revision ?? 0) + 1 }));
    await expect(useFitnessStore.getState().updateActiveWorkout(latest)).resolves.toBeUndefined();
    expect(database.saveActiveWorkout).toHaveBeenCalledTimes(2);
  });

  it("does not submit an old account's queued draft after logout", async () => {
    seedExistingObservations();
    const first = { ...activeWorkout(), currentExercise: { ...activeWorkout().currentExercise, notes: "First entry" } };
    const queued = { ...first, currentExercise: { ...first.currentExercise, notes: "Queued entry" } };
    const pending = deferred<void>();
    database.saveActiveWorkout.mockReturnValueOnce(pending.promise);
    const firstSave = useFitnessStore.getState().updateActiveWorkout(first);
    await vi.waitFor(() => expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1));
    const queuedOutcome = useFitnessStore.getState().updateActiveWorkout(queued).then(
      () => null, (error: unknown) => error
    );
    await useFitnessStore.getState().logout();
    pending.resolve(undefined);
    await firstSave;

    expect(await queuedOutcome).toEqual(expect.objectContaining({ message: expect.stringMatching(/account changed/i) }));
    expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1);
    expect(useFitnessStore.getState().currentUser).toBeNull();
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
  });

  it("does not restore a newly started draft after logout while its write was pending", async () => {
    seedExistingObservations();
    const pending = deferred<void>();
    database.saveActiveWorkout.mockReturnValueOnce(pending.promise);
    const starting = useFitnessStore.getState().startActiveWorkout(activeWorkout());
    await vi.waitFor(() => expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1));
    await useFitnessStore.getState().logout();
    pending.resolve(undefined);
    await starting;

    expect(useFitnessStore.getState().currentUser).toBeNull();
    expect(useFitnessStore.getState().activeWorkout).toBeNull();
  });

  it("retains dirty entered values and their saved baseline through a successful refresh", async () => {
    const previous = seedExistingObservations();
    const local = { ...previous.activeWorkout, currentExercise: { ...previous.activeWorkout.currentExercise, notes: "Entered offline" } };
    database.saveActiveWorkout.mockRejectedValueOnce(new Error("Draft offline."));
    await expect(useFitnessStore.getState().updateActiveWorkout(local)).rejects.toThrow("Draft offline.");
    const remote = { ...previous.activeWorkout, revision: 8, currentExercise: { ...previous.activeWorkout.currentExercise, notes: "Saved in another tab" } };
    database.loadAllData.mockResolvedValue({ ...applicationData(), activeWorkout: remote });

    await useFitnessStore.getState().hydrate();

    expect(useFitnessStore.getState().activeWorkout).toEqual(local);
    expect(useFitnessStore.getState().activeWorkoutDirty).toBe(true);
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(previous.activeWorkout);
    expect(useFitnessStore.getState().savedActiveWorkout?.revision).toBe(1);
    expect(useFitnessStore.getState().dataError).toBeNull();
  });

  it("preserves both the local and newer saved versions after a stale-write rejection", async () => {
    const previous = seedExistingObservations();
    const local = { ...previous.activeWorkout, currentExercise: { ...previous.activeWorkout.currentExercise, notes: "My unsaved values" } };
    const remote = { ...previous.activeWorkout, revision: 8, currentExercise: { ...previous.activeWorkout.currentExercise, notes: "Other tab values" } };
    database.saveActiveWorkout.mockRejectedValueOnce(new DraftConflictError(local, remote));

    await expect(useFitnessStore.getState().updateActiveWorkout(local)).rejects.toBeInstanceOf(DraftConflictError);

    expect(useFitnessStore.getState().activeWorkout).toEqual(local);
    expect(useFitnessStore.getState().activeWorkoutDirty).toBe(true);
    expect(useFitnessStore.getState().activeDraftConflict).toBe(true);
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(remote);
    expect(useFitnessStore.getState().recoveredWorkoutDrafts).toEqual([expect.objectContaining({ draft: local })]);
    expect(useFitnessStore.getState().operationNotice).toMatch(/newer workout draft/i);
    await expect(useFitnessStore.getState().updateActiveWorkout(local)).rejects.toThrow(/recovered version/i);
    expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1);
  });

  it("explicitly reloads the saved version while retaining the conflict draft for recovery", async () => {
    const previous = seedExistingObservations();
    const local = { ...previous.activeWorkout, currentExercise: { ...previous.activeWorkout.currentExercise, notes: "Recover these values" } };
    const remote = { ...previous.activeWorkout, revision: 5, currentExercise: { ...previous.activeWorkout.currentExercise, notes: "Current saved version" } };
    const recovered = [{ id: "recovery-a", savedAt: timestamp, draft: local }];
    useFitnessStore.setState({ activeWorkout: local, savedActiveWorkout: remote, activeWorkoutDirty: true, activeDraftConflict: true, recoveredWorkoutDrafts: recovered });
    database.loadAllData.mockResolvedValue({ ...applicationData(), activeWorkout: remote, recoveredWorkoutDrafts: recovered });

    await useFitnessStore.getState().reloadSavedWorkoutDraft();

    expect(useFitnessStore.getState().activeWorkout).toEqual(remote);
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(remote);
    expect(useFitnessStore.getState().recoveredWorkoutDrafts).toEqual(recovered);
    expect(useFitnessStore.getState().activeDraftConflict).toBe(false);
    expect(useFitnessStore.getState().activeWorkoutDirty).toBe(false);
    expect(database.saveActiveWorkout).not.toHaveBeenCalled();
  });

  it("does not apply an old account's late conflict or recovery draft to the new account", async () => {
    seedExistingObservations();
    const local = { ...activeWorkout(), currentExercise: { ...activeWorkout().currentExercise, notes: "Private account A draft" } };
    const oldRemote = { ...activeWorkout(), revision: 3 };
    let reject!: (error: unknown) => void;
    database.saveActiveWorkout.mockReturnValueOnce(new Promise<ActiveWorkout>((_, fail) => { reject = fail; }));
    const saving = useFitnessStore.getState().updateActiveWorkout(local).then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(database.saveActiveWorkout).toHaveBeenCalledTimes(1));
    const other = { ...user, id: "user-b" };
    const otherDraft = { ...activeWorkout(), workoutId: "other-workout", startedAt: `${date}T15:00:00.000Z` };
    database.loadCurrentUser.mockResolvedValue(other);
    database.loadAllData.mockResolvedValue({ ...applicationData(other), activeWorkout: otherDraft });
    await useFitnessStore.getState().hydrate();
    reject(new DraftConflictError(local, oldRemote));
    expect(await saving).toBeInstanceOf(DraftConflictError);

    expect(useFitnessStore.getState().currentUser).toEqual(other);
    expect(useFitnessStore.getState().activeWorkout).toEqual(otherDraft);
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(otherDraft);
    expect(useFitnessStore.getState().recoveredWorkoutDrafts).toEqual([]);
    expect(useFitnessStore.getState().activeDraftConflict).toBe(false);
    expect(useFitnessStore.getState().operationNotice).toBeNull();
  });
});

describe("guided facts and draft advancement commit together", () => {
  it("passes the prepared snapshot and accepts the atomic returned draft without a second link write", async () => {
    seedExistingObservations();
    const input = confirmedInput();
    const prescription: Prescription = {
      exerciseId: 1, category: "strength", generatedAt: timestamp, basedOnEntryIds: [session.id], comparisonContext: null,
      sets: [1, 2].map((setNumber) => ({ setNumber, isWarmup: false, targetReps: { minimum: 8, maximum: 8 }, targetLoadLb: 100 }))
    };
    const expectedActive = { ...input.expectedActive!, currentExercise: { ...input.expectedActive!.currentExercise, prescription } };
    useFitnessStore.setState({ activeWorkout: expectedActive, savedActiveWorkout: expectedActive });
    const authoritative = recordedResult({ requestId: input.requestId, exerciseId: input.exerciseId, workoutId: expectedActive.workoutId!, workoutDate: date,
      notes: input.notes, sets: [{ reps: 8, weight: 100, isWarmup: false }, { reps: 8, weight: 100, isWarmup: false }], completedAt: timestamp, expectedActive });
    database.recordWorkoutEntry.mockResolvedValueOnce(authoritative);
    database.loadAllData.mockResolvedValue({ ...applicationData(), activeWorkout: authoritative.activeWorkout });

    expect(await useFitnessStore.getState().saveWorkout({ ...input, unitSystem: "lb", expectedActive })).toBe(42);

    expect(database.recordWorkoutEntry).toHaveBeenCalledWith(expect.objectContaining({
      requestId: input.requestId, workoutId: "workout-a", expectedActive,
      sets: [{ reps: 8, weight: 100, isWarmup: false }, { reps: 8, weight: 100, isWarmup: false }], inputUnit: "lb", recordingOrigin: "guided"
    }));
    expect(useFitnessStore.getState().activeWorkout).toEqual(authoritative.activeWorkout);
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(authoritative.activeWorkout);
    expect(useFitnessStore.getState().activeWorkoutDirty).toBe(false);
    expect(database.saveActiveWorkout).not.toHaveBeenCalled();
    expect(database.logWorkout).not.toHaveBeenCalled();
  });

  it("keeps the committed entry reference and cleared input after post-commit hydration fails", async () => {
    seedExistingObservations();
    const input = confirmedInput();
    database.loadAllData.mockRejectedValueOnce(new Error("Refresh offline after commit."));

    expect(await useFitnessStore.getState().saveWorkout(input)).toBe(42);

    const current = useFitnessStore.getState().activeWorkout;
    expect(current?.completedExercises).toEqual([expect.objectContaining({ sessionId: 42, exerciseId: 1, sets: [] })]);
    expect(current?.currentExercise.exerciseId).toBeNull();
    expect(current?.currentExercise.requestId).toBeUndefined();
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(current);
    expect(useFitnessStore.getState().activeWorkoutDirty).toBe(false);
    expect(useFitnessStore.getState().currentUser).toEqual(user);
    expect(useFitnessStore.getState().dataError).toBe("Refresh offline after commit.");
    expect(database.saveActiveWorkout).not.toHaveBeenCalled();
  });

  it("does not apply account A's committed draft when account B becomes active during the write", async () => {
    seedExistingObservations();
    const input = confirmedInput();
    const pending = deferred<WorkoutRecordingResult>();
    database.recordWorkoutEntry.mockReturnValueOnce(pending.promise);
    const recording = useFitnessStore.getState().saveWorkout(input);
    await vi.waitFor(() => expect(database.recordWorkoutEntry).toHaveBeenCalledTimes(1));
    const other = { ...user, id: "user-b" };
    const otherDraft = { ...activeWorkout(), workoutId: "other-workout", startedAt: `${date}T15:00:00.000Z` };
    database.loadCurrentUser.mockResolvedValue(other);
    database.loadAllData.mockResolvedValue({ ...applicationData(other), activeWorkout: otherDraft });
    await useFitnessStore.getState().hydrate();
    pending.resolve(recordedResult(database.recordWorkoutEntry.mock.calls[0][0]));

    expect(await recording).toBe(42);
    expect(useFitnessStore.getState().currentUser).toEqual(other);
    expect(useFitnessStore.getState().activeWorkout).toEqual(otherDraft);
    expect(useFitnessStore.getState().savedActiveWorkout).toEqual(otherDraft);
    expect(useFitnessStore.getState().activeWorkout?.completedExercises).toEqual([]);
  });
});

describe("logging validity is independent of scoring", () => {
  it("records a single performed working set without claiming a score", async () => {
    seedExistingObservations();
    const input = { ...workoutInput("manual"), sets: [{ reps: "5", weight: "100" }] };
    expect(await useFitnessStore.getState().saveWorkout(input)).toBe(42);
    expect(database.recordWorkoutEntry).toHaveBeenCalledWith(expect.objectContaining({
      inputUnit: "lb", recordingOrigin: "manual", sets: [{ reps: 5, weight: 100, isWarmup: false }]
    }));
  });

  it("records a deliberately confirmed warm-up-only entry", async () => {
    seedExistingObservations();
    const input: SaveWorkoutInput = { ...workoutInput(), sets: [{ reps: "8", weight: "60", isWarmup: true }] };
    input.sets = input.sets.map((set) => confirmGuidedObservation(set, { ...input, unitSystem: "lb" }));
    expect(await useFitnessStore.getState().saveWorkout(bindGuidedDraft(input))).toBe(42);
    expect(database.recordWorkoutEntry).toHaveBeenCalledWith(expect.objectContaining({ sets: [{ reps: 8, weight: 60, isWarmup: true }] }));
  });

  it.each(["2026-02-30", "2026-13-01", "", "not-a-date"])("rejects %s instead of silently recording today", async (workoutDate) => {
    seedExistingObservations();
    await expect(useFitnessStore.getState().saveWorkout({ ...workoutInput("manual"), workoutDate })).rejects.toBeInstanceOf(WorkoutValidationError);
    expect(database.recordWorkoutEntry).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().sessions).toEqual([session]);
  });

  it("rejects blank added load instead of treating an empty field as performed zero", async () => {
    const pullUp = { ...exercise, name: "Pull-Up" };
    seedExistingObservations();
    useFitnessStore.setState({ exercises: [pullUp] });
    await expect(useFitnessStore.getState().saveWorkout({ ...workoutInput("manual"), sets: [{ reps: "5", weight: "" }] })).rejects.toThrow();
    expect(database.recordWorkoutEntry).not.toHaveBeenCalled();
  });

  it("rejects an invalid body date before changing either observation", async () => {
    seedExistingObservations();
    await expect(useFitnessStore.getState().updateBodyWeightLog({ id: bodyLog.id, loggedDate: "2026-02-29", weight: "175" })).rejects.toThrow(/date|calendar/i);
    expect(database.updateBodyWeightLog).not.toHaveBeenCalled();
    expect(useFitnessStore.getState().bodyMeasurementLogs).toEqual([bodyLog]);
  });
});
