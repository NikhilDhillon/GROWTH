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
  score: number;
  point?: ExerciseScorePoint;
};

export function buildPreviousLogs(input: { exerciseId?: number; exercises: Exercise[]; sessions: WorkoutSession[]; sets: WorkoutSet[]; points: ExerciseScorePoint[]; unitSystem: UnitSystem; machineProfiles?: MachineProfile[] }) {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const exerciseById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const machineProfileById = new Map((input.machineProfiles ?? []).map((profile) => [profile.id, profile]));
  const groupedSets = input.sets
    .filter((set) => !input.exerciseId || set.exercise_id === input.exerciseId)
    .reduce<Record<string, { date: string; sessionId: number; exerciseId: number; machineProfileId?: string | null; sets: string[] }>>((groups, set) => {
      const session = sessionById.get(set.session_id);
      const date = session?.workout_date ?? set.created_at.slice(0, 10);
      const key = String(set.session_id);
      const machineProfileId = session?.machine_profile_id ?? null;
      const existing = groups[key] ?? { date, sessionId: set.session_id, exerciseId: set.exercise_id, machineProfileId, sets: [] };
      return {
        ...groups,
        [key]: {
          ...existing,
          sets: [...existing.sets, `${set.is_warmup ? "Warm-up: " : ""}${formatLoggedLoad(set.weight, getExerciseLoadType(exerciseById.get(set.exercise_id)?.name ?? ""), input.unitSystem)} x ${set.reps}`]
        }
      };
    }, {});

  return Object.values(groupedSets)
    .map((log): PreviousLog => {
      const point = input.points.find((item) => item.sessionId === log.sessionId);
      return {
        ...log,
        exerciseName: input.exercises.find((exercise) => exercise.id === log.exerciseId)?.name ?? "Exercise",
        machineProfileLabel: log.machineProfileId ? machineProfileById.get(log.machineProfileId)?.label ?? null : null,
        score: point?.performancePoints ?? 0,
        point
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);
}

function formatLoggedLoad(weight: number, loadType: ExerciseLoadType, unitSystem: UnitSystem) {
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
