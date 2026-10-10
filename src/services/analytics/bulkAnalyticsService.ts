import { BodyWeightLog, BulkAnalyticsRange, BulkAnalyticsScope, ExerciseScorePoint, MuscleScorePoint } from "@/types";
import { bodyWeightObservationDate, calculateAverageBodyweight, getBodyweightEstimateForDate, normalizeBodyWeightLogs } from "@/services/body/bodyWeightService";
import { pointContextKey } from "@/services/analytics/growthReport";
import { growthMetricVersion, trainingMaximumAgeCalendarDays } from "@/services/strength/strengthService";
import { todayIso } from "@/utils/date";
import { addCalendarDays, assertCalendarDate, assertCalendarRange, daysBetween, isCalendarDate } from "@/domain/calendar";

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
  bodyweightObservationDate: string | null;
  bodyweightAgeCalendarDays: number | null;
  coverage: StrengthCoverage;
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
  coverage: StrengthCoverage;
  metricVersion: string;
  relativeStrengthAvailable: boolean;
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
  // The ratio describes performance change per bodyweight gain. Dividing two
  // declines would produce a positive number with the opposite meaning.
  if (Number(bodyweightChangePercent) < nearZeroPercent) return null;
  return Number(strengthChangePercent) / Number(bodyweightChangePercent);
}

export function getBulkEfficiencyStatus(efficiency: number | null | undefined) {
  if (!Number.isFinite(efficiency)) return "Gain ratio unavailable";
  if (Number(efficiency) > 1) return "Performance grew faster than bodyweight";
  if (Number(efficiency) > 0) return "Performance and bodyweight increased";
  if (Number(efficiency) === 0) return "Performance unchanged";
  return "Performance decreased";
}

export function calculateAverageStrength(startDate: string, endDate: string, input: StrengthScopeInput) {
  assertCalendarRange(assertCalendarDate(startDate), assertCalendarDate(endDate));
  const points = getStrengthPoints(input, endDate).filter((point) => isWithin(point.date, startDate, endDate));
  if (!points.length || points.every((point) => point.score === null)) return null;
  return average(points.flatMap((point) => point.score === null ? [] : [point.score]));
}

export function calculateBulkAnalytics(input: BulkAnalyticsInput): BulkAnalyticsResult {
  const endDate = assertCalendarDate(input.endDate ?? todayIso());
  input = fixedEquipmentContext(input, endDate);
  const periods = getComparisonPeriods(input.range, endDate, input);
  const previousStrength = calculateAverageStrength(periods.previousStart, periods.previousEnd, input);
  const currentStrength = calculateAverageStrength(periods.currentStart, periods.currentEnd, input);
  const previousBodyweight = calculateAverageBodyweight(periods.previousStart, periods.previousEnd, input.bodyWeightLogs);
  const currentBodyweight = calculateAverageBodyweight(periods.currentStart, periods.currentEnd, input.bodyWeightLogs);
  const strengthChangePercent = calculatePercentChange(previousStrength, currentStrength);
  const bodyweightChangePercent = calculatePercentChange(previousBodyweight, currentBodyweight);
  const previousRelativeStrength = averagePairedRelativeStrength(periods.previousStart, periods.previousEnd, input);
  const relativeStrength = averagePairedRelativeStrength(periods.currentStart, periods.currentEnd, input);
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
    trend: calculateBulkTrend(input),
    coverage: strengthSnapshotAtDate(input, endDate).coverage,
    metricVersion: growthMetricVersion,
    relativeStrengthAvailable: input.scope === "exercise"
  };

  return { ...base, insight: generateBulkInsight(base) };
}

