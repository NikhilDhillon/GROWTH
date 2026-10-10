import { catalogExercises, getExerciseLoadType } from "@/constants/exercises";
import { assertCalendarDate, isCalendarDate } from "@/domain/calendar";
import { calculateSessionPerformance } from "@/services/strength/strengthService";
import type { Exercise, LeaderboardEntry, WorkoutSession, WorkoutSet } from "@/types";

/** Cross-user ranking uses absolute loads, never personal baseline indexes or private machine tags. */
export function buildCanonicalLeaderboard(input: {
  exercises: Exercise[]; sessions: Array<WorkoutSession & { user_id: string }>; sets: Array<WorkoutSet & { user_id: string }>;
  names: Map<string, string>; allowedUserIds: Set<string>; asOfDate: string;
}): LeaderboardEntry[] {
  assertCalendarDate(input.asOfDate);
  const exercises = new Map(input.exercises.map((e) => [e.id, e]));
  const duplicateSessionIds = new Set(input.sessions.filter((s, index) => input.sessions.findIndex((other) => other.id === s.id) !== index).map((s) => s.id));
  const sessions = new Map(input.sessions.filter((s) => input.allowedUserIds.has(s.user_id) && isCalendarDate(s.workout_date)
    && s.workout_date <= input.asOfDate && !duplicateSessionIds.has(s.id)).map((s) => [s.id, s]));
  const groups = new Map<number, Array<WorkoutSet & { user_id: string }>>();
  const identities = new Map<number, number>();
  for (const set of input.sets) {
    const session = sessions.get(set.session_id);
    if (!session || session.user_id !== set.user_id) continue;
    groups.set(set.session_id, [...(groups.get(set.session_id) ?? []), set]);
    identities.set(set.id, (identities.get(set.id) ?? 0) + 1);
  }
  const best = new Map<string, LeaderboardEntry>();
  for (const [id, sets] of groups) {
    const session = sessions.get(id)!;
    const exercise = exercises.get(sets[0].exercise_id);
    if (!exercise || sets.some((set) => set.exercise_id !== exercise.id)) continue;
    if (sets.some((set) => !set.is_warmup && (!Number.isSafeInteger(set.id) || set.id <= 0 || identities.get(set.id) !== 1))) continue;
    // The catalog must positively establish external load semantics. Unknown
    // names, private stacks and bodyweight-dependent effective loads cannot be ranked here.
    if (!catalogExercises.some((e) => e.name === exercise.name) || getExerciseLoadType(exercise.name) !== "external") continue;
    const metrics = calculateSessionPerformance(sets, undefined, { loadType: "external" });
    if (!metrics) continue;
    const entry: LeaderboardEntry = { user_id: session.user_id, name: input.names.get(session.user_id) ?? "Friend", exercise_id: exercise.id,
      exercise_name: exercise.name, best_estimated_1rm: metrics.estimated1RM, achieved_at: session.workout_date,
      best_sets: sets.filter((s) => !s.is_warmup).sort((a, b) => a.set_number - b.set_number).map((s) => ({ weight: s.weight, reps: s.reps })) };
    const key = `${entry.user_id}:${entry.exercise_id}`;
    const previous = best.get(key);
    if (!previous || entry.best_estimated_1rm > previous.best_estimated_1rm
      || entry.best_estimated_1rm === previous.best_estimated_1rm && entry.achieved_at > previous.achieved_at) best.set(key, entry);
  }
  return [...best.values()].sort((a, b) => a.exercise_id - b.exercise_id || b.best_estimated_1rm - a.best_estimated_1rm || a.name.localeCompare(b.name));
}
