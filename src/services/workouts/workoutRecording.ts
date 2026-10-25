import { assertCalendarDate } from "@/domain/calendar";
import { parseObservedSets } from "@/domain/observations";
import { WorkoutValidationError, WorkoutWriteInput } from "@/database/workoutWrite";
import { getExerciseLoadType } from "@/constants/exercises";
import { assertGuidedObservationsConfirmed } from "@/services/guidedWorkout/guidedObservationService";
import { finalizeSetCapture } from "@/services/workouts/setCapture";
import type { Exercise, LoggedSetDraft, UnitSystem } from "@/types";

export type ObservationCapture = {
  exerciseId: number; workoutDate: string; notes: string; machineProfileId?: string | null;
  sets: LoggedSetDraft[]; origin?: "manual" | "guided";
};

/** Quick, Guided and History edits share one interpretation of explicitly entered observations. */
export function prepareWorkoutObservations(input: ObservationCapture, exercise: Exercise | undefined, unit: UnitSystem): WorkoutWriteInput {
  try {
    if (!exercise || exercise.id !== input.exerciseId) throw new Error("Choose an existing exercise before recording work.");
    const workoutDate = assertCalendarDate(input.workoutDate);
    if (input.origin === "guided") assertGuidedObservationsConfirmed(input.sets, {
      exerciseId: input.exerciseId, workoutDate, machineProfileId: input.machineProfileId, unitSystem: unit
    });
    return { exerciseId: input.exerciseId, workoutDate, notes: input.notes, machineProfileId: input.machineProfileId ?? null,
      inputUnit: unit, recordingOrigin: input.origin, sets: parseObservedSets(input.sets.map(finalizeSetCapture), unit, getExerciseLoadType(exercise)) };
  } catch (error) {
    throw new WorkoutValidationError(error instanceof Error ? error.message : "Check the entered observations.");
  }
}
