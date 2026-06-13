import { ActiveWorkout, ActiveWorkoutExerciseDraft, CompletedGuidedWorkout, MuscleGroup, SplitMuscle, TrainingSplitDay } from "@/types";
import { todayIso } from "@/utils/date";

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function emptyActiveExercise(): ActiveWorkoutExerciseDraft {
  return {
    muscle: null,
    exerciseId: null,
    sets: [{ reps: "", weight: "" }, { reps: "", weight: "" }, { reps: "", weight: "" }],
    notes: "",
    machineProfileId: null,
    barWeight: "45",
    plateCounts: { 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 }
  };
}

export function todaySplitDay(days: TrainingSplitDay[]) {
  const dayKey = dayKeys[new Date().getDay()];
  return days.find((day) => day.key === dayKey) ?? days[0];
}

export function createActiveWorkout(day: TrainingSplitDay, workoutLabel?: string): ActiveWorkout {
  return {
    startedAt: new Date().toISOString(),
    workoutDate: todayIso(),
    todayDayKey: day.key,
    sourceDayKey: day.key,
    workoutLabel,
    plannedMuscles: [...day.muscles],
    completedExercises: [],
    currentExercise: emptyActiveExercise(),
    pendingMuscle: null,
    schedulePrompt: null,
    scheduleChanges: []
  };
}

export function splitMuscleToExerciseMuscle(muscle: SplitMuscle): MuscleGroup {
  return muscle === "Abs" ? "Core" : muscle;
}

export function exerciseMuscleToSplitMuscle(muscle: MuscleGroup): SplitMuscle {
  return muscle === "Core" ? "Abs" : muscle;
}

export function activePlannedExerciseMuscles(workout: ActiveWorkout) {
  return workout.plannedMuscles.map(splitMuscleToExerciseMuscle);
}

export function normalizeActiveWorkout(value: unknown): ActiveWorkout | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ActiveWorkout>;
  if (
    typeof input.startedAt !== "string" ||
    typeof input.workoutDate !== "string" ||
    typeof input.todayDayKey !== "string" ||
    typeof input.sourceDayKey !== "string" ||
    !Array.isArray(input.plannedMuscles)
  ) return null;
  const plannedMuscles = input.plannedMuscles as SplitMuscle[];
  const normalizedPlannedMuscles = input.workoutLabel === "Legs / Shoulders / Traps" && !plannedMuscles.includes("Traps")
    ? [...plannedMuscles, "Traps" as const]
    : plannedMuscles;
  return {
    startedAt: input.startedAt,
    workoutDate: input.workoutDate,
    todayDayKey: input.todayDayKey,
    sourceDayKey: input.sourceDayKey,
    workoutLabel: typeof input.workoutLabel === "string" ? input.workoutLabel : undefined,
    plannedMuscles: normalizedPlannedMuscles,
    completedExercises: Array.isArray(input.completedExercises) ? input.completedExercises : [],
    currentExercise: normalizeActiveExercise(input.currentExercise),
    pendingMuscle: input.pendingMuscle ?? null,
    schedulePrompt: input.schedulePrompt === "off_plan" || input.schedulePrompt === "replace" ? input.schedulePrompt : null,
    scheduleChanges: Array.isArray(input.scheduleChanges) ? input.scheduleChanges.filter((message): message is string => typeof message === "string") : []
  };
}

function normalizeActiveExercise(value: unknown): ActiveWorkoutExerciseDraft {
  const defaults = emptyActiveExercise();
  if (!value || typeof value !== "object") return defaults;
  const input = value as Partial<ActiveWorkoutExerciseDraft>;
  return {
    muscle: input.muscle ?? null,
    exerciseId: typeof input.exerciseId === "number" ? input.exerciseId : null,
    machineProfileId: typeof input.machineProfileId === "string" ? input.machineProfileId : null,
    sets: Array.isArray(input.sets) ? input.sets : defaults.sets,
    notes: typeof input.notes === "string" ? input.notes : "",
    barWeight: typeof input.barWeight === "string" ? input.barWeight : defaults.barWeight,
    plateCounts: input.plateCounts && typeof input.plateCounts === "object" ? input.plateCounts : defaults.plateCounts
  };
}

export function normalizeCompletedGuidedWorkouts(value: unknown): CompletedGuidedWorkout[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const input = record as Partial<CompletedGuidedWorkout>;
    const workout = normalizeActiveWorkout(input);
    if (!workout || typeof input.id !== "string" || typeof input.finishedAt !== "string") return [];
    return [{ ...workout, id: input.id, finishedAt: input.finishedAt }];
  }).slice(0, 50);
}
