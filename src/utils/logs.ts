import { Exercise, ExerciseScorePoint, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { formatWeight } from "@/utils/units";

export type PreviousLog = {
  date: string;
  sessionId: number;
  exerciseId: number;
  exerciseName: string;
  sets: string[];
  score: number;
};

export function buildPreviousLogs(input: { exerciseId?: number; exercises: Exercise[]; sessions: WorkoutSession[]; sets: WorkoutSet[]; points: ExerciseScorePoint[]; unitSystem: UnitSystem }) {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const groupedSets = input.sets
    .filter((set) => !input.exerciseId || set.exercise_id === input.exerciseId)
    .reduce<Record<string, { date: string; sessionId: number; exerciseId: number; sets: string[] }>>((groups, set) => {
      const date = sessionById.get(set.session_id)?.workout_date ?? set.created_at.slice(0, 10);
      const key = String(set.session_id);
      const existing = groups[key] ?? { date, sessionId: set.session_id, exerciseId: set.exercise_id, sets: [] };
      return {
        ...groups,
        [key]: {
          ...existing,
          sets: [...existing.sets, `${formatWeight(set.weight, input.unitSystem)} x ${set.reps}`]
        }
      };
    }, {});

  return Object.values(groupedSets)
    .map((log): PreviousLog => ({
      ...log,
      exerciseName: input.exercises.find((exercise) => exercise.id === log.exerciseId)?.name ?? "Exercise",
      score: input.points.find((point) => point.sessionId === log.sessionId)?.score ?? 0
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);
}
