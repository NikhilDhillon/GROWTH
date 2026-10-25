import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { emptyActiveExercise, normalizeActiveWorkout, normalizeCompletedGuidedWorkouts } from "@/constants/activeWorkout";
import { catalogExercises, getExerciseLoadType, catalogExerciseRows } from "@/constants/exercises";
import { createDefaultGuidedWorkoutPreferences, normalizeGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { normalizeMachineProfiles } from "@/constants/machineProfiles";
import { normalizeTemplateExercises } from "@/services/workouts/templateExercises";
import { assertCustomExercise, customExerciseLimit, existingExerciseNamed, isCustomExercise } from "@/services/workouts/customExercises";
import { createDefaultTrainingSplit, normalizeTrainingSplit, upgradeUncustomisedTrainingSplit } from "@/constants/trainingSplit";
import { buildWorkoutFingerprint, ImportBodyMeasurementLog, ImportBodyWeightLog, ImportWorkoutLog } from "@/services/import/importService";
import { ActiveWorkout, BodyMeasurementLog, CustomExerciseInput, BodyMeasurementValues, BodyUnitPreferences, BodyWeightLog, CompletedGuidedWorkout, Exercise, ExerciseScorePoint, Friend, FriendInvite, GuidedWorkoutPreferences, LeaderboardEntry, MachineProfile, MuscleStrengthConfig, SocialData, TemplateExercises, TrainingSplit, TrainingSplitDay, UnitSystem, User, UserExercisePreference, WorkoutSession, WorkoutSet } from "@/types";
import { bodyMeasurementsFromLegacyWeights, defaultBodyUnitPreferences, normalizeBodyMeasurementLog, normalizeBodyUnitPreferences, parseStoredMeasurements } from "@/utils/bodyMeasurements";
import { assertWorkoutWrite, editedSetCaptureColumns, matchesWorkoutWritePayload, sameStoredJson, setCaptureColumns, WorkoutWriteInput, workoutWritePayload } from "@/database/workoutWrite";
import { assertCalendarDate } from "@/domain/calendar";
import { advanceWorkoutDraft, assertGuidedRecordingInput, committedWorkoutDraft, DraftConflictError, planWorkoutReferenceMigration, RecoveredWorkoutDraft, standaloneWorkoutRecord, WorkoutEntryReference, WorkoutRecord, WorkoutRecordingInput, WorkoutRecordingResult, workoutRecordFromDraft } from "@/domain/workoutLifecycle";
import { createRequestId } from "@/utils/requestId";
import { assertBodyCheckInWrite, BodyCheckInConflictError, BodyCheckInWriteInput, bodyCheckInObservationUnits, bodyCheckInSnapshot, bodyCheckInWritePayload, sameBodyCheckInSnapshot } from "@/domain/bodyCheckInRecording";
import { buildCanonicalLeaderboard } from "@/services/strength/leaderboardService";
import { committedImportResult, emptyImportResult, hasImportedWorkoutReceipt, importedBodyCheckIns, TrainingImportInput } from "./importPersistence";
import { webLocks } from "./webLocks";
import { todayIso } from "@/utils/date";
import { hashPassword, normalizeEmail } from "@/utils/password";

const storageKey = "growth.preview.database.v2";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

type WebDatabase = {
  workoutRecords: WorkoutRecord[];
  workoutReferences: WorkoutEntryReference[];
  workoutReferenceMigration?: boolean;
  recoveredWorkoutDrafts: RecoveredWorkoutDraft[];
  /** Immutable migration evidence, excluded from capture and completed-work calculations. */
  workoutActiveMigrationEvidence?: unknown;
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  bodyMeasurementLogs: BodyMeasurementLog[];
  bodyWeightLogs: BodyWeightLog[];
  bodyMeasurementMigration: "legacy_migrated" | "modern_authority" | "known_legacy_migrated_unknown_preserved";
  bodyMeasurementLegacyUnknownUnitCount?: number;
  workoutWriteRequests: Record<string, { sessionId: number | null; payload: string }>;
  bodyCheckInWriteRequests?: Record<string, { observationId: number; payload: string }>;
  /** Durable high-water marks prevent deleted IDs from being assigned to unrelated observations. */
  nextSessionId?: number;
  nextSetId?: number;
  nextBodyObservationId?: number;
  configs: MuscleStrengthConfig[];
  exercisePreferences: UserExercisePreference[];
  users: User[];
  currentUserId: number | null;
  unitSystem: UnitSystem;
  bodyUnitPreferences: BodyUnitPreferences;
  importFingerprints: string[];
  trainingSplit: TrainingSplit;
  activeWorkout: ActiveWorkout | null;
  /** Raw saved snapshot for CAS; never a second persisted draft. */
  activeWorkoutSnapshot?: ActiveWorkout | null;
  guidedWorkoutPreferences: GuidedWorkoutPreferences;
  completedGuidedWorkouts: CompletedGuidedWorkout[];
  /** Runtime view of the original archive; writeDatabase never stores this as another document. */
  workoutArchiveEvidence?: unknown;
  retiredActiveWorkouts: string[];
  machineProfiles: MachineProfile[];
  templateExercises: TemplateExercises;
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
  best_sets?: unknown;
  achieved_at: string;
  updated_at: string;
};

type SocialWorkoutSessionRow = WorkoutSession & { user_id: string };
type SocialWorkoutSetRow = WorkoutSet & { user_id: string };

type SharedTrainingSplitRow = {
  split_days: TrainingSplitDay[];
  updated_by_name: string | null;
  updated_at: string;
};

function now() {
  return new Date().toISOString();
}

/** Every local document mutation uses the same origin-wide lock, including unrelated preferences/body saves. */
async function withLocalDatabaseLock<T>(action: () => T): Promise<T> {
  const locks = webLocks();
  if (!locks) throw new Error("This browser cannot coordinate safe local saves. Open GROWTH in a browser with Web Locks support before changing local records.");
  return locks.request(storageKey, action);
}

function initializeLocalWorkoutRecords(data: WebDatabase, persist = true) {
  if (data.workoutReferenceMigration) return;
  const plan = planWorkoutReferenceMigration({ ...data, workoutArchiveEvidence: data.workoutArchiveEvidence ?? [] });
  data.workoutRecords = plan.records;
  data.workoutReferences = plan.references;
  const raw = data.activeWorkoutSnapshot ?? data.activeWorkout;
  if (raw && data.workoutActiveMigrationEvidence === undefined) data.workoutActiveMigrationEvidence = raw;
  data.activeWorkoutSnapshot = plan.activeWorkout && raw ? { ...raw, workoutId: plan.activeWorkout.workoutId, revision: plan.activeWorkout.revision } : raw;
  data.activeWorkout = normalizeActiveWorkout(data.activeWorkoutSnapshot);
  data.workoutReferenceMigration = true;
  if (persist) writeDatabase(data);
}

function seedDatabase(): WebDatabase {
  return { workoutRecords: [], workoutReferences: [], recoveredWorkoutDrafts: [], exercises: catalogExerciseRows(now()), sessions: [], sets: [], bodyMeasurementLogs: [], bodyWeightLogs: [], bodyMeasurementMigration: "modern_authority", workoutWriteRequests: {}, configs: [], exercisePreferences: [], users: [], currentUserId: null, unitSystem: "lb", bodyUnitPreferences: defaultBodyUnitPreferences, importFingerprints: [], trainingSplit: createDefaultTrainingSplit(), activeWorkout: null, guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences(), completedGuidedWorkouts: [], retiredActiveWorkouts: [], machineProfiles: [], templateExercises: {} };
}

function readDatabase(): WebDatabase {
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    const parsed = JSON.parse(existing) as Partial<WebDatabase>;
    const unitSystem: UnitSystem = parsed.unitSystem === "kg" ? "kg" : "lb";
    const exercises = normalizeCatalog(parsed.exercises ?? []);
    const hasModernBodyStore = Object.prototype.hasOwnProperty.call(parsed, "bodyMeasurementLogs");
    if (!hasModernBodyStore && parsed.bodyMeasurementMigration) throw new Error("Migrated body measurements are unavailable. Your legacy data has been preserved for recovery; it was not restored over deleted observations.");
    if (hasModernBodyStore && !Array.isArray(parsed.bodyMeasurementLogs)) throw new Error("Stored body measurements are invalid. Your stored data has been preserved.");
    const unknownLegacyUnits = hasModernBodyStore ? 0 : (parsed.bodyWeightLogs ?? []).filter((log) => log.unit !== "lb" && log.unit !== "kg").length;
    const bodyMeasurementMigration = parsed.bodyMeasurementMigration ?? (hasModernBodyStore ? "modern_authority"
      : unknownLegacyUnits ? "known_legacy_migrated_unknown_preserved" : "legacy_migrated");
    const bodyMeasurementLogs = hasModernBodyStore
      ? (parsed.bodyMeasurementLogs ?? []).map((log) => normalizeBodyMeasurementLog({ ...log, measurements: parseStoredMeasurements(log.measurements) }))
      : normalizeLocalBodyMeasurements(undefined, (parsed.bodyWeightLogs ?? []).filter((log) => log.unit === "lb" || log.unit === "kg"));
    if (parsed.bodyCheckInWriteRequests !== undefined && (!parsed.bodyCheckInWriteRequests || typeof parsed.bodyCheckInWriteRequests !== "object" || Array.isArray(parsed.bodyCheckInWriteRequests)
      || Object.values(parsed.bodyCheckInWriteRequests).some((receipt) => !receipt || !Number.isSafeInteger(receipt.observationId) || receipt.observationId <= 0 || typeof receipt.payload !== "string"))) {
      throw new Error("Stored body save attempts are invalid. Your observations and retry evidence have been preserved for recovery.");
    }
    const retiredActiveWorkouts = Array.isArray(parsed.retiredActiveWorkouts)
      ? parsed.retiredActiveWorkouts.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : Array.isArray(parsed.completedGuidedWorkouts)
        ? parsed.completedGuidedWorkouts.flatMap((workout) => workout && typeof workout.startedAt === "string" && workout.startedAt.trim() ? [workout.startedAt] : [])
        : [];
    const archiveSessionIds = [...(Array.isArray(parsed.completedGuidedWorkouts) ? parsed.completedGuidedWorkouts : []), ...(parsed.activeWorkout ? [parsed.activeWorkout] : [])]
      .flatMap((workout) => Array.isArray(workout?.completedExercises) ? workout.completedExercises.map((entry) => entry?.sessionId ?? 0) : []);
    const nextSessionId = observationCounter(parsed.nextSessionId, [...(parsed.sessions ?? []).map((row) => row.id),
      ...(parsed.sets ?? []).map((row) => row.session_id), ...archiveSessionIds,
      ...Object.values(parsed.workoutWriteRequests ?? {}).map((receipt) => receipt.sessionId ?? 0)]);
    const nextSetId = observationCounter(parsed.nextSetId, (parsed.sets ?? []).map((row) => row.id));
    const nextBodyObservationId = observationCounter(parsed.nextBodyObservationId, [...[...bodyMeasurementLogs, ...(parsed.bodyWeightLogs ?? [])].map((row) => row.id),
      ...Object.values(parsed.bodyCheckInWriteRequests ?? {}).map((receipt) => receipt.observationId)]);
    if (!parsed.bodyMeasurementMigration || !Array.isArray(parsed.retiredActiveWorkouts)) {
      // Write only the checkpoint and an unmistakably pre-modern conversion; keep originals.
      window.localStorage.setItem(storageKey, JSON.stringify({ ...parsed, bodyMeasurementMigration, retiredActiveWorkouts,
        nextSessionId, nextSetId, nextBodyObservationId,
        ...(unknownLegacyUnits ? { bodyMeasurementLegacyUnknownUnitCount: unknownLegacyUnits } : {}),
        ...(hasModernBodyStore ? {} : { bodyMeasurementLogs }) }));
    }
    return {
      ...parsed,
      workoutRecords: parsed.workoutRecords ?? [],
      workoutReferences: parsed.workoutReferences ?? [],
      recoveredWorkoutDrafts: parsed.recoveredWorkoutDrafts ?? [],
      bodyMeasurementMigration,
      ...(unknownLegacyUnits ? { bodyMeasurementLegacyUnknownUnitCount: unknownLegacyUnits } : {}),
      retiredActiveWorkouts,
      nextSessionId, nextSetId, nextBodyObservationId,
      workoutWriteRequests: parsed.workoutWriteRequests ?? {},
      bodyCheckInWriteRequests: parsed.bodyCheckInWriteRequests ?? {},
      exercises,
      sessions: parsed.sessions ?? [],
      sets: parsed.sets ?? [],
      bodyMeasurementLogs,
      bodyWeightLogs: parsed.bodyWeightLogs ?? [],
      configs: parsed.configs ?? [],
      exercisePreferences: parsed.exercisePreferences ?? [],
      users: parsed.users ?? [],
      currentUserId: parsed.currentUserId ?? null,
      unitSystem,
      bodyUnitPreferences: normalizeBodyUnitPreferences(parsed.bodyUnitPreferences),
      importFingerprints: Array.isArray(parsed.importFingerprints) ? parsed.importFingerprints.filter((value): value is string => typeof value === "string") : [],
      trainingSplit: upgradeUncustomisedTrainingSplit(normalizeTrainingSplit(parsed.trainingSplit)),
      activeWorkout: normalizeActiveWorkout(parsed.activeWorkout),
      activeWorkoutSnapshot: parsed.activeWorkout ?? null,
      guidedWorkoutPreferences: normalizeGuidedWorkoutPreferences(parsed.guidedWorkoutPreferences),
      completedGuidedWorkouts: normalizeCompletedGuidedWorkouts(parsed.completedGuidedWorkouts),
      workoutArchiveEvidence: parsed.completedGuidedWorkouts,
      machineProfiles: normalizeMachineProfiles(parsed.machineProfiles),
      templateExercises: normalizeTemplateExercises(parsed.templateExercises)
    };
  }
  const seeded = seedDatabase();
  writeDatabase(seeded);
  return seeded;
}

