import type { BodyWeightLog, ExerciseScorePoint } from "@/types";
import { assertCalendarDate, daysBetween, isCalendarDate } from "@/domain/calendar";
import { normalizeBodyWeightLogs } from "@/services/body/bodyWeightService";
import { growthMetricVersion, trainingMaximumAgeCalendarDays } from "@/services/strength/strengthService";

export function pointContextKey(point: ExerciseScorePoint) {
  return point.comparisonKey ?? `exercise:${point.exerciseId}:legacy`;
}

export function exerciseGrowthReport(points: ExerciseScorePoint[], exerciseId: number, comparisonKey: string | undefined, asOfDate: string) {
  assertCalendarDate(asOfDate);
  const history = points.filter((point) => point.exerciseId === exerciseId && isCalendarDate(point.date) && point.date <= asOfDate
    && point.metricVersion === growthMetricVersion && Number.isFinite(point.score) && point.score > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
  const contexts = [...new Set(history.map(pointContextKey))];
  const preferred = history.filter((point) => point.comparability !== "self_context").at(-1) ?? history.at(-1);
  const selectedKey = comparisonKey || (preferred && pointContextKey(preferred));
  const selected = history.filter((point) => pointContextKey(point) === selectedKey);
  const start = selected[0] ?? null;
  const current = selected.at(-1) ?? null;
  const previous = selected.at(-2) ?? null;
  const best = selected.reduce<ExerciseScorePoint | null>((max, point) => !max || point.score > max.score ? point : max, null);
  const hasComparableSelection = Boolean(current && current.comparability !== "self_context");
  return {
    contexts, comparisonKey: selectedKey, points: selected, start: hasComparableSelection ? start : null, current,
    previous: hasComparableSelection ? previous : null, best: hasComparableSelection ? best : null,
    excludedContextCount: history.length - selected.length,
    ageCalendarDays: current ? daysBetween(current.date, asOfDate) : null,
    stale: current ? daysBetween(current.date, asOfDate) > trainingMaximumAgeCalendarDays : false,
    changeFromStartPercent: hasComparableSelection && start && current ? (current.score / start.score - 1) * 100 : null,
    changeFromPreviousPercent: hasComparableSelection && previous && current ? (current.score / previous.score - 1) * 100 : null
  };
}

export function bodyWeightGrowthReport(logs: BodyWeightLog[], asOfDate: string) {
  assertCalendarDate(asOfDate);
  const points = normalizeBodyWeightLogs(logs).filter((log) => log.logged_date <= asOfDate);
  const start = points[0] ?? null;
  const current = points.at(-1) ?? null;
  return { points, start, current, changeLb: start && current ? current.weight - start.weight : null };
}