export function generateBulkInsight(analytics: Pick<BulkAnalyticsResult, "previousStrength" | "currentStrength" | "previousBodyweight" | "currentBodyweight" | "strengthChangePercent" | "bodyweightChangePercent" | "bulkEfficiency">) {
  if (analytics.previousBodyweight === null || analytics.currentBodyweight === null) return "Bodyweight observations are required in both comparison periods.";
  if (analytics.previousStrength === null || analytics.currentStrength === null) return "Comparable performance observations are required in both comparison periods.";
  const bw = analytics.bodyweightChangePercent;
  const strength = analytics.strengthChangePercent;
  if (bw === null || strength === null) return "These observations do not support a percentage comparison.";
  if (Math.abs(bw) < nearZeroPercent) {
    if (strength > 0) return "Performance increased while average bodyweight stayed approximately stable.";
    if (strength < 0) return "Performance decreased while average bodyweight stayed approximately stable.";
    return "Performance and average bodyweight stayed approximately stable.";
  }
  if (bw > 0 && strength > bw) return "Performance increased faster than average bodyweight.";
  if (bw > 0 && strength > 0) return "Performance increased alongside average bodyweight.";
  if (bw > 0 && strength < 0) return "Average bodyweight increased while performance decreased.";
  if (bw < 0 && strength > 0) return "Performance increased while average bodyweight decreased.";
  if (bw < 0 && strength < 0) return "Performance and average bodyweight both decreased.";
  return bw > 0 ? "Average bodyweight increased while performance stayed unchanged." : "Average bodyweight decreased while performance stayed unchanged.";
}

export function calculateBulkTrend(input: BulkAnalyticsInput) {
  const trendEndDate = assertCalendarDate(input.endDate ?? todayIso());
  input = fixedEquipmentContext(input, trendEndDate);
  const allDates = observationDates(input, trendEndDate);
  const selectedPeriod = getComparisonPeriods(input.range, trendEndDate, input);
  const dates = input.range === "all"
    ? allDates
    : allDates.filter((date) => isWithin(date, selectedPeriod.currentStart, selectedPeriod.currentEnd));

  return dates.map((date) => {
    const estimate = getBodyweightEstimateForDate(date, input.bodyWeightLogs);
    const bodyweight = estimate.status === "available" ? estimate.weightLb : null;
    const point = strengthSnapshotAtDate(input, date);
    const absoluteStrength = point.score;
    const relativeStrength = calculateRelativeStrength(point.absoluteLoad, bodyweight);
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
      bulkEfficiency,
      bodyweightObservationDate: estimate.status === "available" ? estimate.observationDate : estimate.latestObservationDate,
      bodyweightAgeCalendarDays: estimate.ageCalendarDays,
      coverage: point.coverage
    };
  });
}

function getContextualBulkStatus(input: { strengthChangePercent: number | null; bodyweightChangePercent: number | null; bulkEfficiency: number | null }) {
  const bw = input.bodyweightChangePercent;
  const strength = input.strengthChangePercent;
  if (bw === null || strength === null) return "Comparison observations required";
  if (Math.abs(bw) < nearZeroPercent) return "Bodyweight change too small";
  if (bw < 0) return "Bodyweight decreased; gain ratio unavailable";
  return getBulkEfficiencyStatus(input.bulkEfficiency);
}

export type StrengthCoverage = {
  memberCount: number; availableCount: number; missing: string[]; stale: string[]; excludedCount: number;
  cohortKey: string; complete: boolean;
};
type StrengthSnapshot = { date: string; score: number | null; absoluteLoad: number | null; coverage: StrengthCoverage };
const emptyCoverage = (cohortKey: string): StrengthCoverage => ({ memberCount: 0, availableCount: 0, missing: [], stale: [], excludedCount: 0, cohortKey, complete: false });

