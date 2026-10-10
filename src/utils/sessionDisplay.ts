import type { ExerciseScorePoint } from "@/types";
import { pointContextKey } from "@/services/analytics/growthReport";

export type DisplaySet = { reps: number; weight: number; isWarmup: boolean };
export type SetGroup = { load: string; reps: number[]; warmup: boolean };
export type SessionProgress = { e1RMDelta: number | null; isPR: boolean };

/**
 * Collapses consecutive sets at the same load and kind: 160×7, 160×6, 160×5
 * reads as "160 lb × 7 · 6 · 5" instead of repeating the load on every set.
 */
export function groupSetsForDisplay(sets: DisplaySet[], formatLoad: (weight: number) => string): SetGroup[] {
  return sets.reduce<SetGroup[]>((groups, set) => {
    const load = formatLoad(set.weight);
    const last = groups[groups.length - 1];
    if (last && last.load === load && last.warmup === set.isWarmup) {
      last.reps.push(set.reps);
      return groups;
    }
    return [...groups, { load, reps: [set.reps], warmup: set.isWarmup }];
  }, []);
}

/**
 * Change in estimated 1RM against the previous comparable session, and whether a
 * session set a new best. Comparisons stay within one equipment context so a
 * different machine is never reported as progress.
 */
export function annotateSessionProgress(points: ExerciseScorePoint[]) {
  const byContext = new Map<string, ExerciseScorePoint[]>();
  for (const point of points) {
    if (point.comparability === "self_context") continue;
    const key = `${point.exerciseId}|${pointContextKey(point)}`;
    byContext.set(key, [...(byContext.get(key) ?? []), point]);
  }
  const result = new Map<number, SessionProgress>();
  for (const history of byContext.values()) {
    const ordered = [...history].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
    let best: number | null = null;
    let previous: number | null = null;
    for (const point of ordered) {
      result.set(point.sessionId, {
        e1RMDelta: previous === null ? null : point.estimated1RM - previous,
        isPR: best !== null && point.estimated1RM > best + 1e-9
      });
      best = best === null ? point.estimated1RM : Math.max(best, point.estimated1RM);
      previous = point.estimated1RM;
    }
  }
  return result;
}

export function sessionVolume(sets: DisplaySet[]) {
  return sets.filter((set) => !set.isWarmup).reduce((total, set) => total + set.weight * set.reps, 0);
}