function writeDatabase(data: WebDatabase) {
  const { workoutArchiveEvidence, activeWorkoutSnapshot: _snapshot, ...stored } = data;
  window.localStorage.setItem(storageKey, JSON.stringify({ ...stored,
    activeWorkout: activeWorkoutSnapshotValue(data),
    ...(workoutArchiveEvidence !== undefined ? { completedGuidedWorkouts: workoutArchiveEvidence } : {}) }));
}

function activeWorkoutSnapshotValue(data: WebDatabase) {
  return data.activeWorkoutSnapshot !== undefined ? data.activeWorkoutSnapshot : data.activeWorkout;
}

function parseArchiveEvidence(value?: string): unknown {
  if (!value) return [];
  try { return JSON.parse(value); } catch { return value; }
}

function observationCounter(stored: number | undefined, ids: number[]) {
  if (stored !== undefined && (!Number.isSafeInteger(stored) || stored < 1)) {
    throw new Error("Stored observation identity state is invalid. Your data has been preserved.");
  }
  const highest = ids.reduce((maximum, id) => Number.isSafeInteger(id) && id > maximum ? id : maximum, 0);
  const next = Math.max(stored ?? 1, highest + 1);
  if (!Number.isSafeInteger(next)) throw new Error("Observation identities are exhausted. Your data has been preserved.");
  return next;
}

function allocateObservationId(data: WebDatabase, kind: "session" | "set" | "body") {
  const key = kind === "session" ? "nextSessionId" : kind === "set" ? "nextSetId" : "nextBodyObservationId";
  const rows = kind === "session" ? data.sessions : kind === "set" ? data.sets : data.bodyMeasurementLogs;
  const id = observationCounter(data[key], rows.map((row) => row.id));
  if (!Number.isSafeInteger(id + 1)) throw new Error("Observation identities are exhausted. Your data has been preserved.");
  data[key] = id + 1;
  return id;
}

function preserveLocalDraft(data: WebDatabase, draft: ActiveWorkout) {
  if (!data.recoveredWorkoutDrafts.some((record) => sameStoredJson(record.draft, draft))) {
    data.recoveredWorkoutDrafts.push({ id: createRequestId(), savedAt: now(), draft });
  }
  writeDatabase(data);
}

function writeWorkoutSession(data: WebDatabase, input: WorkoutWriteInput) {
  const receipt = input.requestId ? data.workoutWriteRequests[input.requestId] : undefined;
  if (receipt) {
    if (!matchesWorkoutWritePayload(receipt.payload, input)) throw new Error("This save attempt already has different values. Resolve the previous attempt before recording another.");
    if (receipt.sessionId === null || !data.sessions.some((session) => session.id === receipt.sessionId)) throw new Error("This recorded workout was deleted. An old retry cannot recreate it.");
    return receipt.sessionId;
  }
  const sessionId = allocateObservationId(data, "session");
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;
  data.sessions.push({ id: sessionId, workout_date: input.workoutDate, notes: input.notes, machine_profile_id: input.machineProfileId ?? null,
    input_unit: input.inputUnit ?? null, recording_origin: input.recordingOrigin ?? null, created_at: timestamp });
  for (const [index, set] of input.sets.entries()) data.sets.push({ id: allocateObservationId(data, "set"), session_id: sessionId,
    exercise_id: input.exerciseId, set_number: index + 1, reps: set.reps, weight: set.weight, rir: null, is_warmup: Boolean(set.isWarmup),
    ...setCaptureColumns(set), created_at: timestamp });
  if (input.requestId) data.workoutWriteRequests[input.requestId] = { sessionId, payload: workoutWritePayload(input) };
  return sessionId;
}