/** Evaluate every member at the requested date, including bodyweight-only dates. */
export function strengthSnapshotAtDate(input: StrengthScopeInput, date: string): StrengthSnapshot {
  assertCalendarDate(date);
  if (input.scope === "exercise") {
    const history = input.exercisePoints.filter((p) => p.exerciseId === input.exerciseId && validStrengthPoint(p) && p.date <= date)
      .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
    const preferred = history.filter((p) => p.comparability !== "self_context").at(-1);
    const context = input.comparisonKey ?? (preferred && pointContextKey(preferred));
    const comparable = history.filter((p) => p.comparability !== "self_context" && pointContextKey(p) === context);
    const latest = comparable.at(-1);
    const stale = latest && daysBetween(latest.date, date) > trainingMaximumAgeCalendarDays;
    const coverage: StrengthCoverage = { memberCount: 1, availableCount: latest && !stale ? 1 : 0,
      missing: latest ? [] : ["exercise"], stale: stale ? ["exercise"] : [], excludedCount: history.length - comparable.length,
      cohortKey: context ?? "unavailable", complete: !!latest && !stale };
    return { date, score: coverage.complete ? latest!.score : null, absoluteLoad: coverage.complete ? latest!.estimated1RM : null, coverage };
  }
  if (input.scope === "muscle") return muscleSnapshotAtDate(input.musclePoints.filter((p) => p.muscle === input.muscleGroup), date);
  const members = overallMembership(input.musclePoints, date);
  const snapshots = members.map((muscle) => ({ muscle, value: muscleSnapshotAtDate(input.musclePoints.filter((p) => p.muscle === muscle), date) }));
  const coverage = emptyCoverage(`overall:${snapshots.map((p) => p.value.coverage.cohortKey).join("|")}`);
  coverage.memberCount = snapshots.length;
  for (const { muscle, value } of snapshots) {
    if (value.score !== null) coverage.availableCount++;
    else if (value.coverage.stale.length) coverage.stale.push(muscle);
    else coverage.missing.push(muscle);
    coverage.excludedCount += value.coverage.excludedCount;
  }
  coverage.excludedCount += new Set(input.musclePoints.filter((p) => p.date <= date && !members.includes(p.muscle))
    .flatMap((p) => p.coverage?.includedSessionIds ?? [])).size;
  coverage.complete = coverage.memberCount > 0 && coverage.availableCount === coverage.memberCount;
  return { date, score: coverage.complete ? average(snapshots.map((p) => p.value.score!)) : null, absoluteLoad: null, coverage };
}

function overallMembership(points: MuscleScorePoint[], date: string) {
  const atCutoff = points.filter((p) => p.date <= date);
  const eligible = atCutoff.filter((p) => p.metricVersion === growthMetricVersion && p.coverage?.cohortStartDate && p.coverage.cohortStartDate <= date);
  const configured = [...new Set(atCutoff.filter((p) => p.metricVersion === growthMetricVersion && p.coverage?.source === "configured").map((p) => p.muscle))];
  const firstDate = eligible.map((p) => p.coverage!.cohortStartDate!).sort()[0];
  const members = configured.length ? configured : [...new Set(eligible.filter((p) => p.coverage!.cohortStartDate === firstDate).map((p) => p.muscle))];
  // Older callers may supply already-fixed muscle snapshots without metadata.
  return members.length ? members : [...new Set(atCutoff.filter((p) => p.metricVersion === growthMetricVersion && !p.coverage).map((p) => p.muscle))];
}

