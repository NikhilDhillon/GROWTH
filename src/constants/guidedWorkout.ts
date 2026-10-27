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

/** Flow mode's rest between sets: 1:30 to 5:00, in five-second steps. */
export const restLimits = { min: 90, max: 300, default: 90 } as const;

export function clampRestSeconds(seconds: number) {
  return Math.min(restLimits.max, Math.max(restLimits.min, Math.round(seconds / 5) * 5));
}

export function createDefaultGuidedWorkoutPreferences(): GuidedWorkoutPreferences {
  return {
    hypertrophyTargetReps: 12,
    hypertrophyRepDecrement: 2,
    strengthTargetReps: 8,
    topSetTargetReps: 8,
    backoffPercentage: 80,
    inactivityDays: 14,
    exerciseCategories: {},
    flowMode: false,
    restSeconds: restLimits.default
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
    exerciseCategories: categories,
    flowMode: input.flowMode === true,
    restSeconds: Number.isFinite(input.restSeconds) ? clampRestSeconds(Number(input.restSeconds)) : defaults.restSeconds,
    ...(input.loadSteps !== undefined ? { loadSteps: normalizeLoadSteps(input.loadSteps) } : {})
  };
}

/** A dial step is a plain positive number no bigger than a few plates. */
export function isLoadStep(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}

function normalizeLoadSteps(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([key, step]) => key && isLoadStep(step)));
}

function positiveInteger(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function percentage(value: unknown, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100 ? Number(value) : fallback;
}
