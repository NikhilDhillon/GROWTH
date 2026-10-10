import type { ActiveWorkout } from "@/types";
import { projectWorkoutHistory, recordedWorkoutTotals, type ResolvedWorkoutSummary, type WorkoutHistoryInput } from "@/domain/workoutHistory";

export type SavedWorkoutSummaryParams = { workoutId?: string; workout?: ActiveWorkout; finishedAt?: string };

/** Browser links and legacy routes identify saved metadata. They never create
 * workout membership, duration, observations, or target outcomes. */
export function savedWorkoutSummary(input: WorkoutHistoryInput, params: SavedWorkoutSummaryParams): ResolvedWorkoutSummary | null {
  const record = input.workoutRecords?.find((item) => item.id === params.workoutId)
    ?? (!params.workoutId ? input.workoutRecords?.find((item) => item.id === params.workout?.workoutId || item.legacyId === params.workout?.startedAt) : undefined);
  const legacy = !params.workoutId && input.workoutRecords === undefined
    ? input.completedGuidedWorkouts?.find((item) => item.workoutId === params.workout?.workoutId || item.startedAt === params.workout?.startedAt)
    : undefined;
  const id = params.workoutId ?? record?.id ?? legacy?.workoutId ?? legacy?.startedAt;
  if (!id) return null;
  const projection = projectWorkoutHistory(input);
  const workout = projection.workouts.find((item) => item.id === id);
  if (!workout) return null;
  const ids = new Set(workout.entryIds);
  const references = input.workoutReferences?.filter((reference) => reference.workoutId === id) ?? [];
  const referencedIds = new Set(references.map((reference) => reference.sessionId));
  const entries = projection.entries.filter((entry) => ids.has(entry.id));
  const issues = projection.issues.filter((issue) => issue.workoutId === id || issue.workoutId === record?.legacyId
    || issue.sessionId !== null && (ids.has(issue.sessionId) || referencedIds.has(issue.sessionId)));
  return { workout, entries, issues, unresolvedReferences: [], resolution: issues.length ? entries.length ? "partial" : "unavailable" : "complete",
    totals: recordedWorkoutTotals(entries) };
}
