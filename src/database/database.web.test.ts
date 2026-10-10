import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(),
  auth: { getUser: vi.fn(), getSession: vi.fn(), updateUser: vi.fn() }
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => client }));

import { createActiveWorkout } from "@/constants/activeWorkout";
import { catalogExerciseRows } from "@/constants/exercises";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { createDefaultTrainingSplit } from "@/constants/trainingSplit";
import { WorkoutWriteInput } from "@/database/workoutWrite";
import { projectWorkoutHistory } from "@/domain/workoutHistory";
import { ActiveWorkout, CompletedGuidedWorkout, User } from "@/types";
import { confirmGuidedObservation } from "@/services/guidedWorkout/guidedObservationService";
import { WorkoutRecordingInput, standaloneWorkoutRecord } from "@/domain/workoutLifecycle";

type WebDatabase = typeof import("@/database/database.web");
const key = "growth.preview.database.v2";
const date = "2026-07-01";
const timestamp = `${date}T12:00:00.000Z`;
const user: User = { id: 1, name: "Lifter", email: "lifter@example.test", password_hash: "", created_at: timestamp };
const cloudUser = { id: "user-a", email: "lifter@example.test", created_at: timestamp, user_metadata: { name: "Lifter" } };
let storage: Map<string, string>;
let rejectWrite: boolean;

function workout(): ActiveWorkout {
  return { ...createActiveWorkout({ key: "mon", label: "Monday", muscles: ["Chest"] }), workoutId: "00000000-0000-4000-8000-000000000001", startedAt: timestamp, workoutDate: date };
}
function completed(active = workout()): CompletedGuidedWorkout {
  return { ...active, id: active.startedAt, finishedAt: `${date}T13:00:00.000Z` };
}
function localData() {
  const exercises = catalogExerciseRows(timestamp);
  return {
    exercises, users: [user], currentUserId: 1, configs: [], exercisePreferences: [],
    sessions: [{ id: 10, workout_date: date, notes: "Observed work", created_at: timestamp }],
    sets: [{ id: 1, session_id: 10, exercise_id: exercises[0].id, set_number: 1, reps: 8, weight: 100, created_at: timestamp }],
    bodyMeasurementLogs: [{ id: 20, weight: 175, measurements: { waist: 80 }, notes: "Measured", logged_date: date, logged_at: timestamp, created_at: timestamp, updated_at: timestamp }],
    bodyWeightLogs: [{ id: 30, weight: 170, unit: "lb", logged_date: date, logged_at: timestamp, created_at: timestamp }],
    bodyMeasurementMigration: "modern_authority", workoutWriteRequests: {}, retiredActiveWorkouts: [],
    unitSystem: "lb", bodyUnitPreferences: { weight: "lb", circumference: "cm" }, importFingerprints: [],
    trainingSplit: createDefaultTrainingSplit(), activeWorkout: workout(), completedGuidedWorkouts: [],
    guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences(), machineProfiles: []
  };
}
function input(): WorkoutWriteInput {
  return {
    requestId: "attempt-a", exerciseId: localData().exercises[0].id, workoutDate: date, notes: "New observed work",
    machineProfileId: "machine-a", sets: [{ reps: 8, weight: 100 }, { reps: 7, weight: 100 }]
  };
}
async function adapter(cloud = false): Promise<WebDatabase> {
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", cloud ? "https://example.test" : "");
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", cloud ? "test-only-key" : "");
  vi.resetModules();
  return import("@/database/database.web");
}

