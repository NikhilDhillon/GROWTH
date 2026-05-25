import { Exercise, ExerciseScorePoint, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { formatWeight } from "@/utils/units";

export type PreviousLog = {
  date: string;
  sessionId: number;
  exerciseId: number;
  exerciseName: string;
  sets: string[];
  score: number;
  point?: ExerciseScorePoint;
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
    .map((log): PreviousLog => {
      const point = input.points.find((item) => item.sessionId === log.sessionId);
      return {
        ...log,
        exerciseName: input.exercises.find((exercise) => exercise.id === log.exerciseId)?.name ?? "Exercise",
        score: point?.performancePoints ?? 0,
        point
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);
}