function muscleSnapshotAtDate(points: MuscleScorePoint[], date: string): StrengthSnapshot {
  const latest = points.filter((p) => p.metricVersion === growthMetricVersion && isCalendarDate(p.date) && p.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (!latest) return { date, score: null, absoluteLoad: null, coverage: emptyCoverage("unavailable") };
  const c = latest.coverage;
  if (!c) { // Compatibility fixtures only; generated reports always carry coverage.
    const stale = daysBetween(latest.date, date) > trainingMaximumAgeCalendarDays;
    return { date, score: stale ? null : latest.score, absoluteLoad: null, coverage: { memberCount: 1, availableCount: stale || latest.score === null ? 0 : 1,
      missing: latest.score === null ? [latest.muscle] : [], stale: stale ? [latest.muscle] : [], excludedCount: 0, cohortKey: latest.cohortKey ?? latest.muscle, complete: !stale && latest.score !== null } };
  }
  const staleIds = new Set([...c.staleExerciseIds, ...c.includedObservations.filter((p) => daysBetween(p.date, date) > trainingMaximumAgeCalendarDays).map((p) => p.exerciseId)]);
  const missing = c.missingExerciseIds.map(String);
  const coverage: StrengthCoverage = { memberCount: c.members.length, availableCount: c.includedObservations.filter((p) => !staleIds.has(p.exerciseId)).length,
    missing, stale: [...staleIds].map(String), excludedCount: c.exclusions.length, cohortKey: latest.cohortKey ?? "unavailable",
    complete: c.complete && staleIds.size === 0 && latest.score !== null };
  return { date, score: coverage.complete ? latest.score : null, absoluteLoad: null, coverage };
}

/** Resolve the equipment once for the whole requested report. A default must
 * not move to another machine as each historical trend date is evaluated. */
function fixedEquipmentContext<T extends StrengthScopeInput>(input: T, asOfDate: string): T {
  if (input.scope !== "exercise" || input.comparisonKey !== undefined) return input;
  const preferred = input.exercisePoints.filter((point) => point.exerciseId === input.exerciseId
    && point.comparability !== "self_context" && validStrengthPoint(point) && point.date <= asOfDate)
    .sort((left, right) => left.date.localeCompare(right.date) || left.sessionId - right.sessionId).at(-1);
  return preferred ? { ...input, comparisonKey: pointContextKey(preferred) } : input;
}

function getStrengthPoints(input: StrengthScopeInput, asOfDate: string): StrengthSnapshot[] {
  input = fixedEquipmentContext(input, asOfDate);
  const exerciseHistory = input.scope === "exercise" ? input.exercisePoints.filter((p) => p.exerciseId === input.exerciseId
    && p.comparability !== "self_context" && validStrengthPoint(p) && p.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId) : [];
  const context = input.scope === "exercise" ? input.comparisonKey : undefined;
  const overallMembers = overallMembership(input.musclePoints, asOfDate);
  const dates = input.scope === "exercise"
    ? exerciseHistory.filter((p) => pointContextKey(p) === context).map((p) => p.date)
    : input.musclePoints.filter((p) => isCalendarDate(p.date) && p.date <= asOfDate && (input.scope !== "muscle" || p.muscle === input.muscleGroup)
      && (input.scope !== "overall" || overallMembers.includes(p.muscle))
      && (!p.coverage || p.coverage.includedObservations.some((observation) => observation.date === p.date))).map((p) => p.date);
  return [...new Set(dates)].sort().map((date) => strengthSnapshotAtDate(input, date));
}
/** Each observed training day gets a physical ratio only from its own fresh,
 * same/prior bodyweight evidence. Independent period weight means are not a
 * substitute for missing pairs. */
function averagePairedRelativeStrength(start: string, end: string, input: BulkAnalyticsInput) {
  if (input.scope !== "exercise") return null;
  const values = getStrengthPoints(input, end).filter((p) => p.date >= start && p.date <= end).flatMap((point) => {
    const estimate = getBodyweightEstimateForDate(point.date, input.bodyWeightLogs);
    if (point.absoluteLoad === null || estimate.status !== "available") return [];
    const ratio = calculateRelativeStrength(point.absoluteLoad, estimate.weightLb);
    return ratio === null || !Number.isFinite(ratio) ? [] : [ratio];
  });
  return values.length ? average(values) : null;
}

function getComparisonPeriods(range: BulkAnalyticsRange, endDate: string, input: BulkAnalyticsInput) {
  assertCalendarDate(endDate);
  if (range !== "all") {
    const days = Number(range.replace("d", ""));
    const currentEnd = endDate;
    const currentStart = addCalendarDays(currentEnd, -(days - 1));
    const previousEnd = addCalendarDays(currentStart, -1);
    const previousStart = addCalendarDays(previousEnd, -(days - 1));
    return { currentStart, currentEnd, previousStart, previousEnd };
  }

  // Later observations cannot move a historical report's split or endpoint.
  const dates = observationDates(input, endDate);
  const firstDate = dates[0] ?? endDate;
  const totalDays = daysBetween(firstDate, endDate) + 1;
  if (totalDays === 1) {
    const previousDate = addCalendarDays(endDate, -1);
    return { currentStart: endDate, currentEnd: endDate, previousStart: previousDate, previousEnd: previousDate };
  }
  const half = Math.max(1, Math.floor(totalDays / 2));
  const previousStart = firstDate;
  const previousEnd = addCalendarDays(firstDate, half - 1);
  const currentStart = addCalendarDays(previousEnd, 1);
  const currentEnd = endDate;
  return { currentStart, currentEnd, previousStart, previousEnd };
}

function isWithin(date: string, startDate: string, endDate: string) {
  return date >= startDate && date <= endDate;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function validStrengthPoint(point: { date: string; score: number | null; metricVersion?: string }) {
  return isCalendarDate(point.date) && point.score !== null && Number.isFinite(point.score) && point.score > 0
    && point.metricVersion === growthMetricVersion;
}

function observationDates(input: BulkAnalyticsInput, asOfDate: string) {
  return [...new Set([
    ...getStrengthPoints(input, asOfDate).map((point) => point.date),
    ...normalizeBodyWeightLogs(input.bodyWeightLogs).map((log) => bodyWeightObservationDate(log)! )
  ])].filter((date) => isCalendarDate(date) && date <= asOfDate).sort();
}
