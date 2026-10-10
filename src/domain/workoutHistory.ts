import type {
  ActiveWorkout, CompletedGuidedWorkout, Exercise, UnitSystem, WorkoutSession, WorkoutSet
} from "@/types";
import type { ExerciseEntry, ObservedSet, Workout } from "./types";
import { isCalendarDate } from "./calendar";
import { normalizeActiveWorkout } from "@/constants/activeWorkout";
import type { WorkoutEntryReference, WorkoutRecord } from "./workoutLifecycle";

export type WorkoutHistoryInput = {
  sessions: readonly WorkoutSession[];
  sets: readonly WorkoutSet[];
  exercises: readonly Exercise[];
  activeWorkout?: ActiveWorkout | null;
  completedGuidedWorkouts?: readonly CompletedGuidedWorkout[];
  /** Unmodified storage evidence takes precedence over the UI compatibility normalization. */
  workoutArchiveEvidence?: unknown;
  /** Once available, durable references alone determine grouping; legacy JSON is evidence only. */
  workoutRecords?: readonly WorkoutRecord[];
  workoutReferences?: readonly WorkoutEntryReference[];
};

export type WorkoutMigrationIssueCode =
  | "legacy_unlinked_reference" | "missing_session" | "exercise_mismatch"
  | "mixed_exercise_session" | "empty_session" | "conflicting_workout_link"
  | "duplicate_guided_reference" | "duplicate_workout_metadata"
  | "conflicting_workout_status" | "invalid_workout_identity" | "invalid_reference"
  | "missing_exercise" | "invalid_session" | "invalid_observation" | "orphan_set"
  | "duplicate_session_identity" | "duplicate_set_identity" | "invalid_archive_metadata";

type MetadataSource = "active" | "archive" | "route";
export type WorkoutMigrationIssue = {
  code: WorkoutMigrationIssueCode;
  message: string;
  source: MetadataSource | "session" | "set";
  workoutId: string | null;
  sessionId: number | null;
  exerciseId: number | null;
  /** Preserved historical input, never an alternative source of observations. */
  evidence: unknown;
};
export type WorkoutReferenceEvidence = {
  source: MetadataSource;
  sourceIndex: number;
  referenceIndex: number;
  workoutId: string | null;
  /** Copied sets/outcomes may be inspected for reconciliation, but are not recorded facts. */
  reference: unknown;
};
export type WorkoutMetadataEvidence = {
  source: MetadataSource;
  sourceIndex: number;
  workoutId: string | null;
  metadata: unknown;
};
export type WorkoutHistoryProjection = {
  entries: ExerciseEntry[];
  workouts: Workout[];
  issues: WorkoutMigrationIssue[];
  metadataEvidence: WorkoutMetadataEvidence[];
};
export type RecordedWorkoutTotals = {
  exercises: number;
  sets: number;
  workingSets: number;
  warmups: number;
  workingReps: number;
  /** External load times repetitions in the canonical storage unit; excludes warm-ups. */
  volumeLb: number;
};
export type ResolvedWorkoutSummary = {
  workout: Workout;
  entries: ExerciseEntry[];
  issues: WorkoutMigrationIssue[];
  unresolvedReferences: WorkoutReferenceEvidence[];
  resolution: "complete" | "partial" | "unavailable";
  totals: RecordedWorkoutTotals;
};

type Context = WorkoutMetadataEvidence & { value: ActiveWorkout | CompletedGuidedWorkout };
type Candidate = WorkoutReferenceEvidence & { sessionId: number; exerciseId: number };
type ProjectionDetail = WorkoutHistoryProjection & {
  references: WorkoutReferenceEvidence[];
  unresolved: Set<WorkoutReferenceEvidence>;
};

/** Read-only: sessions and sets supply all observations; archives supply grouping context only. */
export function projectWorkoutHistory(input: WorkoutHistoryInput): WorkoutHistoryProjection {
  const { references: _references, unresolved: _unresolved, ...projection } = project(input);
  return projection;
}

