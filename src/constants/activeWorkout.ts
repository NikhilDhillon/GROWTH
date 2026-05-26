import { ActiveWorkout, ActiveWorkoutExerciseDraft, MuscleGroup, SplitMuscle, TrainingSplitDay } from "@/types";
import { todayIso } from "@/utils/date";

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function emptyActiveExercise(): ActiveWorkoutExerciseDraft {
  return {
    muscle: null,
    exerciseId: null,
    sets: [{ reps: "", weight: "" }, { reps: "", weight: "" }, { reps: "", weight: "" }],
    notes: "",
    barWeight: "45",
    plateCounts: { 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 }
  };
}

export function todaySplitDay(days: TrainingSplitDay[]) {
  const dayKey = dayKeys[new Date().getDay()];
  return days.find((day) => day.key === dayKey) ?? days[0];
}

export function createActiveWorkout(day: TrainingSplitDay): ActiveWorkout {
  return {
    startedAt: new Date().toISOString(),
    workoutDate: todayIso(),
    todayDayKey: day.key,
    sourceDayKey: day.key,
    plannedMuscles: [...day.muscles],
    completedExercises: [],
    currentExercise: emptyActiveExercise(),
    pendingMuscle: null,
    schedulePrompt: null
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
  return {
    startedAt: input.startedAt,
    workoutDate: input.workoutDate,
    todayDayKey: input.todayDayKey,
    sourceDayKey: input.sourceDayKey,
    plannedMuscles: input.plannedMuscles as SplitMuscle[],
    completedExercises: Array.isArray(input.completedExercises) ? input.completedExercises : [],
    currentExercise: input.currentExercise ?? emptyActiveExercise(),
    pendingMuscle: input.pendingMuscle ?? null,
    schedulePrompt: input.schedulePrompt === "off_plan" || input.schedulePrompt === "replace" ? input.schedulePrompt : null
  };
}