export async function recordWorkoutEntry(input: WorkoutRecordingInput): Promise<WorkoutRecordingResult> {
  assertWorkoutWrite(input);
  if (!input.requestId || !input.workoutId) throw new Error("A recording requires stable workout and retry identities.");
  if (input.recordingOrigin !== "guided" && input.recordingOrigin !== "manual") throw new Error("A manual or guided recording origin is required.");
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("record_workout_entry", { p_input: input });
    throwIfSafetyRpcError(result.error, "Phase 3");
    if (result.data?.conflict && input.expectedActive) throw new DraftConflictError(input.expectedActive, result.data.current ?? null);
    const sessionId = Number(result.data?.sessionId);
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error("The server did not confirm the saved entry. Keep this draft and retry.");
    return { sessionId, activeWorkout: normalizeActiveWorkout(result.data.activeWorkout) };
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    initializeLocalWorkoutRecords(data);
    const receipt = data.workoutWriteRequests[input.requestId!];
    if (receipt) {
      const sessionId = writeWorkoutSession(data, input);
      const reference = data.workoutReferences.find((reference) => reference.sessionId === sessionId);
      if (reference && reference.workoutId !== input.workoutId) throw new Error("This saved entry belongs to another workout. An old retry cannot move it.");
      return { sessionId, activeWorkout: data.activeWorkout };
    }
    let nextActive = data.activeWorkout;
    if (input.recordingOrigin === "guided") {
      const exercise = data.exercises.find((exercise) => exercise.id === input.exerciseId);
      if (!exercise) throw new Error("Choose an existing exercise before recording.");
      assertGuidedRecordingInput(input, exercise);
      if (!data.activeWorkout || !sameStoredJson(data.activeWorkout, input.expectedActive)) {
        preserveLocalDraft(data, input.expectedActive!);
        throw new DraftConflictError(input.expectedActive!, data.activeWorkout);
      }
      const record = data.workoutRecords.find((record) => record.id === input.workoutId);
      if (!record || record.status !== "active" || record.kind !== "guided") throw new Error("This guided workout is no longer active.");
    } else if (input.expectedActive) throw new Error("Manual recording cannot advance a guided draft.");
    else if (data.workoutRecords.some((record) => record.id === input.workoutId)) throw new Error("This workout identity is already used. Retry the original attempt or begin another recording.");
    const sessionId = writeWorkoutSession(data, input);
    if (input.recordingOrigin === "guided") {
      nextActive = committedWorkoutDraft(data.activeWorkout!, input, sessionId);
      data.activeWorkout = nextActive;
      data.activeWorkoutSnapshot = nextActive;
    } else data.workoutRecords.push(standaloneWorkoutRecord(input.workoutId));
    data.workoutReferences.push({ workoutId: input.workoutId, sessionId, completedAt: input.completedAt,
      prescription: input.expectedActive?.currentExercise.prescription ?? null });
    writeDatabase(data);
    return { sessionId, activeWorkout: nextActive };
  });
}

export async function loadCurrentUser(): Promise<User | null> {
  if (supabase) {
    const result = await supabase.auth.getSession();
    throwIfSupabaseError(result.error);
    return result.data.session?.user ? cloudUserToAppUser(result.data.session.user, null) : null;
  }
  // Identity lookup must not run body/catalog normalization or write storage.
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  const data = JSON.parse(raw) as Partial<WebDatabase>;
  if (data.currentUserId == null) return null;
  if (!Array.isArray(data.users)) throw new Error("Stored account state could not be read. Retry without clearing your data.");
  return data.users.find((user) => user.id === data.currentUserId) ?? null;
}

export async function loadAllData() {
  if (supabase) return loadCloudData(supabase);
  const data = await withLocalDatabaseLock(() => {
    const current = readDatabase();
    initializeLocalWorkoutRecords(current);
    return current;
  });
  const currentUser = data.users.find((user) => user.id === data.currentUserId) ?? null;
  return {
    exercises: withPreferenceFlags(data.exercises, data.exercisePreferences, data.currentUserId).sort((a, b) => a.name.localeCompare(b.name)),
    sessions: [...data.sessions].sort((a, b) => b.workout_date.localeCompare(a.workout_date)),
    sets: [...data.sets].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.set_number - b.set_number),
    bodyMeasurementLogs: [...data.bodyMeasurementLogs].sort((a, b) => b.logged_at.localeCompare(a.logged_at) || b.created_at.localeCompare(a.created_at)),
    configs: [...data.configs].sort((a, b) => a.muscle_group.localeCompare(b.muscle_group)),
    currentUser,
    unitSystem: data.unitSystem,
    bodyUnitPreferences: data.bodyUnitPreferences,
    trainingSplit: data.trainingSplit,
    activeWorkout: data.activeWorkout,
    activeWorkoutSnapshot: data.activeWorkoutSnapshot,
    guidedWorkoutPreferences: data.guidedWorkoutPreferences,
    completedGuidedWorkouts: data.completedGuidedWorkouts,
    workoutArchiveEvidence: data.workoutArchiveEvidence,
    machineProfiles: data.machineProfiles,
    templateExercises: data.templateExercises,
    workoutRecords: data.workoutRecords, workoutReferences: data.workoutReferences, recoveredWorkoutDrafts: data.recoveredWorkoutDrafts
  };
}

