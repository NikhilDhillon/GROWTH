import type { ActiveWorkout, TemplateExercise, WorkoutSlot } from "@/types";
import { createRequestId } from "@/utils/requestId";

export type WorkoutSlotStatus = "done" | "current" | "pending";
export type WorkoutSlotProgress = { slot: WorkoutSlot; status: WorkoutSlotStatus; sessionId?: number };

export function slotsFromTemplate(exercises: readonly TemplateExercise[]): WorkoutSlot[] {
  return exercises.map((exercise) => ({ id: createRequestId(), exerciseId: exercise.exerciseId, machineProfileId: exercise.machineProfileId }));
}

/**
 * Each completed entry fills the first open slot for its exercise, so doing exercises
 * out of order still checks off the right slot. Completed work with no slot (a workout
 * started before slots existed) is listed first as done.
 */
export function workoutSlotProgress(workout: ActiveWorkout): WorkoutSlotProgress[] {
  const used = new Set<number>();
  const planned = (workout.slots ?? []).map((slot): WorkoutSlotProgress => {
    const index = workout.completedExercises.findIndex((entry, entryIndex) => !used.has(entryIndex) && entry.exerciseId === slot.exerciseId);
    if (index >= 0) {
      used.add(index);
      return { slot, status: "done", sessionId: workout.completedExercises[index].sessionId };
    }
    return { slot, status: workout.currentExercise.slotId === slot.id ? "current" : "pending" };
  });
  const unplanned = workout.completedExercises.flatMap((entry, index): WorkoutSlotProgress[] => used.has(index) ? [] : [{
    slot: { id: `entry:${entry.sessionId ?? index}`, exerciseId: entry.exerciseId, machineProfileId: entry.machineProfileId ?? null },
    status: "done", sessionId: entry.sessionId
  }]);
  return [...unplanned, ...planned];
}

export function nextPendingSlot(workout: ActiveWorkout): WorkoutSlot | null {
  return workoutSlotProgress(workout).find((item) => item.status === "pending")?.slot ?? null;
}

export function removeWorkoutSlot(workout: ActiveWorkout, slotId: string): ActiveWorkout {
  return { ...workout, slots: (workout.slots ?? []).filter((slot) => slot.id !== slotId) };
}

/** Adds an exercise to the end of today's plan, unless it is already waiting there. */
export function appendWorkoutSlot(workout: ActiveWorkout, exerciseId: number, machineProfileId: string | null): ActiveWorkout {
  const waiting = workoutSlotProgress(workout).some((item) => item.status !== "done" && item.slot.exerciseId === exerciseId);
  if (waiting) return workout;
  return { ...workout, slots: [...(workout.slots ?? []), { id: createRequestId(), exerciseId, machineProfileId }] };
}

/**
 * The slot to record a chosen exercise in: a waiting slot for that exercise, or a new
 * slot placed before the current one, so the skipped-for-now exercise comes next.
 */
export function slotForChosenExercise(workout: ActiveWorkout, exerciseId: number, machineProfileId: string | null): { slots: WorkoutSlot[]; slot: WorkoutSlot } {
  const slots = workout.slots ?? [];
  const waiting = workoutSlotProgress(workout).find((item) => item.status !== "done" && item.slot.exerciseId === exerciseId && !item.slot.id.startsWith("entry:"));
  if (waiting) return { slots, slot: waiting.slot };
  const slot: WorkoutSlot = { id: createRequestId(), exerciseId, machineProfileId };
  const currentIndex = slots.findIndex((item) => item.id === workout.currentExercise.slotId);
  return { slots: currentIndex >= 0 ? [...slots.slice(0, currentIndex), slot, ...slots.slice(currentIndex)] : [...slots, slot], slot };
}

export function normalizeWorkoutSlots(value: unknown): WorkoutSlot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, exerciseId, machineProfileId } = item as Partial<WorkoutSlot>;
    if (typeof id !== "string" || !id.trim() || ids.has(id) || !Number.isSafeInteger(exerciseId) || Number(exerciseId) <= 0) return [];
    ids.add(id);
    return [{ id, exerciseId: Number(exerciseId), machineProfileId: typeof machineProfileId === "string" && machineProfileId ? machineProfileId : null }];
  });
}
