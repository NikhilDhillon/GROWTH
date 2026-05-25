import { BodyWeightLog, BulkAnalyticsRange, BulkAnalyticsScope, ExerciseScorePoint, MuscleScorePoint } from "@/types";
import { todayIso } from "@/utils/date";

const dayMs = 24 * 60 * 60 * 1000;
const nearZeroPercent = 0.1;

export type BulkAnalyticsInput = BulkAnalyticsScope & {
  range: BulkAnalyticsRange;
  endDate?: string;
  bodyWeightLogs: BodyWeightLog[];
  exercisePoints: ExerciseScorePoint[];
  musclePoints: MuscleScorePoint[];
};

type StrengthScopeInput = BulkAnalyticsScope & {
  exercisePoints: ExerciseScorePoint[];
  musclePoints: MuscleScorePoint[];
};

export type BulkTrendPoint = {
  date: string;
  absoluteStrength: number | null;
  bodyweight: number | null;
  relativeStrength: number | null;
  bulkEfficiency: number | null;
};

export type BulkAnalyticsResult = {
  range: BulkAnalyticsRange;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  previousStrength: number | null;
  currentStrength: number | null;
  previousBodyweight: number | null;
  currentBodyweight: number | null;
  strengthChangePercent: number | null;
  bodyweightChangePercent: number | null;
  relativeStrength: number | null;
  relativeStrengthChangePercent: number | null;
  bulkEfficiency: number | null;
  status: string;
  insight: string;
  trend: BulkTrendPoint[];
};

export function calculatePercentChange(previous: number | null | undefined, current: number | null | undefined) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || !previous) return null;
  return ((Number(current) - Number(previous)) / Number(previous)) * 100;
}

export function calculateRelativeStrength(strengthScore: number | null | undefined, bodyweight: number | null | undefined) {
  if (!Number.isFinite(strengthScore) || !Number.isFinite(bodyweight) || !bodyweight) return null;
  return Number(strengthScore) / Number(bodyweight);
}

export function calculateBulkEfficiency(strengthChangePercent: number | null | undefined, bodyweightChangePercent: number | null | undefined) {
  if (!Number.isFinite(strengthChangePercent) || !Number.isFinite(bodyweightChangePercent)) return null;
  if (Math.abs(Number(bodyweightChangePercent)) < nearZeroPercent) return null;
  return Number(strengthChangePercent) / Number(bodyweightChangePercent);
}

export function getBulkEfficiencyStatus(efficiency: number | null | undefined) {
  if (!Number.isFinite(efficiency)) return "Bodyweight data required";
  if (Number(efficiency) >= 2) return "Excellent";
  if (Number(efficiency) >= 1) return "Good";
  if (Number(efficiency) >= 0.5) return "Average";
  if (Number(efficiency) > 0) return "Poor";
  return "Not Productive";
}

export function getClosestBodyweightForDate(date: string, logs: BodyWeightLog[]) {
  const normalized = normalizeLogs(logs);
  if (!normalized.length) return null;
  const onOrBefore = normalized.filter((log) => log.logged_at.slice(0, 10) <= date).at(-1);
  if (onOrBefore) return onOrBefore;

  const target = toTime(date);
  return normalized.reduce((closest, log) => {
    const currentDistance = Math.abs(toTime(log.logged_at.slice(0, 10)) - target);
    const closestDistance = Math.abs(toTime(closest.logged_at.slice(0, 10)) - target);
    return currentDistance < closestDistance ? log : closest;
  }, normalized[0]);
}

export function calculateAverageBodyweight(startDate: string, endDate: string, logs: BodyWeightLog[]) {
  const selected = normalizeLogs(logs).filter((log) => isWithin(log.logged_at.slice(0, 10), startDate, endDate));
  if (!selected.length) return null;
  return average(selected.map((log) => log.weight));
}

export function calculateAverageStrength(startDate: string, endDate: string, input: StrengthScopeInput) {
  const points = getStrengthPoints(input).filter((point) => isWithin(point.date, startDate, endDate));
  if (!points.length) return null;
  return average(points.map((point) => point.score));
}