async function loadCloudData(client: SupabaseClient) {
  const user = await requireCloudUser(client, false);
  if (!user) {
    return { exercises: [], sessions: [], sets: [], bodyMeasurementLogs: [], configs: [], currentUser: null, unitSystem: "lb" as UnitSystem, bodyUnitPreferences: defaultBodyUnitPreferences, trainingSplit: createDefaultTrainingSplit(), activeWorkout: null, activeWorkoutSnapshot: null, guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences(), completedGuidedWorkouts: [], machineProfiles: [], templateExercises: {}, workoutRecords: [], workoutReferences: [], recoveredWorkoutDrafts: [] };
  }

  const [profileResult, exercisesResult, preferencesResult, sessionsResult, setsResult, bodyMeasurementResult, bodyWeightResult, configsResult, settingResult, bodyUnitResult, activeWorkoutResult, guidedWorkoutResult, completedWorkoutsResult, machineProfilesResult, bodyMigrationResult, templateExercisesResult] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).maybeSingle<ProfileRow>(),
    client.from("exercises").select("*").order("name"),
    client.from("user_exercise_preferences").select("*").eq("user_id", user.id),
    client.from("workout_sessions").select("*").eq("user_id", user.id).order("workout_date", { ascending: false }),
    client.from("workout_sets").select("*").eq("user_id", user.id).order("created_at").order("set_number"),
    client.from("body_measurement_logs").select("*").eq("user_id", user.id).order("logged_date", { ascending: false }).order("created_at", { ascending: false }),
    client.from("body_weight_logs").select("*").eq("user_id", user.id).order("logged_date", { ascending: false }).order("created_at", { ascending: false }),
    client.from("muscle_strength_config").select("*").order("muscle_group"),
    client.from("app_settings").select("value").eq("key", "unit_system").maybeSingle<{ value: UnitSystem }>(),
    client.from("app_settings").select("value").eq("key", "body_unit_preferences").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("key", "active_workout").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("key", "guided_workout_preferences").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("key", "completed_guided_workouts").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("key", "machine_profiles").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("user_id", user.id).eq("key", "body_measurements_legacy_migrated").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("user_id", user.id).eq("key", "workout_template_exercises").maybeSingle<{ value: string }>()
  ]);

  throwIfSupabaseError(profileResult.error);
  throwIfSupabaseError(exercisesResult.error);
  throwIfSupabaseError(preferencesResult.error);
  throwIfSupabaseError(sessionsResult.error);
  throwIfSupabaseError(setsResult.error);
  if (bodyMeasurementResult.error && !isMissingBodyMeasurementTableError(bodyMeasurementResult.error)) {
    throwIfSupabaseError(bodyMeasurementResult.error);
  }
  if (bodyWeightResult.error && !isMissingBodyWeightTableError(bodyWeightResult.error)) {
    throwIfSupabaseError(bodyWeightResult.error);
  }
  throwIfSupabaseError(configsResult.error);
  throwIfSupabaseError(settingResult.error);
  throwIfSupabaseError(bodyUnitResult.error);
  throwIfSupabaseError(activeWorkoutResult.error);
  throwIfSupabaseError(guidedWorkoutResult.error);
  throwIfSupabaseError(completedWorkoutsResult.error);
  throwIfSupabaseError(machineProfilesResult.error);
  throwIfSupabaseError(bodyMigrationResult.error);
  throwIfSupabaseError(templateExercisesResult.error);
  if (bodyMeasurementResult.error && bodyMigrationResult.data) throw new Error("Migrated body measurements are unavailable. Retry loading after their data store is restored; legacy copies have not replaced deleted observations.");

  const preferences = (preferencesResult.data ?? []) as UserExercisePreference[];
  const trainingSplit = await loadCloudTrainingSplit(client, user.id);
  const legacyBodyWeightLogs = normalizeBodyWeightLogs(bodyWeightResult.error ? [] : (bodyWeightResult.data ?? []) as BodyWeightLog[]);
  const bodyMeasurementLogs = bodyMeasurementResult.error
    ? legacyBodyWeightLogs.map(bodyMeasurementFromLegacyWeight)
    : ((bodyMeasurementResult.data ?? []) as Array<Partial<BodyMeasurementLog> & { id: number }>).map((row) =>
        normalizeBodyMeasurementLog({ ...row, measurements: parseStoredMeasurements(row.measurements) })
      );
  const rawActive: unknown = activeWorkoutResult.data?.value ? JSON.parse(activeWorkoutResult.data.value) : null;
  const rawArchive = parseArchiveEvidence(completedWorkoutsResult.data?.value);
  const migration = await client.from("app_settings").select("value").eq("user_id", user.id).eq("key", "workout_reference_migration_v1").maybeSingle<{ value: string }>();
  throwIfSupabaseError(migration.error);
  if (migration.data?.value !== "true") {
    const [existingRecords, existingReferences] = await Promise.all([
      client.from("workout_records").select("value").eq("user_id", user.id),
      client.from("workout_entry_references").select("*").eq("user_id", user.id)
    ]);
    throwIfSupabaseError(existingRecords.error);
    throwIfSupabaseError(existingReferences.error);
    const records = (existingRecords.data ?? []).map((row: { value: WorkoutRecord }) => row.value);
    const references: WorkoutEntryReference[] = (existingReferences.data ?? []).map((row: { workout_id: string; session_id: number; prescription: WorkoutEntryReference["prescription"]; completed_at: string | null }) => ({
      workoutId: row.workout_id, sessionId: row.session_id, prescription: row.prescription, completedAt: row.completed_at
    }));
    const plan = planWorkoutReferenceMigration({ sessions: sessionsResult.data ?? [], sets: setsResult.data ?? [], exercises: cloudExercises(exercisesResult.data),
      activeWorkout: normalizeActiveWorkout(rawActive), workoutArchiveEvidence: rawArchive, workoutRecords: records, workoutReferences: references });
    const result = await client.rpc("initialize_workout_records", {
      p_records: plan.records.filter((record) => !records.some((existing) => existing.id === record.id)),
      p_references: plan.references.filter((reference) => !references.some((existing) => existing.sessionId === reference.sessionId)),
      p_expected_active: rawActive, p_expected_archive: rawArchive,
      p_active_workout: plan.activeWorkout
    });
    throwIfSafetyRpcError(result.error, "Phase 3");
  }
  const [recordResult, referenceResult, recoveryResult, migratedActive] = await Promise.all([
    client.from("workout_records").select("value").eq("user_id", user.id),
    client.from("workout_entry_references").select("*").eq("user_id", user.id),
    client.from("app_settings").select("value").eq("user_id", user.id).eq("key", "recovered_workout_drafts").maybeSingle<{ value: string }>(),
    client.from("app_settings").select("value").eq("user_id", user.id).eq("key", "active_workout").maybeSingle<{ value: string }>()
  ]);
  for (const result of [recordResult, referenceResult, recoveryResult, migratedActive]) throwIfSupabaseError(result.error);
  return {
    workoutRecords: (recordResult.data ?? []).map((row: { value: WorkoutRecord }) => row.value),
    workoutReferences: (referenceResult.data ?? []).map((row: { workout_id: string; session_id: number; prescription: WorkoutEntryReference["prescription"]; completed_at: string | null }) => ({
      workoutId: row.workout_id, sessionId: row.session_id, prescription: row.prescription, completedAt: row.completed_at
    })),
    recoveredWorkoutDrafts: recoveryResult.data?.value ? JSON.parse(recoveryResult.data.value) as RecoveredWorkoutDraft[] : [],
    exercises: withPreferenceFlags(cloudExercises(exercisesResult.data), preferences, user.id),
    sessions: (sessionsResult.data ?? []) as WorkoutSession[],
    sets: (setsResult.data ?? []) as WorkoutSet[],
    bodyMeasurementLogs,
    configs: (configsResult.data ?? []) as MuscleStrengthConfig[],
    currentUser: cloudUserToAppUser(user, profileResult.data),
    unitSystem: settingResult.data?.value === "kg" ? "kg" : "lb",
    bodyUnitPreferences: normalizeBodyUnitPreferences(bodyUnitResult.data?.value ? JSON.parse(bodyUnitResult.data.value) : null),
    trainingSplit,
    activeWorkout: normalizeActiveWorkout(migratedActive.data?.value ? JSON.parse(migratedActive.data.value) : null),
    activeWorkoutSnapshot: migratedActive.data?.value ? JSON.parse(migratedActive.data.value) as ActiveWorkout : null,
    guidedWorkoutPreferences: normalizeGuidedWorkoutPreferences(guidedWorkoutResult.data?.value ? JSON.parse(guidedWorkoutResult.data.value) : null),
    completedGuidedWorkouts: normalizeCompletedGuidedWorkouts(rawArchive),
    workoutArchiveEvidence: rawArchive,
    machineProfiles: normalizeMachineProfiles(machineProfilesResult.data?.value ? JSON.parse(machineProfilesResult.data.value) : null),
    templateExercises: normalizeTemplateExercises(templateExercisesResult.data?.value ? JSON.parse(templateExercisesResult.data.value) : null)
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

  return withLocalDatabaseLock(() => {
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
  });
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

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const email = normalizeEmail(input.email);
    const user = data.users.find((item) => item.email === email);
    if (!user || user.password_hash !== hashPassword(input.password, email)) {
      throw new Error("Email or password is incorrect.");
    }

    data.currentUserId = Number(user.id);
    writeDatabase(data);
    return user;
  });
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

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.currentUserId = null;
    writeDatabase(data);
  });
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

  return withLocalDatabaseLock(() => {
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
  });
}

export async function createCustomExercise(input: CustomExerciseInput): Promise<Exercise> {
  const exercise = assertCustomExercise(input);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase.rpc("create_custom_exercise", { p_name: exercise.name, p_primary_muscle: exercise.primaryMuscle, p_load_type: exercise.loadType });
    throwIfSupabaseError(result.error);
    const [created] = cloudExercises(result.data ? [result.data] : []);
    if (!created || !Number.isSafeInteger(created.id) || created.id <= 0) throw new Error("The server did not confirm the new exercise. Try again.");
    return { ...created, is_strength_exercise: 0 };
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (!data.currentUserId) throw new Error("Please log in again.");
    // On-device data is shared by every local account, so names are unique on the device.
    const existing = existingExerciseNamed(data.exercises, exercise.name);
    if (existing && !isCustomExercise(existing)) throw new Error(`${existing.name} is already in the exercise list.`);
    if (existing) {
      if (existing.primary_muscle === exercise.primaryMuscle && existing.load_type === exercise.loadType) return { ...existing };
      throw new Error(`You already have an exercise named ${existing.name}.`);
    }
    if (data.exercises.filter(isCustomExercise).length >= customExerciseLimit) throw new Error(`You can keep up to ${customExerciseLimit} personal exercises.`);
    const created: Exercise = {
      id: Math.max(0, ...data.exercises.map((item) => item.id)) + 1, name: exercise.name, primary_muscle: exercise.primaryMuscle, secondary_muscle: null,
      is_strength_exercise: 0, created_at: now(), creator_id: data.currentUserId, load_type: exercise.loadType
    };
    data.exercises.push(created);
    writeDatabase(data);
    return { ...created };
  });
}

