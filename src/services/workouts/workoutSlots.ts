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
  return { ...workout, slots: tidySupersets((workout.slots ?? []).filter((slot) => slot.id !== slotId)) };
}

/** Adds an exercise to the end of today's plan, unless it is already waiting there. */
export function appendWorkoutSlot(workout: ActiveWorkout, exerciseId: number, machineProfileId: string | null): ActiveWorkout {
  const waiting = workoutSlotProgress(workout).some((item) => item.status !== "done" && item.slot.exerciseId === exerciseId);
  if (waiting) return workout;
  return { ...workout, slots: [...(workout.slots ?? []), { id: createRequestId(), exerciseId, machineProfileId }] };
}

/**
 * The slot to record a chosen exercise in, placed where the current exercise is
 * (or, with none open, before the next waiting one): a waiting slot for that
 * exercise moves there, otherwise a new slot is made. Replacing drops the current
 * exercise from today's plan and takes over its superset; otherwise it comes next.
 */
export function slotForChosenExercise(workout: ActiveWorkout, exerciseId: number, machineProfileId: string | null, replaceCurrent = false): { slots: WorkoutSlot[]; slot: WorkoutSlot } {
  const slots = workout.slots ?? [];
  const progress = workoutSlotProgress(workout);
  const waiting = progress.find((item) => item.status !== "done" && item.slot.exerciseId === exerciseId && !item.slot.id.startsWith("entry:"));
  const anchor = slots.find((slot) => slot.id === workout.currentExercise.slotId)
    ?? progress.find((item) => item.status === "pending" && item.slot.id !== waiting?.slot.id)?.slot;
  let slot: WorkoutSlot = waiting?.slot ?? { id: createRequestId(), exerciseId, machineProfileId };
  if (!anchor) return { slots: waiting ? slots : [...slots, slot], slot };
  const replacing = replaceCurrent && anchor.id === workout.currentExercise.slotId;
  if (replacing) slot = anchor.superset ? { ...slot, superset: anchor.superset } : withoutSuperset(slot);
  else if (slot.superset !== anchor.superset) slot = withoutSuperset(slot);
  const others = slots.filter((item) => item.id !== slot.id);
  const index = others.findIndex((item) => item.id === anchor.id);
  const placed = replacing ? [...others.slice(0, index), slot, ...others.slice(index + 1)] : [...others.slice(0, index), slot, ...others.slice(index)];
  return { slots: tidySupersets(placed), slot };
}

function withoutSuperset(slot: WorkoutSlot): WorkoutSlot {
  const { superset: _superset, ...rest } = slot;
  return rest;
}

/** Linked slots stay side by side where the first of them is, and a superset of one is no superset. */
export function tidySupersets(slots: readonly WorkoutSlot[]): WorkoutSlot[] {
  const sizes = new Map<string, number>();
  for (const slot of slots) if (slot.superset) sizes.set(slot.superset, (sizes.get(slot.superset) ?? 0) + 1);
  const placed = new Set<string>();
  return slots.flatMap((slot) => {
    if (!slot.superset) return [slot];
    if ((sizes.get(slot.superset) ?? 0) < 2) return [withoutSuperset(slot)];
    if (placed.has(slot.superset)) return [];
    placed.add(slot.superset);
    return slots.filter((item) => item.superset === slot.superset);
  });
}

/**
 * Moves a slot before or after another. It leaves its superset unless it lands
 * beside a partner, and a drop inside another superset lands next to it instead.
 */
