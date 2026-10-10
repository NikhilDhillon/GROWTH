import type { BodyWeightEstimationEvidence, BodyWeightLog } from "@/types";
import { assertCalendarDate, assertCalendarRange, daysBetween, isCalendarDate } from "@/domain/calendar";

export const bodyWeightMaximumAgeCalendarDays = 14;
export type BodyWeightLookup =
  | ({ status: "available"; observation: BodyWeightLog } & BodyWeightEstimationEvidence)
  | { status: "unavailable"; reason: "missing_prior_observation" | "stale_prior_observation" | "invalid_date"; latestObservationDate: string | null; ageCalendarDays: number | null };

/** Explicit date evidence wins. An invalid supplied date is not repaired from a timestamp. */
export function bodyWeightObservationDate(log: BodyWeightLog): string | null {
  const candidate = log.logged_date ?? log.logged_at?.slice(0, 10) ?? log.created_at?.slice(0, 10);
  return isCalendarDate(candidate) ? candidate : null;
}

export function normalizeBodyWeightLogs(logs: BodyWeightLog[]) {
  return logs.filter((log) => bodyWeightObservationDate(log) !== null && Number.isFinite(log.weight) && log.weight > 0)
    .map((log) => ({ ...log, logged_date: bodyWeightObservationDate(log)!,
      logged_at: log.logged_at ?? `${bodyWeightObservationDate(log)}T12:00:00.000Z` }))
    .sort((left, right) => left.logged_date.localeCompare(right.logged_date) || left.logged_at.localeCompare(right.logged_at)
      || left.created_at.localeCompare(right.created_at) || left.id - right.id);
}

/** A later weight cannot establish an earlier effective load; old weights expire. */
export function getBodyweightEstimateForDate(date: string, logs: BodyWeightLog[], maximumAgeCalendarDays = bodyWeightMaximumAgeCalendarDays): BodyWeightLookup {
  if (!Number.isSafeInteger(maximumAgeCalendarDays) || maximumAgeCalendarDays < 0) throw new Error("Bodyweight freshness requires a non-negative calendar-day limit.");
  if (!isCalendarDate(date)) return { status: "unavailable", reason: "invalid_date", latestObservationDate: null, ageCalendarDays: null };
  const prior = normalizeBodyWeightLogs(logs).filter((log) => log.logged_date <= date).at(-1);
  if (!prior) return { status: "unavailable", reason: "missing_prior_observation", latestObservationDate: null, ageCalendarDays: null };
  const ageCalendarDays = daysBetween(prior.logged_date, date);
  if (ageCalendarDays > maximumAgeCalendarDays) return { status: "unavailable", reason: "stale_prior_observation", latestObservationDate: prior.logged_date, ageCalendarDays };
  return { status: "available", observation: prior, observationId: prior.id, observationDate: prior.logged_date,
    ageCalendarDays, weightLb: prior.weight, isEstimated: ageCalendarDays !== 0 };
}

/** Compatibility name; its contract is now prior-only, with explicit 14-day freshness. */
export function getClosestBodyweightForDate(date: string, logs: BodyWeightLog[]) {
  const result = getBodyweightEstimateForDate(date, logs);
  return result.status === "available" ? result.observation : null;
}

export function calculateAverageBodyweight(startDate: string, endDate: string, logs: BodyWeightLog[]) {
  assertCalendarRange(assertCalendarDate(startDate), assertCalendarDate(endDate));
  const selected = normalizeBodyWeightLogs(logs).filter((log) => log.logged_date >= startDate && log.logged_date <= endDate);
  if (!selected.length) return null;
  return selected.reduce((total, log) => total + log.weight, 0) / selected.length;
}