/** Resolve live route metadata too, without falling back to its copied numeric values. */
export function resolveWorkoutSummary(
  input: WorkoutHistoryInput,
  metadata: ActiveWorkout | CompletedGuidedWorkout
): ResolvedWorkoutSummary {
  const projection = project(input, metadata);
  const durable = input.workoutRecords?.find((record) => record.id === metadata.workoutId)
    ?? input.workoutRecords?.find((record) => record.legacyId === metadata.startedAt);
  const id = input.workoutRecords === undefined ? workoutIdentity(metadata) : durable?.id ?? workoutIdentity(metadata);
  const workout = projection.workouts.find((item) => item.id === id)
    ?? guidedWorkout({ source: "route", sourceIndex: 0, workoutId: id, metadata, value: metadata }, []);
  const entryIds = new Set(workout.entryIds);
  const entries = projection.entries.filter((entry) => entryIds.has(entry.id));
  const unresolvedReferences = projection.references.filter((reference) =>
    (reference.workoutId === id || reference.workoutId === durable?.legacyId) && projection.unresolved.has(reference));
  const summaryIssues = projection.issues.filter((issue) => issue.workoutId === id || issue.workoutId === durable?.legacyId || (issue.sessionId !== null && entryIds.has(issue.sessionId)));
  const incomplete = unresolvedReferences.length > 0 || summaryIssues.some((issue) => ["missing_session", "invalid_archive_metadata", "invalid_session", "invalid_observation", "duplicate_set_identity", "duplicate_session_identity"].includes(issue.code));
  return {
    workout, entries,
    issues: summaryIssues,
    unresolvedReferences,
    resolution: incomplete ? entries.length ? "partial" : "unavailable" : "complete",
    totals: recordedWorkoutTotals(entries)
  };
}

/** Count each recorded entry/set identity once, including repeated links in old metadata. */
export function recordedWorkoutTotals(entries: readonly ExerciseEntry[]): RecordedWorkoutTotals {
  const uniqueEntries = new Map(entries.map((entry) => [entry.id, entry]));
  const sets = [...new Map([...uniqueEntries.values()].flatMap((entry) => entry.sets).map((set) => [set.id, set])).values()];
  const working = sets.filter((set) => !set.isWarmup);
  return {
    exercises: uniqueEntries.size, sets: sets.length, workingSets: working.length,
    warmups: sets.length - working.length,
    workingReps: working.reduce((total, set) => total + set.reps, 0),
    volumeLb: working.reduce((total, set) => total + set.reps * set.loadLb, 0)
  };
}

