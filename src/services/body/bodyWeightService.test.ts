import { describe, expect, it } from "vitest";

import { calculateAverageBodyweight, getClosestBodyweightForDate } from "@/services/body/bodyWeightService";
import { BodyWeightLog } from "@/types";

const logs: BodyWeightLog[] = [
  { id: 1, weight: 170, unit: "lb", logged_at: "2026-01-01T12:00:00.000Z", logged_date: "2026-01-01", created_at: "2026-01-01T12:00:00.000Z" },
  { id: 2, weight: 174, unit: "lb", logged_at: "2026-01-05T12:00:00.000Z", logged_date: "2026-01-05", created_at: "2026-01-05T12:00:00.000Z" }
];

describe("body-weight analytics helpers", () => {
  it("uses the latest body weight on or before a workout date", () => {
    expect(getClosestBodyweightForDate("2026-01-04", logs)?.id).toBe(1);
  });

  it("averages canonical weights over an inclusive period", () => {
    expect(calculateAverageBodyweight("2026-01-01", "2026-01-05", logs)).toBe(172);
  });
});

import { bodyWeightObservationDate, getBodyweightEstimateForDate, normalizeBodyWeightLogs } from "./bodyWeightService";

describe("effective-load bodyweight context", () => {
  it("never supplies a future observation to a past workout", () => {
    expect(getClosestBodyweightForDate("2025-12-31", logs)).toBeNull();
    expect(getBodyweightEstimateForDate("2025-12-31", logs)).toMatchObject({ status: "unavailable", reason: "missing_prior_observation" });
  });
  it("allows exactly 14 calendar days and rejects the next day", () => {
    expect(getBodyweightEstimateForDate("2026-01-19", logs)).toMatchObject({ status: "available", observationId: 2, observationDate: "2026-01-05", ageCalendarDays: 14, weightLb: 174, isEstimated: true });
    expect(getBodyweightEstimateForDate("2026-01-20", logs)).toMatchObject({ status: "unavailable", reason: "stale_prior_observation", latestObservationDate: "2026-01-05", ageCalendarDays: 15 });
  });
  it("marks same-day observations distinctly from carried estimates", () => {
    expect(getBodyweightEstimateForDate("2026-01-05", logs)).toMatchObject({ status: "available", observationId: 2, ageCalendarDays: 0, isEstimated: false });
  });
  it("uses explicit calendar date evidence even when the timestamp has another date", () => {
    const log = { ...logs[0], logged_date: "2026-01-04", logged_at: "2026-01-05T01:00:00Z" };
    expect(bodyWeightObservationDate(log)).toBe("2026-01-04");
    expect(getBodyweightEstimateForDate("2026-01-04", [log])).toMatchObject({ status: "available", ageCalendarDays: 0 });
    expect(calculateAverageBodyweight("2026-01-04", "2026-01-04", [log])).toBe(170);
  });
  it("does not repair invalid explicit dates from a different timestamp", () => {
    expect(normalizeBodyWeightLogs([{ ...logs[0], logged_date: "2026-02-30" }])).toEqual([]);
    expect(getClosestBodyweightForDate("2026-01-04", [{ ...logs[0], logged_date: "2026-02-30" }])).toBeNull();
  });
  it("ignores invalid numbers rather than poisoning an observed average", () => {
    const invalid = [0, -1, Number.NaN, Number.POSITIVE_INFINITY].map((weight, index) => ({ ...logs[0], id: 10 + index, weight }));
    expect(calculateAverageBodyweight("2026-01-01", "2026-01-05", [...logs, ...invalid])).toBe(172);
    expect(normalizeBodyWeightLogs(invalid)).toEqual([]);
  });
  it("uses calendar days across daylight-saving boundaries", () => {
    const log = { ...logs[0], logged_date: "2026-03-01", logged_at: "2026-03-01T12:00:00Z" };
    expect(getBodyweightEstimateForDate("2026-03-15", [log])).toMatchObject({ status: "available", ageCalendarDays: 14 });
    expect(getClosestBodyweightForDate("2026-03-16", [log])).toBeNull();
  });
  it("does not mistake display preferences for canonical weight units", () => {
    expect(getBodyweightEstimateForDate("2026-01-01", [{ ...logs[0], unit: "kg" }])).toMatchObject({ status: "available", weightLb: 170 });
  });
  it("reports invalid workout dates without breaking draft recovery", () => {
    expect(getBodyweightEstimateForDate("2026-02-30", logs)).toMatchObject({ status: "unavailable", reason: "invalid_date" });
  });
  it("rejects invalid comparison windows instead of normalizing dates", () => {
    expect(() => calculateAverageBodyweight("2026-02-30", "2026-03-01", logs)).toThrow(/real calendar date/);
    expect(() => calculateAverageBodyweight("2026-03-01", "2026-02-28", logs)).toThrow(/start date/);
  });
});
