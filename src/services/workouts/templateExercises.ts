import { splitMuscles } from "@/constants/trainingSplit";
import type { WorkoutTemplate } from "@/domain/types";
import type { ActiveWorkout, SplitMuscle, TemplateExercise, TemplateExercises } from "@/types";
import { workoutSlotProgress } from "./workoutSlots";

const maximumTemplateExercises = 20;

/** Days that train the same muscles share one exercise list, whichever weekday they fall on. */
export function templateExerciseKey(muscles: readonly SplitMuscle[]) {
  return splitMuscles.filter((muscle) => muscles.includes(muscle)).join("+");
}

/** A template with the exercises remembered for its muscles; built-in templates otherwise have none. */
export function withTemplateExercises(template: WorkoutTemplate, stored: TemplateExercises): WorkoutTemplate {
  const exercises = stored[templateExerciseKey(template.muscles)] ?? [];
  return { ...template, exerciseIds: exercises.map((exercise) => exercise.exerciseId) };
}

function normalizeExerciseList(value: unknown): TemplateExercise[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { exerciseId, machineProfileId } = item as Partial<TemplateExercise>;
    if (!Number.isSafeInteger(exerciseId) || Number(exerciseId) <= 0 || seen.has(Number(exerciseId))) return [];
    seen.add(Number(exerciseId));
    return [{ exerciseId: Number(exerciseId), machineProfileId: typeof machineProfileId === "string" && machineProfileId ? machineProfileId : null }];
  }).slice(0, maximumTemplateExercises);
}

export function normalizeTemplateExercises(value: unknown): TemplateExercises {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<TemplateExercises>((output, [key, list]) => {
    const exercises = normalizeExerciseList(list);
    if (key.trim() && exercises.length) output[key] = exercises;
    return output;
  }, {});
}

/**
 * What the finished workout teaches its template: the exercises done, in the order
 * they were done, then any planned exercise left for another day. Removing an
 * exercise from today's plan removes it from the template.
 */
export function learnedTemplateExercises(workout: ActiveWorkout): TemplateExercise[] {
  const progress = workoutSlotProgress(workout);
  const done = workout.completedExercises.map((entry) => ({ exerciseId: entry.exerciseId, machineProfileId: entry.machineProfileId ?? null }));
  const remaining = progress.filter((item) => item.status !== "done").map((item) => ({ exerciseId: item.slot.exerciseId, machineProfileId: item.slot.machineProfileId ?? null }));
  return normalizeExerciseList([...done, ...remaining]);
}

export function sameTemplateExercises(left: readonly TemplateExercise[], right: readonly TemplateExercise[]) {
  return left.length === right.length && left.every((exercise, index) =>
    exercise.exerciseId === right[index].exerciseId && (exercise.machineProfileId ?? null) === (right[index].machineProfileId ?? null));
}
