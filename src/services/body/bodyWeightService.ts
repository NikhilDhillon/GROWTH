import { BodyWeightLog } from "@/types";

export function normalizeBodyWeightLogs(logs: BodyWeightLog[]) {
  return [...logs]
    .map((log) => ({ ...log, logged_at: log.logged_at ?? `${log.logged_date ?? log.created_at.slice(0, 10)}T12:00:00.000Z` }))
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at));
}

export function getClosestBodyweightForDate(date: string, logs: BodyWeightLog[]) {
  const normalized = normalizeBodyWeightLogs(logs);
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
  const selected = normalizeBodyWeightLogs(logs).filter((log) => log.logged_at.slice(0, 10) >= startDate && log.logged_at.slice(0, 10) <= endDate);
  if (!selected.length) return null;
  return selected.reduce((total, log) => total + log.weight, 0) / selected.length;
}

function toTime(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}
