import { ExerciseScorePoint, WorkoutSet } from "@/types";
import { weightFromStorageUnit } from "@/utils/units";
import { UnitSystem } from "@/types";

export function detectPersonalRecords(points: ExerciseScorePoint[]) {
  const bestStrength = maxBy(points, (point) => point.score);
  const bestVolume = maxBy(points, (point) => point.volume);
  const bestTopSet = maxBy(points, (point) => point.topSet);

  return { bestStrength, bestVolume, bestTopSet };
}

export function weeklyVolume(sets: WorkoutSet[], unitSystem: UnitSystem = "lb") {
  const buckets = new Map<string, number>();
  for (const set of sets) {
    const date = new Date(`${set.created_at.slice(0, 10)}T00:00:00`);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + weightFromStorageUnit(set.weight, unitSystem) * set.reps);
  }

  return [...buckets.entries()].map(([date, volume]) => ({ date, volume })).sort((a, b) => a.date.localeCompare(b.date));
}

export function weeklyScoreAverages(points: Pick<ExerciseScorePoint, "date" | "score">[]) {
  return scoreAverages(points, "week");
}

export function monthlyScoreAverages(points: Pick<ExerciseScorePoint, "date" | "score">[]) {
  return scoreAverages(points, "month");
}

function scoreAverages(points: Pick<ExerciseScorePoint, "date" | "score">[], period: "week" | "month") {
  const buckets = new Map<string, number[]>();

  for (const point of points) {
    const key = period === "week" ? weekStartIso(point.date) : point.date.slice(0, 7);
    buckets.set(key, [...(buckets.get(key) ?? []), point.score]);
  }

  return [...buckets.entries()]
    .map(([date, scores]) => ({
      date,
      score: scores.reduce((total, score) => total + score, 0) / scores.length
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function weekStartIso(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  return weekStart.toISOString().slice(0, 10);
}

function maxBy<T>(items: T[], score: (item: T) => number) {
  return items.reduce<T | undefined>((best, item) => {
    if (!best || score(item) > score(best)) return item;
    return best;
  }, undefined);
}