function project(input: WorkoutHistoryInput, route?: ActiveWorkout | CompletedGuidedWorkout): ProjectionDetail {
  const issues: WorkoutMigrationIssue[] = [];
  function issue(code: WorkoutMigrationIssueCode, message: string, source: WorkoutMigrationIssue["source"], evidence: unknown,
    sessionId: number | null = null, exerciseId: number | null = null, workoutId: string | null = null) {
    issues.push({ code, message, source, evidence, sessionId, exerciseId, workoutId });
  }
  const sessionRows = groupByIdentity(input.sessions);
  const sessions = new Map<number, WorkoutSession>();
  for (const [id, rows] of sessionRows) {
    if (!validId(id)) { issue("invalid_session", "A session lacks a valid recorded identity.", "session", rows); continue; }
    if (rows.length > 1) {
      issue("duplicate_session_identity", "Multiple session rows claim the same identity; originals were preserved.", "session", rows, id);
      if (!sameRows(rows)) continue;
    }
    sessions.set(id, rows[0]);
  }
  const setRows = groupByIdentity(input.sets);
  const setsBySession = new Map<number, WorkoutSet[]>();
  for (const [id, rows] of setRows) {
    const row = rows[0];
    if (rows.length > 1) {
      issue("duplicate_set_identity", "Multiple set rows claim the same identity; copied rows do not add work.", "set", rows, row.session_id, row.exercise_id);
      if (!sameRows(rows)) continue;
    }
    if (!validId(id) || !validId(row.exercise_id) || !Number.isInteger(row.reps) || row.reps <= 0
      || !Number.isFinite(row.weight) || row.weight < 0 || !Number.isInteger(row.set_number) || row.set_number <= 0) {
      issue("invalid_observation", "A set cannot be represented as a trustworthy observation; its original is preserved.", "set", row, row.session_id, row.exercise_id);
      continue;
    }
    if (!sessions.has(row.session_id)) {
      issue("orphan_set", "A recorded set has no unambiguous parent session.", "set", row, row.session_id, row.exercise_id);
      continue;
    }
    setsBySession.set(row.session_id, [...(setsBySession.get(row.session_id) ?? []), row]);
  }
  const catalog = new Set(input.exercises.map((exercise) => exercise.id));
  const entries: ExerciseEntry[] = [];
  for (const session of sessions.values()) {
    const rows = [...(setsBySession.get(session.id) ?? [])].sort((left, right) => left.set_number - right.set_number || left.id - right.id);
    // Invalid rows are preserved as evidence. They must not disguise a mixed legacy session.
    const exerciseIds = [...new Set(input.sets.filter((set) => set.session_id === session.id).map((set) => set.exercise_id))];
    const exerciseId = exerciseIds.length === 1 && validId(exerciseIds[0]) ? exerciseIds[0] : null;
    if (!exerciseIds.length) issue("empty_session", "This session has no usable recorded sets; archived copies cannot fill the gap.", "session", session, session.id);
    if (exerciseIds.length > 1) issue("mixed_exercise_session", "This session contains multiple recorded exercise identities; no archive grouping was inferred.", "session", { session, sets: rows }, session.id);
    for (const id of exerciseIds) if (!catalog.has(id)) issue("missing_exercise", "The recorded exercise is missing from the current catalog; its observations were preserved.", "session", { session, exerciseId: id }, session.id, id);
    const workoutDate = calendarDate(session.workout_date);
    if (!workoutDate) issue("invalid_session", "The recorded date is invalid; no replacement date was invented.", "session", session, session.id, exerciseId);
    entries.push({
      id: session.id, sessionId: session.id, exerciseId, workoutDate,
      notes: session.notes ?? null, machineProfileId: session.machine_profile_id ?? null, createdAt: session.created_at,
      origin: session.recording_origin && ["manual", "guided", "import"].includes(session.recording_origin) ? session.recording_origin : "unknown",
      sets: rows.map((set) => observedSet(set, session.input_unit))
    });
  }
  entries.sort(compareEntries);
  const byEntry = new Map(entries.map((entry) => [entry.id, entry]));
  const contexts: Context[] = [];
  const metadataEvidence: WorkoutMetadataEvidence[] = [];
  const rawArchive = input.workoutArchiveEvidence === undefined ? input.completedGuidedWorkouts ?? [] : input.workoutArchiveEvidence;
  if (!Array.isArray(rawArchive)) {
    issue("invalid_archive_metadata", "The archive document is malformed; its original was preserved for reconciliation.", "archive", rawArchive);
    metadataEvidence.push({ source: "archive", sourceIndex: 0, workoutId: null, metadata: rawArchive });
  } else {
    for (const [sourceIndex, raw] of rawArchive.entries()) {
      const normalized = normalizeActiveWorkout(raw);
      if (!normalized) {
        issue("invalid_archive_metadata", "An archive record cannot be interpreted safely; its original was preserved.", "archive", raw);
        metadataEvidence.push({ source: "archive", sourceIndex, workoutId: null, metadata: raw });
        continue;
      }
      const finishedAt = raw && typeof raw.finishedAt === "string" ? raw.finishedAt : "";
      const id = raw && typeof raw.id === "string" ? raw.id : normalized.startedAt;
      const item = context("archive", sourceIndex, { ...normalized, id, finishedAt });
      item.metadata = raw;
      contexts.push(item);
      if (!finishedAt) issue("invalid_archive_metadata", "The archived completion time is unknown; no time was invented.", "archive", raw, null, null, item.workoutId);
    }
  }
  if (input.activeWorkout) contexts.push(context("active", 0, input.activeWorkout));
  if (route) contexts.push(context("route", 0, route));
  const contextsById = new Map<string, Context[]>();
  const references: WorkoutReferenceEvidence[] = [];
  const unresolved = new Set<WorkoutReferenceEvidence>();
  const candidates = new Map<number, Candidate[]>();
  for (const item of contexts) {
    if (item.workoutId) contextsById.set(item.workoutId, [...(contextsById.get(item.workoutId) ?? []), item]);
    else issue("invalid_workout_identity", "Guided metadata lacks a stable workout identity; its original was preserved.", item.source, item.metadata);
    const seen = new Set<number>();
    for (const [referenceIndex, reference] of item.value.completedExercises.entries()) {
      const evidence: WorkoutReferenceEvidence = {
        source: item.source, sourceIndex: item.sourceIndex, referenceIndex, workoutId: item.workoutId, reference
      };
      references.push(evidence);
      const sessionId = reference && validId(reference.sessionId) ? reference.sessionId! : null;
      const exerciseId = reference && validId(reference.exerciseId) ? reference.exerciseId : null;
      function reject(code: WorkoutMigrationIssueCode, message: string) {
        unresolved.add(evidence);
        issue(code, message, item.source, evidence, sessionId, exerciseId, item.workoutId);
      }
      if (!reference || typeof reference !== "object" || exerciseId === null) { reject("invalid_reference", "A guided exercise reference is invalid; no observation was inferred."); continue; }
      if (!item.workoutId) { unresolved.add(evidence); continue; }
      if (sessionId === null) { reject("legacy_unlinked_reference", "This legacy exercise has no explicit session link; copied values remain reconciliation evidence only."); continue; }
      const entry = byEntry.get(sessionId);
      if (!entry) { reject("missing_session", "The linked recorded session is unavailable or deleted; archived values were not restored."); continue; }
      if (!entry.sets.length) { reject("empty_session", "The linked session has no usable observations; archived sets were not substituted."); continue; }
      if (entry.exerciseId === null) { reject("mixed_exercise_session", "The linked session contains mixed exercise identities; this association requires reconciliation."); continue; }
      if (entry.exerciseId !== exerciseId) { reject("exercise_mismatch", "The explicit link points to a different recorded exercise; its copied values were not used."); continue; }
      if (seen.has(sessionId)) issue("duplicate_guided_reference", "This workout references the same observation more than once; it contributes once.", item.source, evidence, sessionId, exerciseId, item.workoutId);
      seen.add(sessionId);
      candidates.set(sessionId, [...(candidates.get(sessionId) ?? []), { ...evidence, sessionId, exerciseId }]);
    }
  }
  const assigned = new Map<number, string>();
  for (const [sessionId, claims] of candidates) {
    const workoutIds = new Set(claims.map((claim) => claim.workoutId!));
    if (workoutIds.size === 1) { assigned.set(sessionId, claims[0].workoutId!); continue; }
    for (const claim of claims) {
      const evidence = references.find((reference) => reference.source === claim.source && reference.sourceIndex === claim.sourceIndex
        && reference.referenceIndex === claim.referenceIndex && reference.workoutId === claim.workoutId)!;
      unresolved.add(evidence);
      issue("conflicting_workout_link", "Different guided workouts claim the same recorded session; it remains standalone until reconciled.", claim.source, evidence, sessionId, claim.exerciseId, claim.workoutId);
    }
  }
  const workouts: Workout[] = [];
  for (const [id, sources] of contextsById) {
    const archives = sources.filter((source) => source.source === "archive");
    if (archives.length > 1) issue("duplicate_workout_metadata", "Multiple archive records use this workout identity; observations were not duplicated.", "archive", archives.map((item) => item.metadata), null, null, id);
    if (sources.some((source) => source.source === "active") && archives.length) issue("conflicting_workout_status", "An active draft and an archive share this identity; both metadata originals were preserved.", "active", sources.map((item) => item.metadata), null, null, id);
    const chosen = sources.find((source) => source.source === "active") ?? archives[0] ?? sources[0];
    workouts.push(guidedWorkout(chosen, entries.filter((entry) => assigned.get(entry.id) === id)));
  }
  for (const entry of entries) if (!assigned.has(entry.id)) workouts.push({
    id: `session:${entry.id}`, kind: "standalone", status: "completed", entryIds: [entry.id], workoutDate: entry.workoutDate,
    startedAt: null, finishedAt: null, label: null, notes: entry.notes, templateId: null, scheduledDayId: null,
    plannedMuscles: [], scheduleChanges: []
  });
  if (input.workoutRecords !== undefined) {
    workouts.length = 0;
    const durableAssigned = new Set<number>();
    const referenceClaims = new Map<number, WorkoutEntryReference[]>();
    for (const reference of input.workoutReferences ?? []) referenceClaims.set(reference.sessionId, [...(referenceClaims.get(reference.sessionId) ?? []), reference]);
    for (const record of input.workoutRecords) {
      const entryIds: number[] = [];
      for (const reference of input.workoutReferences ?? []) {
        if (reference.workoutId !== record.id) continue;
        if (!byEntry.has(reference.sessionId)) {
          issue("missing_session", "The referenced recorded entry is unavailable. Its observations were not recreated.", "session", reference, reference.sessionId, null, record.id);
          continue;
        }
        if (referenceClaims.get(reference.sessionId)!.length !== 1) {
          issue("conflicting_workout_link", "Durable references disagree about this recorded entry. Its observations are preserved independently.", "session", reference, reference.sessionId, null, record.id);
          continue;
        }
        entryIds.push(reference.sessionId);
        durableAssigned.add(reference.sessionId);
      }
      const dates = new Set(entryIds.map((id) => byEntry.get(id)!.workoutDate));
      workouts.push({ ...record, entryIds, workoutDate: dates.size === 1 ? [...dates][0] : null });
    }
    for (const entry of entries) if (!durableAssigned.has(entry.id)) workouts.push({
      id: `session:${entry.id}`, kind: "standalone", status: "completed", entryIds: [entry.id], workoutDate: entry.workoutDate,
      startedAt: null, finishedAt: null, label: null, notes: entry.notes, templateId: null, scheduledDayId: null, plannedMuscles: [], scheduleChanges: []
    });
  }
  workouts.sort((left, right) => (right.workoutDate ?? "").localeCompare(left.workoutDate ?? "")
    || (right.startedAt ?? "").localeCompare(left.startedAt ?? "") || left.id.localeCompare(right.id));
  return { entries, workouts, issues, metadataEvidence: [...metadataEvidence, ...contexts.map(({ value: _value, ...evidence }) => evidence)], references, unresolved };
}