export function moveWorkoutSlot(workout: ActiveWorkout, slotId: string, targetId: string, placement: "before" | "after"): ActiveWorkout {
  const slots = workout.slots ?? [];
  const moving = slots.find((slot) => slot.id === slotId);
  const target = slots.find((slot) => slot.id === targetId);
  if (!moving || !target || slotId === targetId) return workout;
  const others = slots.filter((slot) => slot.id !== slotId);
  const together = Boolean(moving.superset) && moving.superset === target.superset;
  let index = others.findIndex((slot) => slot.id === targetId) + (placement === "after" ? 1 : 0);
  if (!together && target.superset) {
    const members = others.map((slot, position) => slot.superset === target.superset ? position : -1).filter((position) => position >= 0);
    index = placement === "before" && index === members[0] ? members[0] : members[members.length - 1] + 1;
  }
  const moved = together ? moving : withoutSuperset(moving);
  return { ...workout, slots: tidySupersets([...others.slice(0, index), moved, ...others.slice(index)]) };
}

/** Makes a superset of two slots: the moved one joins the target's superset, right after its last member. */
export function pairWorkoutSlots(workout: ActiveWorkout, slotId: string, targetId: string): ActiveWorkout {
  const slots = workout.slots ?? [];
  const moving = slots.find((slot) => slot.id === slotId);
  const target = slots.find((slot) => slot.id === targetId);
  if (!moving || !target || slotId === targetId) return workout;
  const group = target.superset ?? createRequestId();
  const others = slots.filter((slot) => slot.id !== slotId).map((slot) => slot.id === targetId ? { ...slot, superset: group } : slot);
  const last = others.reduce((found, slot, position) => slot.superset === group ? position : found, -1);
  return { ...workout, slots: tidySupersets([...others.slice(0, last + 1), { ...moving, superset: group }, ...others.slice(last + 1)]) };
}

/** Takes a slot out of its superset; a partner left alone is a plain exercise again. */
export function unlinkWorkoutSlot(workout: ActiveWorkout, slotId: string): ActiveWorkout {
  const slots = workout.slots ?? [];
  const index = slots.findIndex((slot) => slot.id === slotId);
  if (index < 0 || !slots[index].superset) return workout;
  const group = slots[index].superset;
  const unlinked = withoutSuperset(slots[index]);
  // The unlinked exercise follows the rest of its old superset.
  const others = slots.filter((slot) => slot.id !== slotId);
  const last = others.reduce((found, slot, position) => slot.superset === group ? position : found, index - 1);
  return { ...workout, slots: tidySupersets([...others.slice(0, last + 1), unlinked, ...others.slice(last + 1)]) };
}

/** The not-yet-done slots of a slot's superset, in order; empty when it has no partner left. */
export function supersetSlots(workout: ActiveWorkout, slotId: string | undefined): WorkoutSlot[] {
  const progress = workoutSlotProgress(workout);
  const group = progress.find((item) => item.slot.id === slotId)?.slot.superset;
  if (!group) return [];
  const open = progress.filter((item) => item.slot.superset === group && item.status !== "done").map((item) => item.slot);
  return open.length > 1 ? open : [];
}

/**
 * Where a superset goes after a set: the next partner with sets left in this
 * round, straight away; once the round is over, a rest, then the first one
 * with sets left (null when none has any).
 */
export function supersetNext(order: readonly string[], currentId: string, hasSetsLeft: (slotId: string) => boolean): { slotId: string | null; rest: boolean } {
  const later = order.slice(order.indexOf(currentId) + 1).find(hasSetsLeft);
  if (later) return { slotId: later, rest: false };
  return { slotId: order.find(hasSetsLeft) ?? null, rest: true };
}

export function normalizeWorkoutSlots(value: unknown): WorkoutSlot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  return tidySupersets(value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, exerciseId, machineProfileId, superset } = item as Partial<WorkoutSlot>;
    if (typeof id !== "string" || !id.trim() || ids.has(id) || !Number.isSafeInteger(exerciseId) || Number(exerciseId) <= 0) return [];
    ids.add(id);
    return [{ id, exerciseId: Number(exerciseId), machineProfileId: typeof machineProfileId === "string" && machineProfileId ? machineProfileId : null,
      ...(typeof superset === "string" && superset ? { superset } : {}) }];
  }));
}