export async function logWorkout(input: WorkoutWriteInput): Promise<number> {
  assertWorkoutWrite(input);
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("save_workout_session", {
      p_exercise_id: input.exerciseId, p_workout_date: input.workoutDate, p_notes: input.notes,
      p_machine_profile_id: input.machineProfileId ?? null, p_sets: input.sets,
      p_session_id: null, p_request_id: input.requestId ?? null,
      ...(input.inputUnit ? { p_input_unit: input.inputUnit } : {}),
      ...(input.recordingOrigin ? { p_recording_origin: input.recordingOrigin } : {})
    });
    throwIfSafetyRpcError(result.error);
    const id = Number(result.data);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("The server did not return the saved workout identity. Keep this draft and retry.");
    return id;
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    initializeLocalWorkoutRecords(data);
    const isRetry = Boolean(input.requestId && data.workoutWriteRequests[input.requestId]);
    if (!isRetry && input.recordingOrigin === "guided") throw new Error("New guided observations require confirmed atomic recording.");
    const sessionId = writeWorkoutSession(data, input);
    if (!isRetry) {
      const record = standaloneWorkoutRecord(createRequestId());
      data.workoutRecords.push(record);
      data.workoutReferences.push({ workoutId: record.id, sessionId, prescription: null, completedAt: null });
    }
    writeDatabase(data);
    return sessionId;
  });
}

export async function importTrainingData(input: TrainingImportInput) {
  const bodyRows = importedBodyCheckIns(input);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user || input.expectedAccountId !== undefined && input.expectedAccountId !== user.id) throw new Error("Your account changed. Review the import before retrying.");
    const result = await supabase.rpc("import_training_data_v6", {
      p_expected_user: user.id,
      p_body_weights: input.bodyWeightLogs, p_body_measurements: input.bodyMeasurementLogs ?? [],
      p_workouts: input.workouts, p_exercise_ids: input.exerciseIdsToEnable
    });
    throwIfSafetyRpcError(result.error, "Phase 6");
    return committedImportResult(result.data);
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (!data.currentUserId) throw new Error("Please log in again.");
    if (input.expectedAccountId !== undefined && input.expectedAccountId !== data.currentUserId) throw new Error("Your account changed. Review the import before retrying.");
    if (data.users.length !== 1) throw new Error("Local import requires one account because existing local history has no account ownership. Use a cloud account to import separately.");
    const result = emptyImportResult();
    const timestamp = now();
    const occupiedDates = new Set(data.bodyMeasurementLogs.map((log) => log.logged_date));
    for (const log of bodyRows) {
      if (occupiedDates.has(log.loggedDate)) { result.skipped.bodyCheckIns++; continue; }
      data.bodyMeasurementLogs.push(normalizeBodyMeasurementLog({
        id: allocateObservationId(data, "body"), weight: log.weight, measurements: log.measurements,
        weight_input_unit: log.weight == null ? null : log.weightInputUnit ?? null,
        circumference_input_unit: Object.keys(log.measurements).length ? log.circumferenceInputUnit ?? null : null,
        notes: log.notes, logged_at: `${log.loggedDate}T12:00:00.000Z`, logged_date: log.loggedDate,
        created_at: timestamp, updated_at: timestamp
      }));
      occupiedDates.add(log.loggedDate);
      result.inserted.bodyCheckIns++;
    }

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

    const priorReceipts = new Set(data.importFingerprints);
    const importedFingerprints = new Set(priorReceipts);
    const existingFingerprints = getExistingWorkoutFingerprints(data.exercises, data.sessions, data.sets);

    for (const workout of input.workouts) {
      if (hasImportedWorkoutReceipt(priorReceipts, importedFingerprints, workout.fingerprint) || existingFingerprints.has(workout.fingerprint)) { result.skipped.workouts++; continue; }

      const sessionId = allocateObservationId(data, "session");
      const workoutId = createRequestId();
      data.workoutRecords.push(standaloneWorkoutRecord(workoutId));
      data.workoutReferences.push({ workoutId, sessionId, prescription: null, completedAt: null });
      const createdAt = `${workout.workoutDate}T12:00:00.000Z`;
      data.sessions.push({
        id: sessionId,
        workout_date: workout.workoutDate,
        notes: workout.notes,
        input_unit: workout.inputUnit ?? null,
        recording_origin: "import",
        created_at: createdAt
      });

      for (const [index, set] of workout.sets.entries()) {
        data.sets.push({
          id: allocateObservationId(data, "set"),
          session_id: sessionId,
          exercise_id: workout.exerciseId,
          set_number: index + 1,
          reps: set.reps,
          weight: set.weight,
          rir: set.rir ?? null,
          is_warmup: Boolean(set.isWarmup),
          created_at: createdAt
        });
      }

      result.inserted.workouts++;
      result.inserted.sets += workout.sets.length;
      importedFingerprints.add(workout.fingerprint);
      existingFingerprints.add(workout.fingerprint);
    }

    data.importFingerprints = [...importedFingerprints];
    writeDatabase(data);
    return result;
  });
}

export async function deleteWorkoutSession(sessionId: number) {
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    // The FK cascades set deletion in the same server statement.
    const result = await supabase.from("workout_sessions").delete().eq("id", sessionId).eq("user_id", user.id);
    throwIfSupabaseError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.sets = data.sets.filter((set) => set.session_id !== sessionId);
    data.sessions = data.sessions.filter((session) => session.id !== sessionId);
    data.workoutReferences = data.workoutReferences.filter((reference) => reference.sessionId !== sessionId);
    for (const receipt of Object.values(data.workoutWriteRequests)) if (receipt.sessionId === sessionId) receipt.sessionId = null;
    writeDatabase(data);
  });
}

export async function recordBodyCheckIn(input: BodyCheckInWriteInput): Promise<BodyMeasurementLog> {
  assertBodyCheckInWrite(input);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (input.accountId !== undefined && String(input.accountId) !== user?.id) throw new BodyCheckInConflictError("The signed-in account changed. Return to the original account before saving this check-in.");
    const result = await supabase.rpc("record_body_check_in", { p_input: { ...JSON.parse(bodyCheckInWritePayload(input)), requestId: input.requestId } });
    throwIfBodyCheckInRpcError(result.error);
    if (!result.data || typeof result.data !== "object" || !Number.isSafeInteger(Number(result.data.id))) throw new Error("The saved check-in acknowledgement is unavailable. Retry the same save attempt.");
    return normalizeBodyMeasurementLog({ ...result.data, measurements: parseStoredMeasurements(result.data.measurements) });
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const owner = data.currentUserId ?? "preview";
    if (input.accountId !== undefined && String(input.accountId) !== String(owner)) throw new BodyCheckInConflictError("The signed-in account changed. Return to the original account before saving this check-in.");
    const key = `${owner}:${input.requestId}`;
    const payload = JSON.stringify({ owner, input: JSON.parse(bodyCheckInWritePayload(input)) });
    const requests = data.bodyCheckInWriteRequests ?? {};
    const receipt = requests[key];
    if (receipt) {
      if (receipt.payload !== payload) throw new Error("This save attempt already has different values. Resolve the previous attempt before recording another.");
      const recorded = data.bodyMeasurementLogs.find((row) => row.id === receipt.observationId);
      if (!recorded) throw new BodyCheckInConflictError("This body check-in was deleted. An old retry cannot recreate it.");
      return recorded;
    }
    const previous = input.id === undefined ? undefined : data.bodyMeasurementLogs.find((row) => row.id === input.id);
    if (input.id !== undefined && !previous) throw new BodyCheckInConflictError("This body check-in no longer exists. Reload before editing it.");
    if (previous && (!input.expected || !sameBodyCheckInSnapshot(previous, input.expected) || !matchesRawBodySnapshot(input.expected))) throw new BodyCheckInConflictError("This body check-in changed elsewhere or contains unresolved historical values. Reload before editing it; your entered values have been preserved.");
    if (data.bodyMeasurementLogs.some((row) => row.logged_date === input.loggedDate && row.id !== input.id)) throw new BodyCheckInConflictError("A body check-in already exists for this date. Open that check-in to edit it.");
    const timestamp = now();
    const saved = normalizeBodyMeasurementLog({
      id: previous?.id ?? allocateObservationId(data, "body"), weight: input.weight, measurements: input.measurements,
      notes: input.notes?.trim() || null, logged_date: input.loggedDate, logged_at: `${input.loggedDate}T12:00:00.000Z`,
      created_at: previous?.created_at ?? timestamp, updated_at: timestamp, ...bodyCheckInObservationUnits(input)
    });
    data.bodyMeasurementLogs = [saved, ...rawLocalBodyRows(data).filter((row) => row.id !== saved.id)];
    data.bodyCheckInWriteRequests = { ...requests, [key]: { observationId: saved.id, payload } };
    writeDatabase(data);
    return saved;
  });
}