function observedSet(set: WorkoutSet, inputUnit?: UnitSystem | null): ObservedSet {
  return {
    id: set.id, exerciseId: set.exercise_id, setNumber: set.set_number, reps: set.reps, loadLb: set.weight,
    isWarmup: Boolean(set.is_warmup), rir: typeof set.rir === "number" && Number.isFinite(set.rir) ? set.rir : null,
    // Historical zeroes were inserted by software; their presence is not evidence of entered effort.
    rirSource: "unknown",
    sourceUnit: inputUnit === "lb" || inputUnit === "kg" ? { status: "recorded", unit: inputUnit }
      : { status: "unknown", reason: "The historical input unit was not recorded." },
    createdAt: set.created_at
  };
}

function context(source: MetadataSource, sourceIndex: number, value: ActiveWorkout | CompletedGuidedWorkout): Context {
  return { source, sourceIndex, workoutId: workoutIdentity(value), metadata: value, value };
}
function workoutIdentity(value: ActiveWorkout | CompletedGuidedWorkout) {
  return typeof value.startedAt === "string" && value.startedAt.trim() ? value.startedAt : null;
}
function guidedWorkout(item: Context, entries: readonly ExerciseEntry[]): Workout {
  const dates = new Set(entries.map((entry) => entry.workoutDate));
  const finishedAt = "finishedAt" in item.value && typeof item.value.finishedAt === "string" ? item.value.finishedAt : null;
  return {
    id: item.workoutId ?? "", kind: "guided", status: item.source === "active" || (item.source === "route" && !finishedAt) ? "active" : "completed",
    entryIds: entries.map((entry) => entry.id), workoutDate: dates.size === 1 ? [...dates][0] : null,
    startedAt: item.workoutId, finishedAt, label: item.value.workoutLabel ?? null, notes: null,
    templateId: item.value.templateId ?? null,
    scheduledDayId: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(item.value.sourceDayKey) ? `weekday:${item.value.sourceDayKey}` : null,
    plannedMuscles: [...item.value.plannedMuscles], scheduleChanges: [...item.value.scheduleChanges]
  };
}
function validId(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function calendarDate(value: string) {
  return isCalendarDate(value) ? value : null;
}
function compareEntries(left: ExerciseEntry, right: ExerciseEntry) {
  return (right.workoutDate ?? "").localeCompare(left.workoutDate ?? "")
    || right.createdAt.localeCompare(left.createdAt) || right.id - left.id;
}
function groupByIdentity<T extends { id: number }>(rows: readonly T[]) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
  return grouped;
}
function sameRows<T>(rows: readonly T[]) { return rows.every((row) => JSON.stringify(row) === JSON.stringify(rows[0])); }
