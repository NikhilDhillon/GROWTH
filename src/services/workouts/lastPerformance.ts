/** What you did last time on an exercise, for flow mode's set row and its swap list. */
import type { WorkoutSession, WorkoutSet } from "@/types";

export type LastSession = { date: string; sets: Array<{ weight: number; reps: number }> };

const dayMs = 86_400_000;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
}

/** "today", "yesterday", "4 days ago", "3 weeks ago", "5 months ago". */
export function timeAgo(date: string, today: string) {
  const days = daysBetween(date, today);
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** "today", "3d", "2w", "5mo". */
export function shortAgo(date: string, today: string) {
  const days = daysBetween(date, today);
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** The latest earlier session of an exercise: its date and working sets, in stored units. */
export function latestSession(input: { exerciseId: number; sessions: readonly WorkoutSession[]; sets: readonly WorkoutSet[]; before: string }): LastSession | null {
  const dates = new Map(input.sessions.map((session) => [session.id, session.workout_date]));
  let latest: { id: number; date: string } | null = null;
  for (const set of input.sets) {
    if (set.exercise_id !== input.exerciseId || set.is_warmup) continue;
    const date = dates.get(set.session_id);
    if (!date || date >= input.before) continue;
    if (!latest || date > latest.date || (date === latest.date && set.session_id > latest.id)) latest = { id: set.session_id, date };
  }
  if (!latest) return null;
  const sets = input.sets.filter((set) => set.session_id === latest!.id && set.exercise_id === input.exerciseId && !set.is_warmup)
    .sort((a, b) => a.set_number - b.set_number).map((set) => ({ weight: set.weight, reps: set.reps }));
  return { date: latest.date, sets };
}