export function calculateBulkAnalytics(input: BulkAnalyticsInput): BulkAnalyticsResult {
  const endDate = input.endDate ?? todayIso();
  const periods = getComparisonPeriods(input.range, endDate, input);
  const previousStrength = calculateAverageStrength(periods.previousStart, periods.previousEnd, input);
  const currentStrength = calculateAverageStrength(periods.currentStart, periods.currentEnd, input);
  const previousBodyweight = calculateAverageBodyweight(periods.previousStart, periods.previousEnd, input.bodyWeightLogs);
  const currentBodyweight = calculateAverageBodyweight(periods.currentStart, periods.currentEnd, input.bodyWeightLogs);
  const strengthChangePercent = calculatePercentChange(previousStrength, currentStrength);
  const bodyweightChangePercent = calculatePercentChange(previousBodyweight, currentBodyweight);
  const previousRelativeStrength = calculateRelativeStrength(previousStrength, previousBodyweight);
  const relativeStrength = calculateRelativeStrength(currentStrength, currentBodyweight);
  const relativeStrengthChangePercent = calculatePercentChange(previousRelativeStrength, relativeStrength);
  const bulkEfficiency = calculateBulkEfficiency(strengthChangePercent, bodyweightChangePercent);
  const base = {
    range: input.range,
    periodStart: periods.currentStart,
    periodEnd: periods.currentEnd,
    previousPeriodStart: periods.previousStart,
    previousPeriodEnd: periods.previousEnd,
    previousStrength,
    currentStrength,
    previousBodyweight,
    currentBodyweight,
    strengthChangePercent,
    bodyweightChangePercent,
    relativeStrength,
    relativeStrengthChangePercent,
    bulkEfficiency,
    status: getContextualBulkStatus({ strengthChangePercent, bodyweightChangePercent, bulkEfficiency }),
    insight: "",
    trend: calculateBulkTrend(input)
  };

  return { ...base, insight: generateBulkInsight(base) };
}

export function generateBulkInsight(analytics: Pick<BulkAnalyticsResult, "previousStrength" | "currentStrength" | "previousBodyweight" | "currentBodyweight" | "strengthChangePercent" | "bodyweightChangePercent" | "bulkEfficiency">) {
  if (analytics.previousBodyweight === null || analytics.currentBodyweight === null) return "Bodyweight data required.";
  if (analytics.previousStrength === null || analytics.currentStrength === null) return "Performance Points data required for this scope.";
  const bw = analytics.bodyweightChangePercent ?? 0;
  const strength = analytics.strengthChangePercent ?? 0;
  if (Math.abs(bw) < nearZeroPercent) {
    if (strength > 0.5) return "Recomposition signal. Performance Points are improving without meaningful weight gain.";
    return "Bodyweight change too small to calculate bulk efficiency.";
  }
  if (bw > 0 && strength < -0.5) return "Poor bulk signal. You are gaining weight without Performance Points improvement.";
  if (bw > 0 && Math.abs(strength) <= 0.5) return "Low Efficiency. Bodyweight is rising faster than Performance Points.";
  if (bw > 0 && strength > bw) return "Excellent lean bulk efficiency. Performance Points are increasing faster than bodyweight.";
  if (bw > 0 && strength > 0) return "Productive bulk. Performance Points are increasing alongside bodyweight.";
  if (bw < 0 && strength > 0) return "Excellent Recomposition. Performance Points are improving while bodyweight is decreasing.";
  if (bw < 0 && strength < 0) return "Both bodyweight and Performance Points are down. Review recovery, calories, and training load.";
  return "Bodyweight is rising faster than Performance Points. Consider reducing surplus or improving training quality.";
}

