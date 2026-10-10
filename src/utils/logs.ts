import { ExerciseLoadType, getExerciseLoadType } from "@/constants/exercises";
import { Exercise, ExerciseScorePoint, MachineProfile, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { formatWeight } from "@/utils/units";

export type PreviousLog = {
  date: string;
  sessionId: number;
  exerciseId: number;
  exerciseName: string;
  machineProfileId?: string | null;
  machineProfileLabel?: string | null;
  sets: string[];
  /** Observed sets in set order, for visual summaries. */
  rawSets: Array<{ reps: number; weight: number; isWarmup: boolean }>;
  loadType: ExerciseLoadType;
  score: number;
  point?: ExerciseScorePoint;
};

export function buildPreviousLogs(input: { exerciseId?: number; exercises: Exercise[]; sessions: WorkoutSession[]; sets: WorkoutSet[]; points: ExerciseScorePoint[]; unitSystem: UnitSystem; machineProfiles?: MachineProfile[] }) {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const exerciseById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const machineProfileById = new Map((input.machineProfiles ?? []).map((profile) => [profile.id, profile]));
  const groupedSets = input.sets
    .filter((set) => !input.exerciseId || set.exercise_id === input.exerciseId)
    .slice()
    .sort((a, b) => a.session_id - b.session_id || a.set_number - b.set_number)
    .reduce<Record<string, { date: string; sessionId: number; exerciseId: number; machineProfileId?: string | null; sets: string[]; rawSets: PreviousLog["rawSets"] }>>((groups, set) => {
      const session = sessionById.get(set.session_id);
      const date = session?.workout_date ?? set.created_at.slice(0, 10);
      const key = String(set.session_id);
      const machineProfileId = session?.machine_profile_id ?? null;
      const existing = groups[key] ?? { date, sessionId: set.session_id, exerciseId: set.exercise_id, machineProfileId, sets: [], rawSets: [] };
      return {
        ...groups,
        [key]: {
          ...existing,
          sets: [...existing.sets, `${set.is_warmup ? "Warm-up: " : ""}${formatLoggedLoad(set.weight, getExerciseLoadType(exerciseById.get(set.exercise_id)?.name ?? ""), input.unitSystem)} x ${set.reps}`],
          rawSets: [...existing.rawSets, { reps: set.reps, weight: set.weight, isWarmup: Boolean(set.is_warmup) }]
        }
      };
    }, {});

  return Object.values(groupedSets)
    .map((log): PreviousLog => {
      const point = input.points.find((item) => item.sessionId === log.sessionId);
      const exerciseName = exerciseById.get(log.exerciseId)?.name ?? "Exercise";
      return {
        ...log,
        exerciseName,
        loadType: getExerciseLoadType(exerciseName),
        machineProfileLabel: log.machineProfileId ? machineProfileById.get(log.machineProfileId)?.label ?? null : null,
        score: point?.performancePoints ?? 0,
        point
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);
}

export function formatLoggedLoad(weight: number, loadType: ExerciseLoadType, unitSystem: UnitSystem) {
  if (loadType === "machine_stack") {
    return `Stack ${formatWeight(weight, unitSystem)}`;
  }
  if (loadType === "bodyweight_plus_load") {
    return weight === 0 ? "Body weight" : `Body weight + ${formatWeight(weight, unitSystem)}`;
  }
  if (loadType === "bodyweight_minus_assistance") {
    return weight === 0 ? "Body weight" : `Body weight - ${formatWeight(weight, unitSystem)} assistance`;
  }
  return formatWeight(weight, unitSystem);
}
