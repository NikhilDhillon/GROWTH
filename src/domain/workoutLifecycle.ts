import { emptyActiveExercise } from "@/constants/activeWorkout";
import { sameStoredJson, WorkoutWriteInput } from "@/database/workoutWrite";
import { projectWorkoutHistory, WorkoutHistoryInput } from "./workoutHistory";
import type { Prescription, Workout } from "./types";
import type { ActiveWorkout } from "@/types";
import { createRequestId } from "@/utils/requestId";
import { assertGuidedObservationsConfirmed } from "@/services/guidedWorkout/guidedObservationService";
import { observationValues, parseObservedSets } from "./observations";
import { getExerciseLoadType } from "@/constants/exercises";
import type { Exercise } from "@/types";

/** Lifecycle metadata only. Performed values belong exclusively to sessions/sets. */
export type WorkoutRecord = Omit<Workout, "entryIds" | "workoutDate"> & { legacyId: string | null };
export type WorkoutEntryReference = {
  workoutId: string;
  sessionId: number;
  prescription: Prescription | null;
  completedAt: string | null;
};
export type RecoveredWorkoutDraft = { id: string; savedAt: string; draft: ActiveWorkout };
export type WorkoutRecordingInput = WorkoutWriteInput & {
  workoutId: string;
  /** Guided capture commits facts, reference, and draft advancement in one transaction. */
  expectedActive?: ActiveWorkout;
  completedAt: string;
};
export type WorkoutRecordingResult = { sessionId: number; activeWorkout: ActiveWorkout | null };

export class DraftConflictError extends Error {
  constructor(public readonly draft: ActiveWorkout, public readonly current: ActiveWorkout | null) {
    super("A newer workout draft is saved. Your version has been kept for recovery. Reload the saved draft before continuing.");
    this.name = "DraftConflictError";
  }
}

export function workoutRecordFromDraft(draft: ActiveWorkout): WorkoutRecord {
  if (!draft.workoutId) throw new Error("This workout needs its durable identity before recording.");
  return {
    id: draft.workoutId, legacyId: draft.startedAt, kind: "guided", status: "active",
    startedAt: draft.startedAt, finishedAt: null, label: draft.workoutLabel ?? null, notes: null,
    templateId: draft.templateId ?? null, scheduledDayId: `weekday:${draft.sourceDayKey}`,
    plannedMuscles: [...draft.plannedMuscles], scheduleChanges: [...draft.scheduleChanges]
  };
}

export function standaloneWorkoutRecord(id: string): WorkoutRecord {
  return { id, legacyId: null, kind: "standalone", status: "completed", startedAt: null, finishedAt: null,
    label: null, notes: null, templateId: null, scheduledDayId: null, plannedMuscles: [], scheduleChanges: [] };
}

/** Returning an identical retry is safe; a different stale candidate must be rejected. */
export function advanceWorkoutDraft(current: ActiveWorkout | null, candidate: ActiveWorkout): ActiveWorkout {
  if (!candidate.workoutId) throw new Error("The workout has no durable identity. Reload before saving.");
  if (current && (current.startedAt !== candidate.startedAt || current.workoutId !== candidate.workoutId)) throw new DraftConflictError(candidate, current);
  const currentRevision = current?.revision ?? 0;
  const expectedRevision = candidate.revision ?? 0;
  const withoutRevision = ({ revision: _revision, ...value }: ActiveWorkout) => value;
  if (current && sameStoredJson(withoutRevision(current), withoutRevision(candidate))) return current;
  if (expectedRevision !== currentRevision || (!current && expectedRevision !== 0)) throw new DraftConflictError(candidate, current);
  return { ...candidate, revision: currentRevision + 1 };
}

export function committedWorkoutDraft(current: ActiveWorkout, input: WorkoutRecordingInput, sessionId: number): ActiveWorkout {
  if (!input.expectedActive || !sameStoredJson(current, input.expectedActive)) throw new DraftConflictError(input.expectedActive ?? current, current);
  if (current.workoutId !== input.workoutId || current.currentExercise.requestId !== input.requestId
    || current.currentExercise.exerciseId !== input.exerciseId || current.workoutDate !== input.workoutDate
    || current.currentExercise.notes !== input.notes || current.currentExercise.machineProfileId !== input.machineProfileId) {
    throw new Error("The recording attempt does not match the saved workout draft.");
  }
  if (!current.currentExercise.muscle) throw new Error("The selected exercise has no muscle context. Review the draft before recording.");
  return {
    ...current, revision: (current.revision ?? 0) + 1,
    completedExercises: [...current.completedExercises.filter((entry) => entry.sessionId !== sessionId), {
      exerciseId: input.exerciseId, sessionId, machineProfileId: input.machineProfileId,
      exerciseName: "", muscle: current.currentExercise.muscle, sets: [], completedAt: input.completedAt
    }],
    currentExercise: emptyActiveExercise()
  };
}