export async function deleteBodyCheckIn(id: number, expected?: BodyMeasurementLog, accountId?: number | string): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new BodyCheckInConflictError("Reload this body check-in before deleting it.");
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (accountId !== undefined && String(accountId) !== user?.id) throw new BodyCheckInConflictError("The signed-in account changed. Return to the original account before deleting this check-in.");
    const result = await supabase.rpc("delete_body_check_in", { p_id: id, p_expected: expected ? bodyCheckInSnapshot(expected) : null, p_expected_account: accountId ?? null });
    throwIfBodyCheckInRpcError(result.error);
    return;
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (accountId !== undefined && String(accountId) !== String(data.currentUserId ?? "preview")) throw new BodyCheckInConflictError("The signed-in account changed. Return to the original account before deleting this check-in.");
    const previous = data.bodyMeasurementLogs.find((row) => row.id === id);
    if (!previous) return;
    if (expected && (!sameBodyCheckInSnapshot(previous, expected) || !matchesRawBodySnapshot(expected))) throw new BodyCheckInConflictError("This body check-in changed elsewhere or contains unresolved historical values. Reload before deleting it.");
    data.bodyMeasurementLogs = rawLocalBodyRows(data).filter((row) => row.id !== id);
    writeDatabase(data);
  });
}

function throwIfBodyCheckInRpcError(error: { message: string; code?: string } | null) {
  if (error && /check-in (already exists|changed elsewhere|no longer exists|was deleted)|signed-in account changed/i.test(error.message)) throw new BodyCheckInConflictError(error.message);
  throwIfSafetyRpcError(error, "Phase 5 body check-in");
}

function matchesRawBodySnapshot(expected: BodyMeasurementLog) {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return false;
  const rows = JSON.parse(raw).bodyMeasurementLogs;
  if (!Array.isArray(rows)) return false;
  const matching = rows.filter((row: BodyMeasurementLog) => row.id === expected.id);
  if (matching.length !== 1) return false;
  const stored = matching[0];
  // A normalized UI projection must not authorize erasing malformed/extra raw
  // evidence. Historical ambiguity needs explicit reconciliation instead.
  const measurements = typeof stored.measurements === "string" ? JSON.parse(stored.measurements) : stored.measurements;
  return sameStoredJson(bodyCheckInSnapshot({ ...stored, measurements }), bodyCheckInSnapshot(expected));
}

function rawLocalBodyRows(data: WebDatabase): BodyMeasurementLog[] {
  const raw = window.localStorage.getItem(storageKey);
  const rows = raw ? JSON.parse(raw).bodyMeasurementLogs : undefined;
  return Array.isArray(rows) ? rows : data.bodyMeasurementLogs;
}

export async function saveBodyWeightLog(input: { loggedDate: string; weight: number; unit: UnitSystem }) {
  assertCalendarDate(input.loggedDate);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase.from("body_measurement_logs").upsert(
      {
        user_id: user.id,
        logged_date: input.loggedDate,
        weight: input.weight,
        updated_at: now(),
        created_at: `${input.loggedDate}T12:00:00.000Z`
      },
      { onConflict: "user_id,logged_date" }
    );
    if (result.error && isMissingBodyMeasurementTableError(result.error)) {
      throw new Error("Body measurements need the Supabase schema update for body_measurement_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const existing = data.bodyMeasurementLogs.find((log) => log.logged_date === input.loggedDate);
    const timestamp = now();
    const row = normalizeBodyMeasurementLog({
      id: existing?.id ?? allocateObservationId(data, "body"),
      weight: input.weight,
      measurements: existing?.measurements ?? {},
      weight_input_unit: input.unit,
      circumference_input_unit: existing?.circumference_input_unit ?? null,
      notes: existing?.notes ?? null,
      logged_at: `${input.loggedDate}T12:00:00.000Z`,
      logged_date: input.loggedDate,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    });
    data.bodyMeasurementLogs = [row, ...data.bodyMeasurementLogs.filter((log) => log.id !== row.id)];
    writeDatabase(data);
  });
}

export async function updateBodyWeightLog(input: { id: number; loggedDate: string; weight: number; unit: UnitSystem }) {
  assertCalendarDate(input.loggedDate);
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase
      .from("body_measurement_logs")
      .update({ logged_date: input.loggedDate, weight: input.weight, updated_at: now() })
      .eq("id", input.id);
    if (result.error && isMissingBodyMeasurementTableError(result.error)) {
      throw new Error("Body measurements need the Supabase schema update for body_measurement_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (data.bodyMeasurementLogs.some((log) => log.id !== input.id && log.logged_date === input.loggedDate)) throw new Error("A body check-in already exists for this date. Both records have been preserved.");
    data.bodyMeasurementLogs = data.bodyMeasurementLogs.map((log) =>
      log.id === input.id
        ? { ...log, weight: input.weight, weight_input_unit: input.unit, logged_at: `${input.loggedDate}T12:00:00.000Z`, logged_date: input.loggedDate, updated_at: now() }
        : log
    );
    writeDatabase(data);
  });
}

export async function deleteBodyWeightLog(id: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("delete_body_observation", { p_id: id, p_kind: "weight" });
    throwIfSafetyRpcError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const existing = data.bodyMeasurementLogs.find((log) => log.id === id);
    data.bodyMeasurementLogs = existing && Object.keys(existing.measurements).length
      ? data.bodyMeasurementLogs.map((log) => log.id === id ? { ...log, weight: null, weight_input_unit: null, updated_at: now() } : log)
      : data.bodyMeasurementLogs.filter((log) => log.id !== id);
    writeDatabase(data);
  });
}

export async function saveBodyMeasurementLog(input: { loggedDate: string; weight: number | null; measurements: BodyMeasurementValues; notes?: string | null }) {
  assertCalendarDate(input.loggedDate);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const timestamp = now();
    const result = await supabase.from("body_measurement_logs").upsert(
      {
        user_id: user.id,
        logged_date: input.loggedDate,
        weight: input.weight,
        measurements: input.measurements,
        notes: input.notes?.trim() || null,
        created_at: `${input.loggedDate}T12:00:00.000Z`,
        updated_at: timestamp
      },
      { onConflict: "user_id,logged_date" }
    );
    if (result.error && isMissingBodyMeasurementTableError(result.error)) {
      throw new Error("Body measurements need the Supabase schema update for body_measurement_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const existing = data.bodyMeasurementLogs.find((log) => log.logged_date === input.loggedDate);
    const timestamp = now();
    const row = normalizeBodyMeasurementLog({
      id: existing?.id ?? allocateObservationId(data, "body"),
      weight: input.weight,
      measurements: input.measurements,
      weight_input_unit: input.weight === existing?.weight ? existing?.weight_input_unit ?? null : null,
      circumference_input_unit: sameStoredJson(input.measurements, existing?.measurements) ? existing?.circumference_input_unit ?? null : null,
      notes: input.notes?.trim() || null,
      logged_at: `${input.loggedDate}T12:00:00.000Z`,
      logged_date: input.loggedDate,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    });
    data.bodyMeasurementLogs = [row, ...data.bodyMeasurementLogs.filter((log) => log.id !== row.id)];
    writeDatabase(data);
  });
}

export async function updateBodyMeasurementLog(input: { id: number; loggedDate: string; weight: number | null; measurements: BodyMeasurementValues; notes?: string | null }) {
  assertCalendarDate(input.loggedDate);
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase
      .from("body_measurement_logs")
      .update({
        logged_date: input.loggedDate,
        weight: input.weight,
        measurements: input.measurements,
        notes: input.notes?.trim() || null,
        updated_at: now()
      })
      .eq("id", input.id);
    if (result.error && isMissingBodyMeasurementTableError(result.error)) {
      throw new Error("Body measurements need the Supabase schema update for body_measurement_logs.");
    }
    throwIfSupabaseError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (data.bodyMeasurementLogs.some((log) => log.id !== input.id && log.logged_date === input.loggedDate)) throw new Error("A body check-in already exists for this date. Both records have been preserved.");
    data.bodyMeasurementLogs = data.bodyMeasurementLogs.map((log) =>
      log.id === input.id
        ? normalizeBodyMeasurementLog({
            ...log,
            weight: input.weight,
            measurements: input.measurements,
            weight_input_unit: input.weight === log.weight ? log.weight_input_unit ?? null : null,
            circumference_input_unit: sameStoredJson(input.measurements, log.measurements) ? log.circumference_input_unit ?? null : null,
            notes: input.notes?.trim() || null,
            logged_at: `${input.loggedDate}T12:00:00.000Z`,
            logged_date: input.loggedDate,
            updated_at: now()
          })
        : log
    );
    writeDatabase(data);
  });
}

