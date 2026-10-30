import { ActiveWorkout, ActiveWorkoutExerciseDraft, CompletedGuidedWorkout, MuscleGroup, SplitMuscle, TrainingSplitDay, WorkoutRest, WorkoutSlot } from "@/types";
import { todayIso } from "@/utils/date";
import { calendarWeekday } from "@/domain/calendar";
import { createRequestId } from "@/utils/requestId";
import { normalizeWorkoutSlots } from "@/services/workouts/workoutSlots";

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
  const dayKey = calendarWeekday(todayIso());
  return days.find((day) => day.key === dayKey) ?? days[0];
}

export function createActiveWorkout(day: TrainingSplitDay, workoutLabel?: string, templateId?: string, slots: WorkoutSlot[] = []): ActiveWorkout {
  const workoutDate = todayIso();
  const todayDayKey = calendarWeekday(workoutDate);
  return {
    workoutId: createRequestId(),
    revision: 0,
    startedAt: new Date().toISOString(),
    workoutDate,
    todayDayKey,
    sourceDayKey: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(day.key) ? day.key : todayDayKey,
    workoutLabel,
    ...(templateId ? { templateId } : {}),
    plannedMuscles: [...day.muscles],
    completedExercises: [],
    slots,
    rest: null,
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
    ...input,
    workoutId: typeof input.workoutId === "string" ? input.workoutId : undefined,
    revision: Number.isSafeInteger(input.revision) && Number(input.revision) >= 0 ? input.revision : undefined,
    startedAt: input.startedAt,
    workoutDate: input.workoutDate,
    todayDayKey: input.todayDayKey,
    sourceDayKey: input.sourceDayKey,
    workoutLabel: typeof input.workoutLabel === "string" ? input.workoutLabel : undefined,
    templateId: typeof input.templateId === "string" ? input.templateId : undefined,
    plannedMuscles: normalizedPlannedMuscles,
    completedExercises: Array.isArray(input.completedExercises) ? input.completedExercises : [],
    ...(input.slots !== undefined ? { slots: normalizeWorkoutSlots(input.slots) ?? [] } : {}),
    ...(input.rest !== undefined ? { rest: normalizeWorkoutRest(input.rest) } : {}),
    currentExercise: normalizeActiveExercise(input.currentExercise),
    ...(input.parkedExercises !== undefined ? { parkedExercises: normalizeParkedExercises(input.parkedExercises) } : {}),
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
    ...input,
    prescription: input.prescription,
    muscle: input.muscle ?? null,
    slotId: typeof input.slotId === "string" ? input.slotId : undefined,
    requestId: typeof input.requestId === "string" ? input.requestId : undefined,
    requestUnit: input.requestUnit === "lb" || input.requestUnit === "kg" ? input.requestUnit : undefined,
    exerciseId: typeof input.exerciseId === "number" ? input.exerciseId : null,
    machineProfileId: typeof input.machineProfileId === "string" ? input.machineProfileId : null,
    sets: Array.isArray(input.sets) ? input.sets : defaults.sets,
    notes: typeof input.notes === "string" ? input.notes : "",
    barWeight: typeof input.barWeight === "string" ? input.barWeight : defaults.barWeight,
    plateCounts: input.plateCounts && typeof input.plateCounts === "object" ? input.plateCounts : defaults.plateCounts
  };
}

/** A set-aside draft is only kept with its slot and exercise, once per slot. */
function normalizeParkedExercises(value: unknown): ActiveWorkoutExerciseDraft[] {
  if (!Array.isArray(value)) return [];
  const slots = new Set<string>();
  return value.map(normalizeActiveExercise).filter((draft) => {
    if (!draft.slotId || draft.exerciseId === null || slots.has(draft.slotId)) return false;
    slots.add(draft.slotId);
    return true;
  });
}

function normalizeWorkoutRest(value: unknown): WorkoutRest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<WorkoutRest>;
  if (typeof input.startedAt !== "string" || !Number.isFinite(Date.parse(input.startedAt)) || !Number.isSafeInteger(input.seconds) || Number(input.seconds) <= 0) return null;
  return {
    startedAt: input.startedAt, seconds: Number(input.seconds),
    exerciseId: Number.isSafeInteger(input.exerciseId) ? input.exerciseId : null,
    setIndex: Number.isSafeInteger(input.setIndex) && Number(input.setIndex) >= 0 ? input.setIndex : null
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
  });
}
