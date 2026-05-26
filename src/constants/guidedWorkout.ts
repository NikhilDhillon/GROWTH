import { GuidedExerciseCategory, GuidedWorkoutPreferences } from "@/types";

const defaultTopSetExercises = new Set([
  "Barbell Bench Press",
  "Back Squat",
  "Conventional Deadlift",
  "Incline Dumbbell Press"
]);
const defaultStrengthExercises = new Set([
  "Barbell Curl",
  "Romanian Deadlift",
  "Overhead Press",
  "Barbell Row"
]);
const defaultUnguidedExercises = new Set([
  "Weighted Dip",
  "Assisted Dip",
  "Pull-Up",
  "Chin-Up"
]);

export const guidedCategoryLabels: Record<GuidedExerciseCategory, string> = {
  hypertrophy: "Hypertrophy",
  strength: "Strength",
  top_set: "Top-set",
  unguided: "Pull-ups / dips"
};

export function createDefaultGuidedWorkoutPreferences(): GuidedWorkoutPreferences {
  return {
    hypertrophyTargetReps: 12,
    hypertrophyRepDecrement: 2,
    strengthTargetReps: 8,
    topSetTargetReps: 8,
    backoffPercentage: 80,
    inactivityDays: 14,
    exerciseCategories: {}
  };
}

export function categoryForExercise(name: string, preferences: GuidedWorkoutPreferences): GuidedExerciseCategory {
  const selected = preferences.exerciseCategories[name];
  if (selected) return selected;
  if (defaultTopSetExercises.has(name)) return "top_set";
  if (defaultStrengthExercises.has(name)) return "strength";
  if (defaultUnguidedExercises.has(name)) return "unguided";
  return "hypertrophy";
}

export function normalizeGuidedWorkoutPreferences(value: unknown): GuidedWorkoutPreferences {
  const defaults = createDefaultGuidedWorkoutPreferences();
  if (!value || typeof value !== "object") return defaults;
  const input = value as Partial<GuidedWorkoutPreferences>;
  const categories = Object.entries(input.exerciseCategories ?? {}).reduce<Record<string, GuidedExerciseCategory>>((output, [name, category]) => {
    if (category === "hypertrophy" || category === "strength" || category === "top_set" || category === "unguided") {
      output[name] = category;
    }
    return output;
  }, {});
  return {
    hypertrophyTargetReps: positiveInteger(input.hypertrophyTargetReps, defaults.hypertrophyTargetReps),
    hypertrophyRepDecrement: positiveInteger(input.hypertrophyRepDecrement, defaults.hypertrophyRepDecrement),
    strengthTargetReps: positiveInteger(input.strengthTargetReps, defaults.strengthTargetReps),
    topSetTargetReps: positiveInteger(input.topSetTargetReps, defaults.topSetTargetReps),
    backoffPercentage: percentage(input.backoffPercentage, defaults.backoffPercentage),
    inactivityDays: positiveInteger(input.inactivityDays, defaults.inactivityDays),
    exerciseCategories: categories
  };
}

function positiveInteger(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function percentage(value: unknown, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100 ? Number(value) : fallback;
}