export async function deleteBodyMeasurementLog(id: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("delete_body_observation", { p_id: id, p_kind: "measurements" });
    throwIfSafetyRpcError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const existing = data.bodyMeasurementLogs.find((log) => log.id === id);
    data.bodyMeasurementLogs = existing?.weight
      ? data.bodyMeasurementLogs.map((log) => log.id === id ? { ...log, measurements: {}, circumference_input_unit: null, notes: null, updated_at: now() } : log)
      : data.bodyMeasurementLogs.filter((log) => log.id !== id);
    writeDatabase(data);
  });
}

export async function updateWorkoutSession(input: WorkoutWriteInput & { sessionId: number }) {
  assertWorkoutWrite(input);
  const timestamp = `${input.workoutDate}T12:00:00.000Z`;

  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("save_workout_session", {
      p_exercise_id: input.exerciseId, p_workout_date: input.workoutDate, p_notes: input.notes,
      p_machine_profile_id: input.machineProfileId ?? null, p_sets: input.sets,
      p_session_id: input.sessionId, p_request_id: null,
      ...(input.inputUnit ? { p_input_unit: input.inputUnit } : {})
    });
    throwIfSafetyRpcError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (!data.sessions.some((session) => session.id === input.sessionId)) throw new Error("This workout no longer exists. Reload before editing it.");
    data.sessions = data.sessions.map((session) =>
      session.id === input.sessionId
        ? {
            ...session,
            workout_date: input.workoutDate,
            notes: input.notes,
            machine_profile_id: input.machineProfileId ?? null,
            input_unit: input.inputUnit ?? null
          }
        : session
    );
    const previous = data.sets.filter((set) => set.session_id === input.sessionId).sort((a, b) => a.set_number - b.set_number);
    data.sets = data.sets.filter((set) => set.session_id !== input.sessionId);
    for (const [index, set] of input.sets.entries()) {
      data.sets.push({
        id: allocateObservationId(data, "set"),
        session_id: input.sessionId,
        exercise_id: input.exerciseId,
        set_number: index + 1,
        reps: set.reps,
        weight: set.weight,
        rir: null,
        is_warmup: Boolean(set.isWarmup),
        ...editedSetCaptureColumns(previous[index], set),
        created_at: timestamp
      });
    }

    writeDatabase(data);
  });
}

export async function updateWorkoutSessionMachineProfile(input: { sessionId: number; machineProfileId?: string | null }) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("update_workout_machine_profile", { p_session_id: input.sessionId, p_machine_profile_id: input.machineProfileId ?? null });
    throwIfSafetyRpcError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (!data.sessions.some((session) => session.id === input.sessionId)) throw new Error("This workout no longer exists. Reload before editing it.");
    data.sessions = data.sessions.map((session) =>
      session.id === input.sessionId
        ? { ...session, machine_profile_id: input.machineProfileId ?? null }
        : session
    );
    writeDatabase(data);
  });
}

export async function updateConfigWeight(id: number, weightFactor: number) {
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.from("muscle_strength_config").update({ weight_factor: weightFactor }).eq("id", id);
    throwIfSupabaseError(result.error);
    return;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.configs = data.configs.map((config) => (config.id === id ? { ...config, weight_factor: weightFactor } : config));
    writeDatabase(data);
  });
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

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.unitSystem = unitSystem;
    writeDatabase(data);
  });
}

export async function updateBodyUnitPreferences(preferences: BodyUnitPreferences) {
  const normalized = normalizeBodyUnitPreferences(preferences);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase
      .from("app_settings")
      .upsert({ user_id: user.id, key: "body_unit_preferences", value: JSON.stringify(normalized), updated_at: now() }, { onConflict: "user_id,key" });
    throwIfSupabaseError(result.error);
    return normalized;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.bodyUnitPreferences = normalized;
    writeDatabase(data);
    return normalized;
  });
}

export async function updateGuidedWorkoutPreferences(preferences: GuidedWorkoutPreferences) {
  const normalized = normalizeGuidedWorkoutPreferences(preferences);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase
      .from("app_settings")
      .upsert({ user_id: user.id, key: "guided_workout_preferences", value: JSON.stringify(normalized) }, { onConflict: "user_id,key" });
    throwIfSupabaseError(result.error);
    return normalized;
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.guidedWorkoutPreferences = normalized;
    writeDatabase(data);
    return normalized;
  });
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

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    const currentUser = data.users.find((user) => user.id === data.currentUserId);
    data.trainingSplit = normalizeTrainingSplit({ days, updated_at: now(), updated_by: currentUser?.name ?? "You" });
    writeDatabase(data);
    return data.trainingSplit;
  });
}

export async function saveActiveWorkout(activeWorkout: ActiveWorkout | null): Promise<ActiveWorkout> {
  if (!activeWorkout?.startedAt) throw new Error("Use atomic workout completion or discard to clear an active workout.");
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("save_active_workout", { p_active_workout: activeWorkout });
    throwIfSafetyRpcError(result.error, "Phase 3");
    if (result.data?.conflict) throw new DraftConflictError(activeWorkout, result.data.current ?? null);
    const saved = normalizeActiveWorkout(result.data?.activeWorkout);
    if (!saved?.workoutId || !Number.isSafeInteger(saved.revision)) throw new Error("The server did not confirm the saved draft revision. Keep the draft and retry.");
    return saved;
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    initializeLocalWorkoutRecords(data);
    if (data.activeWorkoutSnapshot && !data.activeWorkout) throw new Error("The stored workout draft is invalid. Its original has been preserved; resolve it before starting another workout.");
    if (data.retiredActiveWorkouts.includes(activeWorkout.startedAt)) throw new Error("This workout has already ended. Reload before recording more work.");
    let saved: ActiveWorkout;
    try { saved = advanceWorkoutDraft(data.activeWorkout, activeWorkout); }
    catch (error) {
      if (error instanceof DraftConflictError) preserveLocalDraft(data, activeWorkout);
      throw error;
    }
    data.activeWorkout = saved;
    data.activeWorkoutSnapshot = saved;
    const record = workoutRecordFromDraft(saved);
    const existing = data.workoutRecords.find((item) => item.id === record.id);
    if (existing && (existing.kind !== "guided" || existing.startedAt !== record.startedAt || existing.status !== "active")) throw new Error("This workout identity already belongs to another lifecycle.");
    data.workoutRecords = [record, ...data.workoutRecords.filter((item) => item.id !== record.id)];
    writeDatabase(data);
    return saved;
  });
}

export async function finalizeActiveWorkout(workoutId: string, workouts: CompletedGuidedWorkout[] | null, expectedActive?: ActiveWorkout | null) {
  const normalized = workouts ? normalizeCompletedGuidedWorkouts(workouts) : null;
  if (supabase) {
    await requireCloudUser(supabase);
    const result = await supabase.rpc("finalize_active_workout", { p_workout_id: workoutId, p_completed_workouts: normalized, p_expected_active: expectedActive ?? null });
    throwIfSafetyRpcError(result.error);
    return;
  }
  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    if (data.activeWorkout && data.activeWorkout.startedAt !== workoutId) throw new Error("Another workout is active. Reload before finishing this one.");
    if (!data.activeWorkout) {
      if (normalized && !data.completedGuidedWorkouts.some((workout) => workout.startedAt === workoutId)) throw new Error("The active workout was removed. Reload before finishing.");
      return;
    }
    if (!expectedActive || !sameStoredJson(data.activeWorkout, normalizeActiveWorkout(expectedActive))) throw new Error("The workout draft changed. Reload and review it before finishing.");
    initializeLocalWorkoutRecords(data, false);
    if (normalized) {
      const summary = normalized.find((workout) => workout.startedAt === workoutId);
      if (!summary) throw new Error("The completed workout does not match the active draft.");
      const rawArchive = data.workoutArchiveEvidence === undefined ? data.completedGuidedWorkouts : data.workoutArchiveEvidence;
      if (!Array.isArray(rawArchive)) throw new Error("Stored workout summaries are invalid. Your data has been preserved.");
      const current = data.activeWorkout!;
      const links = new Set(data.workoutReferences.filter((ref) => ref.workoutId === current.workoutId).map((ref) => ref.sessionId));
      const referenceOnly = { ...current, id: current.startedAt, finishedAt: summary.finishedAt, currentExercise: emptyActiveExercise(),
        completedExercises: current.completedExercises.filter((entry) => links.has(entry.sessionId!)).map((entry) => ({ ...entry, sets: [] })) };
      data.workoutArchiveEvidence = [referenceOnly, ...rawArchive.filter((workout) => !workout || workout.startedAt !== workoutId)];
      data.completedGuidedWorkouts = normalizeCompletedGuidedWorkouts(data.workoutArchiveEvidence);
    }
    data.workoutRecords = data.workoutRecords.map((record) => record.id === data.activeWorkout?.workoutId
      ? { ...record, status: "completed", finishedAt: normalized?.find((item) => item.startedAt === workoutId)?.finishedAt ?? null } : record);
    data.activeWorkout = null;
    data.activeWorkoutSnapshot = null;
    if (!data.retiredActiveWorkouts.includes(workoutId)) data.retiredActiveWorkouts.push(workoutId);
    writeDatabase(data);
  });
}