beforeEach(() => {
  let writes = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, action: () => unknown) => {
    const next = writes.then(action);
    writes = next.then(() => undefined, () => undefined);
    return next;
  } } });
  storage = new Map([[key, JSON.stringify(localData())]]);
  rejectWrite = false;
  vi.stubGlobal("window", {
    location: { origin: "https://example.test" },
    localStorage: {
      getItem: (storageKey: string) => storage.get(storageKey) ?? null,
      setItem: (storageKey: string, value: string) => {
        if (rejectWrite) throw new Error("Browser storage is full.");
        storage.set(storageKey, value);
      }
    }
  });
  for (const mock of [client.rpc, client.from, ...Object.values(client.auth)]) mock.mockReset();
  client.auth.getUser.mockResolvedValue({ data: { user: cloudUser }, error: null });
  client.auth.getSession.mockResolvedValue({ data: { session: { user: cloudUser } }, error: null });
  client.auth.updateUser.mockResolvedValue({ data: { user: cloudUser }, error: null });
  client.rpc.mockResolvedValue({ data: 42, error: null });
  client.from.mockImplementation(() => { throw new Error("Unexpected direct table access."); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("local browser body compatibility", () => {
  it("preserves pre-modern weights with missing units for explicit reconciliation", async () => {
    const data: Record<string, unknown> = { ...localData(), bodyWeightLogs: [
      ...localData().bodyWeightLogs,
      { id: 31, weight: 80, logged_date: "2026-07-02", logged_at: "2026-07-02T12:00:00.000Z", created_at: timestamp }
    ] };
    delete data.bodyMeasurementLogs;
    delete data.bodyMeasurementMigration;
    storage.set(key, JSON.stringify(data));
    const web = await adapter();
    expect((await web.loadAllData()).bodyMeasurementLogs).toEqual([expect.objectContaining({ weight: 170, logged_date: date })]);
    const saved = JSON.parse(storage.get(key)!);
    expect(saved.bodyWeightLogs).toEqual(data.bodyWeightLogs);
    expect(saved.bodyWeightLogs[1]).not.toHaveProperty("unit");
    expect(saved.bodyMeasurementMigration).toBe("known_legacy_migrated_unknown_preserved");
    expect(saved.bodyMeasurementLegacyUnknownUnitCount).toBe(1);
    await web.deleteBodyWeightLog(30);
    expect((await (await adapter()).loadAllData()).bodyMeasurementLogs).toEqual([]);
    expect(JSON.parse(storage.get(key)!).bodyWeightLogs).toEqual(data.bodyWeightLogs);
  });

  it.each(["malformed body state", "migration storage quota"]) (
    "keeps valid local identity accessible despite %s failure", async (failure) => {
      const data: Record<string, unknown> = { ...localData() };
      if (failure === "malformed body state") data.bodyMeasurementLogs = { ambiguous: true };
      else {
        delete data.bodyMeasurementMigration;
        rejectWrite = true;
      }
      const original = JSON.stringify(data);
      storage.set(key, original);
      const web = await adapter();
      expect(await web.loadCurrentUser()).toEqual(user);
      await expect(web.loadAllData()).rejects.toThrow(failure === "malformed body state" ? /stored body measurements are invalid/i : "Browser storage is full.");
      expect(await web.loadCurrentUser()).toEqual(user);
      expect(storage.get(key)).toBe(original);
    }
  );

  it("treats an empty modern store as authoritative and preserves legacy originals", async () => {
    const data: Record<string, unknown> = { ...localData(), bodyMeasurementLogs: [] };
    delete data.bodyMeasurementMigration;
    storage.set(key, JSON.stringify(data));
    const web = await adapter();
    expect((await web.loadAllData()).bodyMeasurementLogs).toEqual([]);
    expect(JSON.parse(storage.get(key)!).bodyWeightLogs).toEqual(data.bodyWeightLogs);
    expect((await (await adapter()).loadAllData()).bodyMeasurementLogs).toEqual([]);
  });

  it("checkpoints pure legacy conversion and does not recreate a deleted migrated observation", async () => {
    const data: Record<string, unknown> = { ...localData() };
    delete data.bodyMeasurementLogs;
    delete data.bodyMeasurementMigration;
    storage.set(key, JSON.stringify(data));
    const web = await adapter();
    const migrated = await web.loadAllData();
    expect(migrated.bodyMeasurementLogs).toHaveLength(1);
    expect(migrated.bodyMeasurementLogs[0].weight).toBe(170);
    expect(JSON.parse(storage.get(key)!).bodyWeightLogs).toEqual(data.bodyWeightLogs);
    await web.deleteBodyWeightLog(migrated.bodyMeasurementLogs[0].id);
    expect((await (await adapter()).loadAllData()).bodyMeasurementLogs).toEqual([]);
    expect(JSON.parse(storage.get(key)!).bodyWeightLogs).toEqual(data.bodyWeightLogs);
  });

  it("preserves the original legacy document if writing its migration checkpoint fails", async () => {
    const data: Record<string, unknown> = { ...localData() };
    delete data.bodyMeasurementLogs;
    delete data.bodyMeasurementMigration;
    const original = JSON.stringify(data);
    storage.set(key, original);
    rejectWrite = true;
    const web = await adapter();
    await expect(web.loadAllData()).rejects.toThrow("Browser storage is full.");
    expect(storage.get(key)).toBe(original);
    rejectWrite = false;
    expect((await web.loadAllData()).bodyMeasurementLogs).toHaveLength(1);
  });

  it("preserves a malformed modern document instead of replacing it with legacy observations", async () => {
    const original = JSON.stringify({ ...localData(), bodyMeasurementLogs: { ambiguous: true } });
    storage.set(key, original);
    await expect((await adapter()).loadAllData()).rejects.toThrow(/stored body measurements are invalid/i);
    expect(storage.get(key)).toBe(original);
  });

  it("preserves a retired modern store whose property is missing instead of recreating deleted observations", async () => {
    const data: Record<string, unknown> = { ...localData() };
    delete data.bodyMeasurementLogs;
    const original = JSON.stringify(data);
    storage.set(key, original);
    const web = await adapter();
    await expect(web.loadAllData()).rejects.toThrow(/migrated body measurements are unavailable/i);
    expect(storage.get(key)).toBe(original);
    expect(await web.loadCurrentUser()).toEqual(user);
  });
});

describe("cloud body migration authority", () => {
  function mockBodyQueries(retired: boolean, missingModern: boolean) {
    client.from.mockImplementation((table: string) => {
      const filters = new Map<string, unknown>();
      function result() {
        if (table === "body_measurement_logs") return missingModern
          ? { data: null, error: { code: "42P01", message: 'relation "public.body_measurement_logs" does not exist' } }
          : { data: [], error: null };
        if (table === "body_weight_logs") return { data: localData().bodyWeightLogs, error: null };
        if (table === "app_settings" && filters.get("key") === "workout_reference_migration_v1") return { data: { value: "true" }, error: null };
        if (table === "app_settings" && filters.get("key") === "body_measurements_legacy_migrated") {
          return { data: retired ? { value: '{"version":1}' } : null, error: null };
        }
        if (table === "profiles" || table === "app_settings" || table === "shared_training_splits") return { data: null, error: null };
        return { data: [], error: null };
      }
      const query = {
        select: () => query, order: () => query,
        eq: (field: string, value: unknown) => { filters.set(field, value); return query; },
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve)
      };
      return query;
    });
  }

  it("refuses legacy fallback when a retired modern table becomes unavailable", async () => {
    const web = await adapter(true);
    mockBodyQueries(true, true);
    await expect(web.loadAllData()).rejects.toThrow(/migrated body measurements are unavailable/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("still exposes preserved legacy measurements for a genuinely premodern cloud store", async () => {
    const web = await adapter(true);
    mockBodyQueries(false, true);
    expect((await web.loadAllData()).bodyMeasurementLogs).toEqual([expect.objectContaining({ id: 30, weight: 170, logged_date: date })]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("treats a successful empty modern table as authoritative despite retained legacy rows", async () => {
    const web = await adapter(true);
    mockBodyQueries(false, false);
    expect((await web.loadAllData()).bodyMeasurementLogs).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("single browser storage commits", () => {
  it("keeps original history when an edit cannot be committed", async () => {
    const original = storage.get(key);
    const web = await adapter();
    rejectWrite = true;
    await expect(web.updateWorkoutSession({ ...input(), sessionId: 10, notes: "Edited work" })).rejects.toThrow("Browser storage is full.");
    expect(storage.get(key)).toBe(original);
    rejectWrite = false;
    expect((await web.loadAllData()).sessions).toEqual(localData().sessions);
    expect((await web.loadAllData()).sets).toEqual(localData().sets);
  });

  it("does not leave a partial workout or receipt after failed creation", async () => {
    const original = storage.get(key);
    const web = await adapter();
    rejectWrite = true;
    await expect(web.logWorkout(input())).rejects.toThrow("Browser storage is full.");
    expect(storage.get(key)).toBe(original);
    rejectWrite = false;
    const id = await web.logWorkout(input());
    expect(await web.logWorkout(input())).toBe(id);
    const data = await web.loadAllData();
    expect(data.sessions).toHaveLength(2);
    expect(data.sets.filter((set) => set.session_id === id)).toHaveLength(2);
  });

  it.each(["workout", "weight", "measurements"])("preserves the prior document when %s deletion cannot commit", async (kind) => {
    const original = storage.get(key);
    const web = await adapter();
    rejectWrite = true;
    const action = kind === "workout" ? web.deleteWorkoutSession(10) : kind === "weight" ? web.deleteBodyWeightLog(20) : web.deleteBodyMeasurementLog(20);
    await expect(action).rejects.toThrow("Browser storage is full.");
    expect(storage.get(key)).toBe(original);
  });

  it("keeps resumability and archive contents after a failed finish commit", async () => {
    const original = storage.get(key);
    const web = await adapter();
    rejectWrite = true;
    await expect(web.finalizeActiveWorkout(workout().startedAt, [completed()], workout())).rejects.toThrow("Browser storage is full.");
    expect(storage.get(key)).toBe(original);
    rejectWrite = false;
    const data = await web.loadAllData();
    expect(data.activeWorkout).toEqual(workout());
    expect(data.completedGuidedWorkouts).toEqual([]);
  });

  it("retains history for an old custom exercise when normalizing the catalog", async () => {
    const data = localData();
    data.exercises.push({ id: 999, name: "Legacy custom machine", primary_muscle: "Chest", secondary_muscle: null, is_strength_exercise: 0, created_at: timestamp });
    data.sets[0].exercise_id = 999;
    storage.set(key, JSON.stringify(data));
    const normalized = await (await adapter()).loadAllData();
    expect(normalized.exercises).toContainEqual(expect.objectContaining({ id: 999, name: "Legacy custom machine" }));
    expect(normalized.sessions).toEqual(data.sessions);
    expect(normalized.sets).toEqual(data.sets);
  });

  it("refuses stale editing instead of creating orphan sets", async () => {
    const original = storage.get(key);
    await expect((await adapter()).updateWorkoutSession({ ...input(), sessionId: 999 })).rejects.toThrow(/no longer exists/i);
    expect(storage.get(key)).toBe(original);
  });

  it("reports a stale machine-tag edit without changing unrelated browser history", async () => {
    const original = storage.get(key);
    await expect((await adapter()).updateWorkoutSessionMachineProfile({ sessionId: 999, machineProfileId: "machine-b" })).rejects.toThrow(/no longer exists/i);
    expect(storage.get(key)).toBe(original);
  });

  it("retains one identity for retries and refuses different values or deleted-record retries", async () => {
    const web = await adapter();
    const id = await web.logWorkout(input());
    expect(await (await adapter()).logWorkout(input())).toBe(id);
    await expect(web.logWorkout({ ...input(), notes: "Different values" })).rejects.toThrow(/different values/i);
    await web.deleteWorkoutSession(id);
    await expect((await adapter()).logWorkout(input())).rejects.toThrow(/deleted/i);
    expect((await web.loadAllData()).sessions).toEqual(localData().sessions);
  });

  it.each(["finish", "discard"])("does not resurrect a %s draft through a delayed browser write", async (action) => {
    const web = await adapter();
    await web.finalizeActiveWorkout(workout().startedAt, action === "finish" ? [completed()] : null, workout());
    await web.saveActiveWorkout(workout()).catch(() => undefined);
    expect((await web.loadAllData()).activeWorkout).toBeNull();
    const newer = { ...workout(), workoutId: "00000000-0000-4000-8000-000000000002", startedAt: "2026-07-02T12:00:00.000Z" };
    const saved = await web.saveActiveWorkout(newer);
    expect((await web.loadAllData()).activeWorkout).toEqual(saved);
  });

  it("preserves newer changes to the same draft when an old snapshot tries to finish", async () => {
    const web = await adapter();
    const newer = { ...workout(), currentExercise: { ...workout().currentExercise, notes: "Newer entered work" } };
    const saved = await web.saveActiveWorkout(newer);
    await expect(web.finalizeActiveWorkout(workout().startedAt, [completed()], workout())).rejects.toThrow(/changed|newer|reload|refresh/i);
    const data = await web.loadAllData();
    expect(data.activeWorkout).toEqual(saved);
    expect(data.completedGuidedWorkouts).toEqual([]);
  });

  it("does not allow unscoped removal of an active draft", async () => {
    const web = await adapter();
    const original = storage.get(key);
    await expect(web.saveActiveWorkout(null)).rejects.toThrow();
    expect(storage.get(key)).toBe(original);
    expect((await web.loadAllData()).activeWorkout).toEqual(workout());
  });

  it("uses explicit legacy archive metadata to prevent old draft resurrection", async () => {
    const legacy: Record<string, unknown> = { ...localData(), activeWorkout: null, completedGuidedWorkouts: [completed()] };
    delete legacy.retiredActiveWorkouts;
    storage.set(key, JSON.stringify(legacy));
    const web = await adapter();
    await web.saveActiveWorkout(workout()).catch(() => undefined);
    const data = await web.loadAllData();
    expect(data.activeWorkout).toBeNull();
    expect(data.completedGuidedWorkouts).toEqual([completed()]);
  });
});

const atomicOperations = [
  { label: "workout create", rpc: "save_workout_session", run: (web: WebDatabase) => web.logWorkout(input()) },
  { label: "workout edit", rpc: "save_workout_session", run: (web: WebDatabase) => web.updateWorkoutSession({ ...input(), sessionId: 10 }) },
  { label: "workout machine-tag edit", rpc: "update_workout_machine_profile", run: (web: WebDatabase) => web.updateWorkoutSessionMachineProfile({ sessionId: 10, machineProfileId: "machine-b" }) },
  { label: "weight deletion", rpc: "delete_body_observation", run: (web: WebDatabase) => web.deleteBodyWeightLog(20) },
  { label: "tape deletion", rpc: "delete_body_observation", run: (web: WebDatabase) => web.deleteBodyMeasurementLog(20) },
  { label: "workout finish", rpc: "finalize_active_workout", run: (web: WebDatabase) => web.finalizeActiveWorkout(workout().startedAt, [completed()], workout()) },
  { label: "draft save", rpc: "save_active_workout", run: (web: WebDatabase) => web.saveActiveWorkout(workout()) },
  { label: "training import", rpc: "import_training_data_v6", run: (web: WebDatabase) => web.importTrainingData({ bodyWeightLogs: [], bodyMeasurementLogs: [], workouts: [], exerciseIdsToEnable: [] }) },
  { label: "leaderboard publication", rpc: "replace_score_snapshots", run: (web: WebDatabase) => web.syncScoreSnapshots([]) }
];

describe.each(atomicOperations)("cloud $label safety boundary", ({ run, rpc }) => {
  it("fails closed if the atomic operation is unavailable", async () => {
    const web = await adapter(true);
    client.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Function unavailable" } });
    await expect(run(web)).rejects.toThrow(/Phase [136] database migration/i);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0][0]).toBe(rpc);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reports server rejection without a destructive client fallback", async () => {
    const web = await adapter(true);
    client.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Server authorization rejected" } });
    await expect(run(web)).rejects.toThrow("Server authorization rejected");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("cloud identity and deletion boundaries", () => {
  it("loads valid session identity without querying application tables", async () => {
    const web = await adapter(true);
    expect(await web.loadCurrentUser()).toEqual(expect.objectContaining({ id: cloudUser.id }));
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("propagates a rejected password update rather than reporting success", async () => {
    const web = await adapter(true);
    client.auth.updateUser.mockResolvedValue({ data: null, error: { message: "Password rejected" } });
    await expect(web.updateCurrentUserPassword({ password: "test-password" })).rejects.toThrow("Password rejected");
  });

  it("does not start a critical write after authentication is rejected", async () => {
    const web = await adapter(true);
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Session rejected" } });
    await expect(web.logWorkout(input())).rejects.toThrow("Session rejected");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("requires the actual committed identity returned by the server", async () => {
    const web = await adapter(true);
    expect(await web.logWorkout(input())).toBe(42);
    client.rpc.mockResolvedValue({ data: null, error: null });
    await expect(web.logWorkout(input())).rejects.toThrow(/saved workout identity/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("deletes the owned session in one statement and relies on server cascading for sets", async () => {
    const web = await adapter(true);
    const query = {
      delete: vi.fn(() => query), eq: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
    };
    client.from.mockReturnValue(query);
    await web.deleteWorkoutSession(10);
    expect(client.from.mock.calls).toEqual([["workout_sessions"]]);
    expect(query.delete).toHaveBeenCalledTimes(1);
    expect(query.eq.mock.calls).toEqual([["id", 10], ["user_id", cloudUser.id]]);
  });

  it("requests only the selected body component through the server boundary", async () => {
    const web = await adapter(true);
    await web.deleteBodyWeightLog(20);
    await web.deleteBodyMeasurementLog(20);
    expect(client.rpc.mock.calls).toEqual([
      ["delete_body_observation", { p_id: 20, p_kind: "weight" }],
      ["delete_body_observation", { p_id: 20, p_kind: "measurements" }]
    ]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updates a machine tag through one atomic owned-history operation", async () => {
    const web = await adapter(true);
    await web.updateWorkoutSessionMachineProfile({ sessionId: 10, machineProfileId: "machine-b" });
    expect(client.rpc.mock.calls).toEqual([["update_workout_machine_profile", { p_session_id: 10, p_machine_profile_id: "machine-b" }]]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("leaves friendship acceptance and revocation to authoritative server operations", async () => {
    const web = await adapter(true);
    await web.acceptFriendInvite("invite-a");
    await web.removeFriend("friend-a");
    expect(client.rpc.mock.calls).toEqual([
      ["accept_friend_invite", { invite_token: "invite-a" }],
      ["remove_friend", { friend_id: "friend-a" }]
    ]);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("canonical browser observations", () => {
  it("never reuses a deleted entry or set identity after restart", async () => {
    const web = await adapter();
    const first = await web.logWorkout({ ...input(), inputUnit: "kg", recordingOrigin: "manual" });
    const firstSetIds = (await web.loadAllData()).sets.filter((set) => set.session_id === first).map((set) => set.id);
    await web.deleteWorkoutSession(first);
    const restarted = await adapter();
    const next = await restarted.logWorkout({ ...input(), requestId: "next-attempt", inputUnit: "lb", recordingOrigin: "manual" });
    expect(next).toBeGreaterThan(first);
    const nextSets = (await restarted.loadAllData()).sets.filter((set) => set.session_id === next);
    expect(nextSets.every((set) => set.id > Math.max(...firstSetIds))).toBe(true);
  });

  it("reserves identities referenced only by deleted legacy archives", async () => {
    const data = { ...localData(), completedGuidedWorkouts: [{ ...completed(), completedExercises: [{ sessionId: 900, exerciseId: input().exerciseId }] }] };
    storage.set(key, JSON.stringify(data));
    const web = await adapter();
    expect(await web.logWorkout(input())).toBeGreaterThan(900);
  });

  it("keeps prior retry receipts compatible without inventing their input units", async () => {
    const web = await adapter();
    const id = await web.logWorkout(input());
    expect(await web.logWorkout({ ...input(), inputUnit: "kg", recordingOrigin: "manual" })).toBe(id);
    const row = (await web.loadAllData()).sessions.find((session) => session.id === id)!;
    expect(row.input_unit).toBeNull();
    expect(row.recording_origin).toBeNull();
  });

  it("binds new receipts to their explicit recording context", async () => {
    const web = await adapter();
    const observed = { ...input(), inputUnit: "kg" as const, recordingOrigin: "manual" as const, sets: [{ reps: 8, weight: 100 }] };
    const id = await web.logWorkout(observed);
    const data = await web.loadAllData();
    expect(data.sessions.find((row) => row.id === id)).toMatchObject({ input_unit: "kg", recording_origin: "manual" });
    expect(data.sets.filter((set) => set.session_id === id)).toEqual([expect.objectContaining({ rir: null })]);
    await expect(web.logWorkout({ ...observed, inputUnit: "lb" })).rejects.toThrow(/different values/);
  });

  it("retains raw archive evidence through unrelated saves and completion", async () => {
    const oldArchives = Array.from({ length: 55 }, (_, index) => ({ ...completed(), startedAt: `old-workout-${index}`, id: `old-${index}` }));
    const invalid = { archivedNote: "Legacy evidence with unknown units", completedExercises: [{ weight: 90 }] };
    storage.set(key, JSON.stringify({ ...localData(), completedGuidedWorkouts: [...oldArchives, invalid] }));
    const web = await adapter();
    await web.logWorkout(input());
    expect(JSON.parse(storage.get(key)!).completedGuidedWorkouts).toEqual([...oldArchives, invalid]);
    await web.finalizeActiveWorkout(workout().startedAt, [completed()], workout());
    expect(JSON.parse(storage.get(key)!).completedGuidedWorkouts).toEqual([completed(), ...oldArchives, invalid]);
    expect((await web.loadAllData()).workoutArchiveEvidence).toEqual([completed(), ...oldArchives, invalid]);
  });

  it("does not resurrect an archived observation when a later recording is added", async () => {
    const web = await adapter();
    const id = await web.logWorkout(input());
    const data = JSON.parse(storage.get(key)!);
    data.completedGuidedWorkouts = [{ ...completed(), completedExercises: [{ exerciseId: input().exerciseId, sessionId: id, sets: [{ reps: "8", weight: "100" }] }] }];
    storage.set(key, JSON.stringify(data));
    await web.deleteWorkoutSession(id);
    await web.logWorkout({ ...input(), requestId: "different-attempt" });
    const loaded = await web.loadAllData();
    const projected = projectWorkoutHistory(loaded);
    const archiveId = loaded.workoutRecords.find((row) => row.legacyId === workout().startedAt)!.id;
    const archived = projected.workouts.find((row) => row.id === archiveId)!;
    expect(archived.entryIds).toEqual([]);
    expect(projected.issues.some((issue) => issue.code === "missing_session")).toBe(true);
  });

  it("sends explicit provenance to the authoritative cloud write", async () => {
    const web = await adapter(true);
    await web.logWorkout({ ...input(), inputUnit: "kg", recordingOrigin: "manual", sets: [{ reps: 5, weight: 100 }] });
    expect(client.rpc).toHaveBeenCalledWith("save_workout_session", expect.objectContaining({ p_input_unit: "kg", p_recording_origin: "manual" }));
  });
});

it("preserves a malformed null archive instead of overwriting it during completion", async () => {
  storage.set(key, JSON.stringify({ ...localData(), completedGuidedWorkouts: null }));
  const web = await adapter();
  const original = storage.get(key);
  await expect(web.finalizeActiveWorkout(workout().startedAt, [completed()], workout())).rejects.toThrow(/invalid/);
  expect(storage.get(key)).toBe(original);
  expect((await web.loadAllData()).activeWorkout).toEqual(workout());
});

describe("browser Phase 3 recording lifecycle", () => {
  async function guidedAttempt(web: WebDatabase): Promise<WorkoutRecordingInput> {
    const initial = (await web.loadAllData()).activeWorkout!;
    const values = input();
    const context = { exerciseId: values.exerciseId, workoutDate: date, machineProfileId: values.machineProfileId, unitSystem: "lb" as const };
    const saved = await web.saveActiveWorkout({ ...initial, currentExercise: { ...initial.currentExercise,
      exerciseId: values.exerciseId, muscle: "Chest", machineProfileId: values.machineProfileId!, notes: values.notes,
      requestId: values.requestId, requestUnit: "lb", sets: values.sets.map((set) => confirmGuidedObservation({ reps: String(set.reps), weight: String(set.weight) }, context))
    } });
    return { ...values, recordingOrigin: "guided", inputUnit: "lb", workoutId: saved.workoutId!, expectedActive: saved, completedAt: timestamp };
  }

  it("commits confirmed observations, reference and cleared draft in one storage write", async () => {
    const web = await adapter();
    const attempt = await guidedAttempt(web);
    const result = await web.recordWorkoutEntry(attempt);
    const data = await web.loadAllData();
    expect(data.workoutReferences).toContainEqual({ sessionId: result.sessionId, workoutId: attempt.workoutId, prescription: null, completedAt: timestamp });
    expect(data.sets.filter((set) => set.session_id === result.sessionId).map((set) => [set.reps, set.weight])).toEqual([[8, 100], [7, 100]]);
    expect(data.activeWorkout?.revision).toBe(attempt.expectedActive!.revision! + 1);
    expect(data.activeWorkout?.completedExercises).toEqual([expect.objectContaining({ sessionId: result.sessionId, sets: [] })]);
    expect(data.activeWorkout?.currentExercise.exerciseId).toBeNull();
  });

  it("preserves facts, references and prior draft together when storage rejects the final commit", async () => {
    const web = await adapter();
    const attempt = await guidedAttempt(web);
    const before = storage.get(key);
    rejectWrite = true;
    await expect(web.recordWorkoutEntry(attempt)).rejects.toThrow("Browser storage is full.");
    expect(storage.get(key)).toBe(before);
    rejectWrite = false;
    const saved = await web.recordWorkoutEntry(attempt);
    expect((await web.loadAllData()).sessions.filter((row) => row.id === saved.sessionId)).toHaveLength(1);
  });

  it("retrieves a lost acknowledgement without clearing the next saved exercise", async () => {
    const web = await adapter();
    const attempt = await guidedAttempt(web);
    const first = await web.recordWorkoutEntry(attempt);
    const newer = await web.saveActiveWorkout({ ...first.activeWorkout!, currentExercise: { ...first.activeWorkout!.currentExercise, notes: "Next entry" } });
    const retry = await (await adapter()).recordWorkoutEntry(attempt);
    expect(retry).toEqual({ sessionId: first.sessionId, activeWorkout: newer });
    const loaded = await web.loadAllData();
    expect(loaded.activeWorkout).toEqual(newer);
    expect(loaded.workoutReferences.filter((ref) => ref.sessionId === first.sessionId)).toHaveLength(1);
    expect(loaded.sessions).toHaveLength(2);
    await expect(web.recordWorkoutEntry({ ...attempt, workoutId: "different-workout" })).rejects.toThrow(/another workout/i);
  });

  it("rejects unconfirmed suggestions at the adapter boundary", async () => {
    const web = await adapter();
    const attempt = await guidedAttempt(web);
    const unconfirmed = await web.saveActiveWorkout({ ...attempt.expectedActive!, currentExercise: { ...attempt.expectedActive!.currentExercise,
      sets: attempt.expectedActive!.currentExercise.sets.map(({ observationConfirmation: _confirmation, ...set }) => set) } });
    const before = storage.get(key);
    await expect(web.recordWorkoutEntry({ ...attempt, expectedActive: unconfirmed })).rejects.toThrow(/mark it as performed/i);
    expect(storage.get(key)).toBe(before);
    await expect(web.logWorkout(attempt)).rejects.toThrow(/confirmed atomic recording/i);
  });

  it("rejects a stale record and keeps its candidate for recovery without recording any work", async () => {
    const web = await adapter();
    const attempt = await guidedAttempt(web);
    const newer = await web.saveActiveWorkout({ ...attempt.expectedActive!, scheduleChanges: ["Newer saved plan"] });
    await expect(web.recordWorkoutEntry(attempt)).rejects.toThrow(/newer workout draft/i);
    const data = await (await adapter()).loadAllData();
    expect(data.activeWorkout).toEqual(newer);
    expect(data.sessions).toEqual(localData().sessions);
    expect(data.recoveredWorkoutDrafts.map((item) => item.draft)).toEqual([attempt.expectedActive]);
  });

  it("coordinates competing tabs and preserves the losing revision", async () => {
    const firstTab = await adapter();
    const secondTab = await adapter();
    const draft = (await firstTab.loadAllData()).activeWorkout!;
    const candidates = ["A", "B"].map((workoutLabel) => ({ ...draft, workoutLabel }));
    const results = await Promise.allSettled([firstTab.saveActiveWorkout(candidates[0]), secondTab.saveActiveWorkout(candidates[1])]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    const data = await firstTab.loadAllData();
    expect(data.activeWorkout).toMatchObject({ revision: 1, workoutLabel: "A" });
    expect(data.recoveredWorkoutDrafts.map((item) => item.draft)).toEqual([candidates[1]]);
    // Repeating the same uncertain save returns its saved revision.
    expect(await firstTab.saveActiveWorkout(candidates[0])).toEqual(data.activeWorkout);
  });

  it("serializes unrelated document writes with workout recording", async () => {
    const tabA = await adapter();
    const tabB = await adapter();
    await tabA.loadAllData();
    const recording: WorkoutRecordingInput = { ...input(), workoutId: "manual-workout", recordingOrigin: "manual", inputUnit: "lb", completedAt: timestamp };
    const [saved] = await Promise.all([tabA.recordWorkoutEntry(recording), tabB.updateUnitSystem("kg")]);
    const data = await tabA.loadAllData();
    expect(data.unitSystem).toBe("kg");
    expect(data.sessions.some((row) => row.id === saved.sessionId)).toBe(true);
    expect(data.workoutReferences).toContainEqual(expect.objectContaining({ workoutId: recording.workoutId, sessionId: saved.sessionId }));
  });

  it("fails safely when a browser cannot coordinate local writes", async () => {
    vi.stubGlobal("navigator", {});
    const web = await adapter();
    const original = storage.get(key);
    await expect(web.logWorkout(input())).rejects.toThrow(/Web Locks/i);
    expect(storage.get(key)).toBe(original);
    expect(await web.loadCurrentUser()).toEqual(user);
  });

  it("does not reuse a completed workout identity to start another lifecycle", async () => {
    const web = await adapter();
    const current = (await web.loadAllData()).activeWorkout!;
    await web.finalizeActiveWorkout(current.startedAt, null, current);
    await expect(web.saveActiveWorkout({ ...current, startedAt: "2026-07-02T12:00:00Z", revision: 0 })).rejects.toThrow(/another lifecycle/i);
    expect((await web.loadAllData()).activeWorkout).toBeNull();
  });

  it("preserves an invalid legacy active draft through initialization and refuses overwrite", async () => {
    const raw = { startedAt: timestamp, sourceNote: "Unknown legacy fields" };
    storage.set(key, JSON.stringify({ ...localData(), activeWorkout: raw }));
    const web = await adapter();
    await web.loadAllData();
    await expect(web.saveActiveWorkout(workout())).rejects.toThrow(/stored workout draft is invalid/i);
    expect(JSON.parse(storage.get(key)!).activeWorkout).toEqual(raw);
  });

  it("preserves raw legacy fields and defaults as evidence until an explicit save", async () => {
    const raw = { ...workout(), workoutId: undefined, revision: undefined, pendingMuscle: undefined,
      currentExercise: { muscle: null, exerciseId: null, sets: [], legacyExerciseField: 7 }, legacyField: { original: true } };
    storage.set(key, JSON.stringify({ ...localData(), activeWorkout: raw }));
    const web = await adapter();
    const first = await web.loadAllData();
    const stored = JSON.parse(storage.get(key)!).activeWorkout;
    expect(stored).toEqual({ ...JSON.parse(JSON.stringify(raw)), workoutId: first.activeWorkout!.workoutId, revision: 0 });
    expect(first.activeWorkoutSnapshot).toEqual(stored);
    expect(JSON.parse(storage.get(key)!).workoutActiveMigrationEvidence).toEqual(JSON.parse(JSON.stringify(raw)));
    expect(first.activeWorkout?.currentExercise.notes).toBe("");
    await web.updateUnitSystem("kg");
    expect(JSON.parse(storage.get(key)!).activeWorkout).toEqual(stored);
    const saved = await web.saveActiveWorkout(first.activeWorkout!);
    expect(saved).toMatchObject({ legacyField: { original: true }, currentExercise: { legacyExerciseField: 7 } });
  });

  it("preserves canonical links created before migration and does not re-run after intentional deletion", async () => {
    const record = standaloneWorkoutRecord("already-recorded");
    const reference = { workoutId: record.id, sessionId: 10, prescription: null, completedAt: timestamp };
    storage.set(key, JSON.stringify({ ...localData(), workoutRecords: [record], workoutReferences: [reference],
      completedGuidedWorkouts: [{ ...completed(), completedExercises: [{ sessionId: 10, exerciseId: input().exerciseId, exerciseName: "", muscle: "Chest", sets: [], completedAt: timestamp }] }] }));
    const web = await adapter();
    const migrated = await web.loadAllData();
    expect(migrated.workoutReferences).toEqual([reference]);
    await web.deleteWorkoutSession(10);
    const restarted = await (await adapter()).loadAllData();
    expect(restarted.workoutRecords).toEqual(migrated.workoutRecords);
    expect(restarted.workoutReferences).toEqual([]);
    expect(restarted.sessions).toEqual([]);
  });

  it("receives cloud draft conflicts as errors and original receipts as acknowledgements", async () => {
    const web = await adapter(true);
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Function unavailable" } });
    await expect(web.recordWorkoutEntry({ ...input(), workoutId: "manual", recordingOrigin: "manual", completedAt: timestamp })).rejects.toThrow(/Phase 3 database migration/i);
    client.rpc.mockResolvedValueOnce({ data: { conflict: true, current: workout() }, error: null });
    await expect(web.saveActiveWorkout({ ...workout(), workoutLabel: "Stale" })).rejects.toThrow(/newer workout draft/i);
    const recording: WorkoutRecordingInput = { ...input(), workoutId: "manual-workout", recordingOrigin: "manual", inputUnit: "lb", completedAt: timestamp };
    client.rpc.mockResolvedValueOnce({ data: { sessionId: 42, activeWorkout: null }, error: null });
    expect(await web.recordWorkoutEntry(recording)).toEqual({ sessionId: 42, activeWorkout: null });
    expect(client.rpc).toHaveBeenLastCalledWith("record_workout_entry", { p_input: recording });
  });

  it("initializes cloud references using existing authority and retains malformed raw archive evidence", async () => {
    const web = await adapter(true);
    const record = standaloneWorkoutRecord("already-recorded");
    const reference = { session_id: 10, workout_id: record.id, prescription: null, completed_at: timestamp };
    const archive = "Malformed original archive text";
    let active = JSON.stringify({ ...workout(), workoutId: undefined, revision: undefined, pendingMuscle: undefined, legacyField: true });
    client.from.mockImplementation((table: string) => {
      const filters = new Map<string, unknown>();
      function result() {
        if (table === "workout_records") return { data: [{ value: record }], error: null };
        if (table === "workout_entry_references") return { data: [reference], error: null };
        if (table === "exercises") return { data: localData().exercises, error: null };
        if (table === "workout_sessions") return { data: localData().sessions, error: null };
        if (table === "workout_sets") return { data: localData().sets, error: null };
        if (table === "app_settings" && filters.get("key") === "completed_guided_workouts") return { data: { value: archive }, error: null };
        if (table === "app_settings" && filters.get("key") === "active_workout") return { data: { value: active }, error: null };
        if (table === "app_settings" || table === "profiles" || table === "shared_training_splits") return { data: null, error: null };
        return { data: [], error: null };
      }
      const query = { select: () => query, order: () => query,
        eq: (field: string, value: unknown) => { filters.set(field, value); return query; }, maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
      return query;
    });
    client.rpc.mockImplementation(async (_name, params) => {
      expect(_name).toBe("initialize_workout_records");
      expect(params.p_references).toEqual([]);
      expect(params.p_records).toHaveLength(1); // active context only
      expect(params.p_records[0].kind).toBe("guided");
      expect(params.p_expected_archive).toBe(archive);
      active = JSON.stringify({ ...JSON.parse(active), workoutId: params.p_active_workout.workoutId, revision: 0 });
      return { data: null, error: null };
    });
    const data = await web.loadAllData();
    expect(data.workoutRecords).toEqual([record]);
    expect(data.workoutReferences).toEqual([{ workoutId: record.id, sessionId: 10, prescription: null, completedAt: timestamp }]);
    expect(data.workoutArchiveEvidence).toBe(archive);
    expect(data.completedGuidedWorkouts).toEqual([]);
    expect(data.activeWorkoutSnapshot).toMatchObject({ legacyField: true, revision: 0 });
    expect(data.activeWorkoutSnapshot).not.toHaveProperty("pendingMuscle");
  });
});


describe("Phase 6 committed browser imports", () => {
  function importInput() {
    const exercise = localData().exercises[0];
    return { bodyWeightLogs: [{ loggedDate: date, weight: 999, unit: "lb" as const }, { loggedDate: "2026-07-02", weight: 180, unit: "kg" as const, weightInputUnit: "kg" as const }],
      bodyMeasurementLogs: [{ loggedDate: "2026-07-02", weight: null, measurements: { waist: 81 }, circumferenceInputUnit: "cm" as const, notes: "Imported" }],
      workouts: [{ workoutDate: "2026-07-02", notes: "Imported", exerciseId: exercise.id, exerciseName: exercise.name, fingerprint: "external:source-one::original",
        inputUnit: "kg" as const, sets: [{ reps: 8, weight: 100, rir: 2 }, { reps: 7, weight: 100 }] }], exerciseIdsToEnable: [exercise.id], expectedAccountId: 1 };
  }
  it("preserves occupied dates, combines incoming body channels and returns actual committed counts", async () => {
    const web = await adapter();
    const original = localData().bodyMeasurementLogs[0];
    const result = await web.importTrainingData(importInput());
    expect(result).toEqual({ inserted: { bodyCheckIns: 1, workouts: 1, sets: 2 }, skipped: { bodyCheckIns: 1, workouts: 0 }, failed: 0 });
    const saved = await web.loadAllData();
    expect(saved.bodyMeasurementLogs.find((row) => row.id === original.id)).toMatchObject(original);
    expect(saved.bodyMeasurementLogs.find((row) => row.logged_date === "2026-07-02")).toMatchObject({ weight: 180, measurements: { waist: 81 }, weight_input_unit: "kg", circumference_input_unit: "cm" });
    expect(saved.sets.filter((set) => set.session_id !== 10).map((set) => set.rir)).toEqual([2, null]);
    expect(await web.importTrainingData(importInput())).toEqual({ inserted: { bodyCheckIns: 0, workouts: 0, sets: 0 }, skipped: { bodyCheckIns: 2, workouts: 1 }, failed: 0 });
    const id = saved.sessions.find((session) => session.id !== 10)!.id;
    await web.deleteWorkoutSession(id);
    expect((await web.importTrainingData(importInput())).skipped.workouts).toBe(1);
    const changed = importInput();
    changed.workouts[0] = { ...changed.workouts[0], notes: "Changed source", fingerprint: "external:source-one::changed", sets: [{ reps: 9, weight: 105, rir: 3 }] };
    expect((await web.importTrainingData(changed)).skipped.workouts).toBe(1);
    expect((await web.loadAllData()).sessions).toHaveLength(1);
    changed.workouts[0].fingerprint = "external:source-two::changed";
    expect((await web.importTrainingData(changed)).inserted.workouts).toBe(1);
  });
  it("imports every exercise of one external source workout and retires the source as a whole", async () => {
    const web = await adapter();
    const [bench, row] = localData().exercises;
    const entry = (exercise: typeof bench, reps: number) => ({ workoutDate: "2026-07-03", notes: "Source", exerciseId: exercise.id, exerciseName: exercise.name,
      fingerprint: `external:multi::2026-07-03::${exercise.name}::Source::${reps}x100`, inputUnit: "lb" as const, sets: [{ reps, weight: 100 }] });
    const input = { bodyWeightLogs: [], workouts: [entry(bench, 5), entry(row, 8)], exerciseIdsToEnable: [], expectedAccountId: 1 };
    expect(await web.importTrainingData(input)).toEqual({ inserted: { bodyCheckIns: 0, workouts: 2, sets: 2 }, skipped: { bodyCheckIns: 0, workouts: 0 }, failed: 0 });
    expect((await web.loadAllData()).sets.filter((set) => set.session_id !== 10).map((set) => set.exercise_id)).toEqual([bench.id, row.id]);
    const reexported = { ...input, workouts: [entry(bench, 6), entry(row, 8)] };
    expect(await web.importTrainingData(reexported)).toEqual({ inserted: { bodyCheckIns: 0, workouts: 0, sets: 0 }, skipped: { bodyCheckIns: 0, workouts: 2 }, failed: 0 });
  });
  it("refuses ambiguous local accounts and changed initiating accounts without writing", async () => {
    const web = await adapter();
    const initial = storage.get(key);
    await expect(web.importTrainingData({ ...importInput(), expectedAccountId: 2 })).rejects.toThrow(/account changed/i);
    expect(storage.get(key)).toBe(initial);
    storage.set(key, JSON.stringify({ ...localData(), users: [user, { ...user, id: 2 }] }));
    const before = storage.get(key);
    await expect(web.importTrainingData(importInput())).rejects.toThrow(/requires one account/i);
    expect(storage.get(key)).toBe(before);
  });
  it("preserves prior data if committing the imported document fails", async () => {
    const web = await adapter();
    const before = storage.get(key);
    rejectWrite = true;
    await expect(web.importTrainingData(importInput())).rejects.toThrow(/storage is full/i);
    expect(storage.get(key)).toBe(before);
  });
  it("returns server counts and binds the cloud RPC to the initiating account", async () => {
    const web = await adapter(true);
    const counts = { inserted: { bodyCheckIns: 0, workouts: 1, sets: 2 }, skipped: { bodyCheckIns: 2, workouts: 0 }, failed: 0 };
    client.rpc.mockResolvedValue({ data: counts, error: null });
    expect(await web.importTrainingData({ ...importInput(), expectedAccountId: cloudUser.id })).toEqual(counts);
    expect(client.rpc).toHaveBeenCalledWith("import_training_data_v6", expect.objectContaining({ p_expected_user: cloudUser.id }));
    client.rpc.mockClear();
    await expect(web.importTrainingData(importInput())).rejects.toThrow(/account changed/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("Phase 6 narrow social adapter", () => {
  it("loads permitted RPC projections without reading friend notes, private tags or emails", async () => {
    const web = await adapter(true);
    client.from.mockImplementation((table: string) => {
      const data = table === "friendships" ? [{ requester_id: cloudUser.id, addressee_id: "friend-b", status: "accepted", created_at: timestamp }]
        : table === "exercises" ? localData().exercises : [];
      const query: Record<string, unknown> = {};
      for (const method of ["select", "order", "eq", "is", "in"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null }));
      return query;
    });
    client.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "social_profiles"
      ? [{ id: cloudUser.id, name: "You", created_at: timestamp }, { id: "friend-b", name: "Friend", created_at: timestamp }]
      : name === "get_split_sync_members" ? [{ user_id: cloudUser.id }, { user_id: "friend-b" }]
      : { sessions: [], sets: [] } }));
    const result = await web.loadSocialData();
    expect(result.friends).toEqual([expect.objectContaining({ id: "friend-b", name: "Friend", email: null })]);
    expect(result.syncMemberIds).toEqual([cloudUser.id, "friend-b"]);
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(["friendships", "friend_invites", "exercises", "split_sync_requests"]);
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual(["social_profiles", "social_performance_records", "get_split_sync_members"]);
  });
});