/** Both adapters validate the durable draft; a prescription cannot substitute for confirmed input. */
export function assertGuidedRecordingInput(input: WorkoutRecordingInput, exercise: Exercise) {
  const draft = input.expectedActive;
  if (!draft || !input.inputUnit || draft.currentExercise.requestUnit !== input.inputUnit) throw new Error("A guided recording requires its saved draft and explicit recording unit.");
  const context = { exerciseId: input.exerciseId, workoutDate: input.workoutDate, machineProfileId: input.machineProfileId, unitSystem: input.inputUnit };
  assertGuidedObservationsConfirmed(draft.currentExercise.sets, context);
  const observations = parseObservedSets(draft.currentExercise.sets, input.inputUnit, getExerciseLoadType(exercise));
  // Capture metadata describes how values were entered; only the values must match.
  if (!sameStoredJson(observationValues(observations), observationValues(input.sets))) throw new Error("The recorded observations differ from the confirmed draft.");
}

/** One explicit migration. Unknown/conflicting evidence is retained, never re-linked on later starts. */
export function planWorkoutReferenceMigration(input: WorkoutHistoryInput) {
  const { workoutRecords: _records, workoutReferences: _references, ...legacy } = input;
  const projection = projectWorkoutHistory(legacy);
  // New clients/compatibility RPCs may already have created records before the
  // retirement checkpoint. Their links are authoritative and never re-parented.
  const records: WorkoutRecord[] = [...(input.workoutRecords ?? [])];
  const references: WorkoutEntryReference[] = [...(input.workoutReferences ?? [])];
  if (new Set(records.map((record) => record.id)).size !== records.length
    || new Set(references.map((reference) => reference.sessionId)).size !== references.length) {
    throw new Error("Stored workout identities conflict. Preserve them and reconcile before migrating.");
  }
  if (references.some((reference) => !records.some((record) => record.id === reference.workoutId))) {
    throw new Error("Stored workout references are incomplete. Preserve them and reconcile before migrating.");
  }
  for (const workout of projection.workouts) {
    if (workout.kind !== "guided" || !workout.entryIds.length) continue;
    if (workout.entryIds.some((id) => references.some((reference) => reference.sessionId === id))
      || records.some((record) => record.legacyId === workout.id)) continue;
    if (projection.issues.some((issue) => issue.workoutId === workout.id || (issue.sessionId !== null && workout.entryIds.includes(issue.sessionId)))) continue;
    const id = input.activeWorkout?.startedAt === workout.id && input.activeWorkout.workoutId
      ? input.activeWorkout.workoutId : createRequestId();
    const { entryIds, workoutDate: _date, ...metadata } = workout;
    records.push({ ...metadata, id, legacyId: workout.id });
    for (const sessionId of entryIds) references.push({ workoutId: id, sessionId, prescription: null, completedAt: null });
  }
  for (const entry of projection.entries) if (!references.some((reference) => reference.sessionId === entry.id)) {
    const id = createRequestId();
    records.push(standaloneWorkoutRecord(id));
    references.push({ workoutId: id, sessionId: entry.id, prescription: null, completedAt: null });
  }
  let activeWorkout = input.activeWorkout ?? null;
  if (activeWorkout) {
    const matches = records.filter((record) => record.legacyId === activeWorkout!.startedAt);
    if (matches.length > 1) throw new Error("The active workout has conflicting durable identities. Its evidence has been preserved.");
    const record = matches[0] ?? records.find((record) => record.id === activeWorkout!.workoutId);
    if (record && (record.kind !== "guided" || record.status !== "active"
      || record.legacyId !== activeWorkout.startedAt
      || (activeWorkout.workoutId && activeWorkout.workoutId !== record.id))) {
      throw new Error("The active workout identity conflicts with its saved lifecycle. Its evidence has been preserved.");
    }
    const workoutId = record?.id ?? activeWorkout.workoutId ?? createRequestId();
    activeWorkout = { ...activeWorkout, workoutId, revision: activeWorkout.revision ?? 0 };
    if (!record) records.push(workoutRecordFromDraft(activeWorkout));
  }
  return { records, references, activeWorkout };
}