export async function saveCompletedGuidedWorkouts(_workouts: CompletedGuidedWorkout[]) {
  throw new Error("Completed workout summaries must be saved through atomic workout completion.");
}

export async function saveMachineProfiles(profiles: MachineProfile[]) {
  const normalized = normalizeMachineProfiles(profiles);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase
      .from("app_settings")
      .upsert({ user_id: user.id, key: "machine_profiles", value: JSON.stringify(normalized) }, { onConflict: "user_id,key" });
    throwIfSupabaseError(result.error);
    return normalized;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.machineProfiles = normalized;
    writeDatabase(data);
    return normalized;
  });
}

export async function saveTemplateExercises(templateExercises: TemplateExercises) {
  const normalized = normalizeTemplateExercises(templateExercises);
  if (supabase) {
    const user = await requireCloudUser(supabase);
    if (!user) throw new Error("Please log in again.");
    const result = await supabase
      .from("app_settings")
      .upsert({ user_id: user.id, key: "workout_template_exercises", value: JSON.stringify(normalized) }, { onConflict: "user_id,key" });
    throwIfSupabaseError(result.error);
    return normalized;
  }

  return withLocalDatabaseLock(() => {
    const data = readDatabase();
    data.templateExercises = normalized;
    writeDatabase(data);
    return normalized;
  });
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
  const [profilesResult, invitesResult, socialExercisesResult, splitSyncResult, performanceResult, membersResult] = await Promise.all([
    supabase.rpc("social_profiles"),
    supabase.from("friend_invites").select("*").eq("owner_id", user.id).is("accepted_by", null).order("created_at", { ascending: false }),
    supabase.from("exercises").select("*"),
    supabase.from("split_sync_requests").select("*").order("updated_at", { ascending: false }),
    supabase.rpc("social_performance_records"),
    supabase.rpc("get_split_sync_members")
  ]);

  throwIfSupabaseError(profilesResult.error);
  throwIfSupabaseError(invitesResult.error);
  throwIfSupabaseError(socialExercisesResult.error);
  throwIfSafetyRpcError(performanceResult.error, "Phase 6");
  throwIfSafetyRpcError(membersResult.error, "Phase 6");
  if (splitSyncResult.error && isMissingTrainingSplitError(splitSyncResult.error)) {
    throw new Error("Shared training splits need the Supabase schema update before they can sync.");
  }
  throwIfSupabaseError(splitSyncResult.error);

  const profiles = new Map<string, ProfileRow>((profilesResult.data ?? []).map((profile: Omit<ProfileRow, "email">) => [profile.id, { ...profile, email: null }]));
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

  const socialSessions = (performanceResult.data?.sessions ?? []) as SocialWorkoutSessionRow[];
  const socialSets = (performanceResult.data?.sets ?? []) as SocialWorkoutSetRow[];
  const allowedUserIds = new Set([user.id, ...friendships.filter((friendship) => friendship.status === "accepted").map((friendship) => otherFriendId(friendship, user.id))]);
  const leaderboard = buildCanonicalLeaderboard({ exercises: cloudExercises(socialExercisesResult.data), sessions: socialSessions, sets: socialSets,
    allowedUserIds, asOfDate: todayIso(), names: new Map([...profiles].map(([id, profile]) => [id, id === user.id ? profileDisplayName(currentProfile, "You") : profileDisplayName(profile, "Friend")])) });

  const syncMemberIds = (membersResult.data ?? []).map((member: { user_id: string }) => member.user_id);
  return { friends, invites, leaderboard, syncMemberIds, notice: null };
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
  await requireCloudUser(supabase);
  const result = await supabase.rpc("remove_friend", { friend_id: friendId });
  throwIfSafetyRpcError(result.error);
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
    if (!catalogExercises.some((exercise) => exercise.name === point.exerciseName) || getExerciseLoadType(point.exerciseName) !== "external" || point.comparability === "self_context") continue;
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
    best_sets: point.workingSets,
    achieved_at: point.date,
    updated_at: now()
  }));

  const result = await supabase.rpc("replace_score_snapshots", { p_snapshots: rows });
  throwIfSafetyRpcError(result.error);
}

function throwIfSafetyRpcError(error: { message: string; code?: string } | null, phase = "Phase 1") {
  if (error?.code === "PGRST202" || error?.code === "42883") throw new Error(`Safe saving requires the ${phase} database migration. Your previous data has been preserved; update the database before retrying.`);
  throwIfSupabaseError(error);
}

async function requireCloudUser(client: SupabaseClient, throwOnMissing = true) {
  const result = await client.auth.getUser();
  if (result.error) {
    if (!throwOnMissing && result.error.name === "AuthSessionMissingError") return null;
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

function isMissingBodyMeasurementTableError(error: { message: string; code?: string } | null) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" ||
    (message.includes("body_measurement_logs") && (message.includes("does not exist") || message.includes("schema cache")));
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

function isMissingMachineSessionColumnError(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return error.message.includes("machine_profile_id") &&
    (error.message.includes("schema cache") || error.message.includes("does not exist") || error.code === "PGRST204" || error.code === "PGRST205");
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
  return upgradeUncustomisedTrainingSplit(normalizeTrainingSplit({
    days: result.data.split_days,
    updated_by: result.data.updated_by_name,
    updated_at: result.data.updated_at
  }));
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

function bodyMeasurementFromLegacyWeight(log: BodyWeightLog): BodyMeasurementLog {
  const normalized = normalizeBodyWeightLogs([log])[0];
  return normalizeBodyMeasurementLog({
    id: normalized.id,
    weight: normalized.weight,
    measurements: {},
    notes: null,
    logged_at: normalized.logged_at,
    logged_date: normalized.logged_date ?? normalized.logged_at.slice(0, 10),
    created_at: normalized.created_at,
    updated_at: normalized.created_at
  });
}

function normalizeLocalBodyMeasurements(measurements: BodyMeasurementLog[] | undefined, legacyWeights: BodyWeightLog[] | undefined) {
  if (Array.isArray(measurements) && measurements.length) {
    return measurements.map((log) => normalizeBodyMeasurementLog({
      ...log,
      measurements: parseStoredMeasurements(log.measurements)
    }));
  }

  return bodyMeasurementsFromLegacyWeights(normalizeBodyWeightLogs(legacyWeights ?? []));
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
    cloudExercises(exercisesResult.data),
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
          sets: orderedSets.map((set) => ({ reps: set.reps, weight: set.weight, rir: set.rir ?? undefined, isWarmup: Boolean(set.is_warmup) }))
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

/** Personal exercises keep a hidden unique key in name and show display_name. */
function cloudExercises(rows: unknown[] | null): Exercise[] {
  return ((rows ?? []) as Array<Exercise & { display_name?: string | null }>)
    .map(({ display_name, ...exercise }) => display_name ? { ...exercise, name: display_name } : exercise);
}

function normalizeCatalog(existing: Exercise[]) {
  // Keep every historical ID and movement. Catalog updates may only add entries.
  const retained = existing.map((exercise) => ({ ...exercise }));
  let nextId = Math.max(0, ...retained.map((exercise) => exercise.id));
  const names = new Set(retained.filter((exercise) => !isCustomExercise(exercise)).map((exercise) => exercise.name));
  for (const exercise of catalogExerciseRows(now())) {
    if (names.has(exercise.name)) continue;
    retained.push({ ...exercise, id: ++nextId });
    names.add(exercise.name);
  }
  return retained;
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
