/**
 * Personal exercises: movements missing from the shared catalog. Each belongs to its
 * creator, is visible to split-sync friends in the cloud, and carries its own load type.
 * Names can never repeat a catalog name, so leaderboards stay catalog-only.
 */
import { exerciseLoadTypes } from "@/constants/exercises";
import type { CustomExerciseInput, Exercise } from "@/types";
import { muscles } from "@/utils/theme";

export const customExerciseLimit = 200;

export function cleanExerciseName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

/** The visible exercise a new name would repeat: catalog, your own, or one shared with you. */
export function existingExerciseNamed(exercises: readonly Exercise[], name: string) {
  const key = cleanExerciseName(name).toLowerCase();
  return key ? exercises.find((exercise) => exercise.name.toLowerCase() === key) ?? null : null;
}

export function assertCustomExercise(input: CustomExerciseInput): CustomExerciseInput {
  const name = cleanExerciseName(String(input.name ?? ""));
  if (name.length < 2 || name.length > 60) throw new Error("Exercise names need 2 to 60 characters.");
  if (!(muscles as readonly string[]).includes(input.primaryMuscle)) throw new Error("Choose the main muscle this exercise trains.");
  if (!exerciseLoadTypes.includes(input.loadType)) throw new Error("Choose how this exercise is loaded.");
  return { name, primaryMuscle: input.primaryMuscle, loadType: input.loadType };
}

export function isCustomExercise(exercise: Pick<Exercise, "name" | "creator_id">) {
  return exercise.creator_id !== null && exercise.creator_id !== undefined;
}