export function calculateBulkTrend(input: BulkAnalyticsInput) {
  const strengthPoints = getStrengthPoints(input);
  const allDates = [...new Set([...strengthPoints.map((point) => point.date), ...normalizeLogs(input.bodyWeightLogs).map((log) => log.logged_at.slice(0, 10))])].sort();
  const trendEndDate = input.endDate ?? todayIso();
  const selectedPeriod = getComparisonPeriods(input.range, trendEndDate, input);
  const dates = input.range === "all"
    ? allDates
    : allDates.filter((date) => isWithin(date, selectedPeriod.currentStart, selectedPeriod.currentEnd));

  return dates.map((date) => {
    const bodyweight = getClosestBodyweightForDate(date, input.bodyWeightLogs)?.weight ?? null;
    const point = strengthPoints.filter((item) => item.date <= date).at(-1);
    const absoluteStrength = point?.score ?? null;
    const relativeStrength = calculateRelativeStrength(absoluteStrength, bodyweight);
    const periods = getComparisonPeriods(input.range, date, input);
    const previousStrength = calculateAverageStrength(periods.previousStart, periods.previousEnd, input);
    const currentStrength = calculateAverageStrength(periods.currentStart, periods.currentEnd, input);
    const previousBodyweight = calculateAverageBodyweight(periods.previousStart, periods.previousEnd, input.bodyWeightLogs);
    const currentBodyweight = calculateAverageBodyweight(periods.currentStart, periods.currentEnd, input.bodyWeightLogs);
    const bulkEfficiency = calculateBulkEfficiency(calculatePercentChange(previousStrength, currentStrength), calculatePercentChange(previousBodyweight, currentBodyweight));
    return {
      date,
      absoluteStrength,
      bodyweight,
      relativeStrength,
      bulkEfficiency
    };
  });
}

function getContextualBulkStatus(input: { strengthChangePercent: number | null; bodyweightChangePercent: number | null; bulkEfficiency: number | null }) {
  const bw = input.bodyweightChangePercent;
  const strength = input.strengthChangePercent;
  if (bw === null || strength === null) return "Bodyweight data required";
  if (Math.abs(bw) < nearZeroPercent) return "Bodyweight change too small";
  if (bw > 0 && strength < -0.5) return "Poor Bulk";
  if (bw > 0 && Math.abs(strength) <= 0.5) return "Low Efficiency";
  if (bw > 0 && strength > bw) return "Productive Bulk";
  if (bw < 0 && strength > 0) return "Excellent Recomposition";
  return getBulkEfficiencyStatus(input.bulkEfficiency);
}

function getStrengthPoints(input: StrengthScopeInput) {
  if (input.scope === "exercise") {
    return input.exercisePoints
      .filter((point) => point.exerciseId === input.exerciseId)
      .map((point) => ({ date: point.date, score: point.score }));
  }
  if (input.scope === "muscle") {
    return input.musclePoints
      .filter((point) => point.muscle === input.muscleGroup)
      .map((point) => ({ date: point.date, score: point.score }));
  }
  return buildOverallStrengthPoints(input.musclePoints);
}

function buildOverallStrengthPoints(points: MuscleScorePoint[]) {
  const byDate = new Map<string, number[]>();
  for (const point of points) {
    byDate.set(point.date, [...(byDate.get(point.date) ?? []), point.score]);
  }
  return [...byDate.entries()]
    .map(([date, scores]) => ({ date, score: average(scores) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getComparisonPeriods(range: BulkAnalyticsRange, endDate: string, input: BulkAnalyticsInput) {
  if (range !== "all") {
    const days = Number(range.replace("d", ""));
    const currentEnd = endDate;
    const currentStart = addDays(currentEnd, -(days - 1));
    const previousEnd = addDays(currentStart, -1);
    const previousStart = addDays(previousEnd, -(days - 1));
    return { currentStart, currentEnd, previousStart, previousEnd };
  }

  const dates = [
    ...getStrengthPoints(input).map((point) => point.date),
    ...normalizeLogs(input.bodyWeightLogs).map((log) => log.logged_at.slice(0, 10))
  ].sort();
  const firstDate = dates[0] ?? endDate;
  const lastDate = dates.at(-1) ?? endDate;
  const totalDays = Math.max(2, Math.round((toTime(lastDate) - toTime(firstDate)) / dayMs) + 1);
  const half = Math.max(1, Math.floor(totalDays / 2));
  const previousStart = firstDate;
  const previousEnd = addDays(firstDate, half - 1);
  const currentStart = addDays(previousEnd, 1);
  const currentEnd = lastDate;
  return { currentStart, currentEnd, previousStart, previousEnd };
}

function normalizeLogs(logs: BodyWeightLog[]) {
  return [...logs]
    .map((log) => ({ ...log, logged_at: log.logged_at ?? `${log.logged_date ?? log.created_at.slice(0, 10)}T12:00:00.000Z` }))
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at));
}

function isWithin(date: string, startDate: string, endDate: string) {
  return date >= startDate && date <= endDate;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function toTime(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}
