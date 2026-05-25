import { ExerciseScorePoint, WorkoutSet } from "@/types";
import { todayIso } from "@/utils/date";
import { weightFromStorageUnit } from "@/utils/units";
import { UnitSystem } from "@/types";

export function detectPersonalRecords(points: ExerciseScorePoint[]) {
  const bestPerformance = maxBy(points, (point) => point.score);
  const bestVolume = maxBy(points, (point) => point.volume);
  const bestTopSet = maxBy(points, (point) => point.topSet);

  return { bestPerformance, bestVolume, bestTopSet };
}

export type ProgressComparisonRange = "week" | "month" | "year";

export type PerformancePeriodComparison = {
  range: ProgressComparisonRange;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  currentAverage: number | null;
  previousAverage: number | null;
  changePercent: number | null;
};

export function comparePerformancePeriods(
  points: Pick<ExerciseScorePoint, "date" | "score">[],
  range: ProgressComparisonRange,
  endDate = todayIso()
): PerformancePeriodComparison {
  const days = rangeDays(range);
  const currentStart = addDays(endDate, -(days - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  const currentAverage = averageScores(points, currentStart, endDate);
  const previousAverage = averageScores(points, previousStart, previousEnd);
  const changePercent = previousAverage !== null && previousAverage !== 0 && currentAverage !== null
    ? ((currentAverage - previousAverage) / previousAverage) * 100
    : null;

  return {
    range,
    currentStart,
    currentEnd: endDate,
    previousStart,
    previousEnd,
    currentAverage,
    previousAverage,
    changePercent
  };
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

function averageScores(points: Pick<ExerciseScorePoint, "date" | "score">[], startDate: string, endDate: string) {
  const selected = points.filter((point) => point.date >= startDate && point.date <= endDate);
  if (!selected.length) return null;
  return selected.reduce((total, point) => total + point.score, 0) / selected.length;
}

function rangeDays(range: ProgressComparisonRange) {
  if (range === "week") return 7;
  if (range === "month") return 30;
  return 365;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function maxBy<T>(items: T[], score: (item: T) => number) {
  return items.reduce<T | undefined>((best, item) => {
    if (!best || score(item) > score(best)) return item;
    return best;
  }, undefined);
}
