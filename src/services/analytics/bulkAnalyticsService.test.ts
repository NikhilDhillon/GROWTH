import { afterEach, describe, expect, it } from "vitest";

import { calculateAverageStrength, calculateBulkAnalytics, calculateBulkEfficiency, calculateBulkTrend, generateBulkInsight, getBulkEfficiencyStatus, strengthSnapshotAtDate } from "@/services/analytics/bulkAnalyticsService";
import { buildExerciseScorePoints, buildMuscleScorePoints, growthMetricVersion } from "@/services/strength/strengthService";
import { exerciseGrowthReport } from "@/services/analytics/growthReport";
import type { BulkAnalyticsInput } from "@/services/analytics/bulkAnalyticsService";
import type { BodyWeightLog, Exercise, ExerciseScorePoint, WorkoutSession, WorkoutSet } from "@/types";

function strength(date: string, score: number, id = 1): ExerciseScorePoint {
  return {
    exerciseId: 1, exerciseName: "Bench Press", sessionId: id, date, score,
    performancePoints: score, estimated1RM: score, failureVolume: score,
    fatigueResistance: 1, normalizedStrength: 1, normalizedVolume: 1,
    normalizedResistance: 1, volume: score, topSet: score, metricVersion: growthMetricVersion,
    workingSets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }]
  };
}

function bodyweight(date: string, weight: number, id = 1): BodyWeightLog {
  return { id, weight, unit: "lb", logged_date: date, logged_at: `${date}T12:00:00.000Z`, created_at: `${date}T12:00:00.000Z` };
}

function report(overrides: Partial<BulkAnalyticsInput> = {}): BulkAnalyticsInput {
  return {
    scope: "exercise", exerciseId: 1, range: "all", endDate: "2026-01-06",
    exercisePoints: [strength("2026-01-01", 100, 1), strength("2026-01-05", 110, 2)],
    bodyWeightLogs: [bodyweight("2026-01-01", 170, 1), bodyweight("2026-01-05", 172, 2)],
    musclePoints: [], ...overrides
  } as BulkAnalyticsInput;
}

const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("historical performance and bodyweight reports", () => {
  it("does not let future observations change an all-time historical comparison or trend", () => {
    const input = report();
    const expected = calculateBulkAnalytics(input);
    const withFuture = report({
      exercisePoints: [...input.exercisePoints, strength("2026-02-10", 800, 3)],
      bodyWeightLogs: [...input.bodyWeightLogs, bodyweight("2026-02-10", 250, 3)]
    });
    expect(calculateBulkAnalytics(withFuture)).toEqual(expected);
    expect(expected.periodEnd).toBe("2026-01-06");
    expect(expected.trend.every((point) => point.date <= expected.periodEnd)).toBe(true);
  });

  it("uses the requested cutoff even when the last observation is earlier", () => {
    const result = calculateBulkAnalytics(report({ endDate: "2026-01-10" }));
    expect(result.previousPeriodStart).toBe("2026-01-01");
    expect(result.previousPeriodEnd).toBe("2026-01-05");
    expect(result.periodStart).toBe("2026-01-06");
    expect(result.periodEnd).toBe("2026-01-10");
    expect(result.currentStrength).toBeNull();
  });

  it("keeps single-day all-time windows ordered and does not invent a baseline", () => {
    const result = calculateBulkAnalytics(report({
      endDate: "2026-01-01", exercisePoints: [strength("2026-01-01", 100)],
      bodyWeightLogs: [bodyweight("2026-01-01", 170)]
    }));
    expect([result.periodStart, result.periodEnd]).toEqual(["2026-01-01", "2026-01-01"]);
    expect([result.previousPeriodStart, result.previousPeriodEnd]).toEqual(["2025-12-31", "2025-12-31"]);
    expect(result.previousStrength).toBeNull();
    expect(result.strengthChangePercent).toBeNull();
  });

  it("does not treat future-only records as current evidence", () => {
    const result = calculateBulkAnalytics(report({
      exercisePoints: [strength("2026-03-01", 100)],
      bodyWeightLogs: [bodyweight("2026-03-01", 170)]
    }));
    expect(result.trend).toEqual([]);
    expect(result.currentStrength).toBeNull();
    expect(result.currentBodyweight).toBeNull();
    expect(result.periodStart <= result.periodEnd).toBe(true);
  });

  it("does not use a later bodyweight observation at an earlier trend point", () => {
    const result = calculateBulkTrend(report({ bodyWeightLogs: [bodyweight("2026-01-05", 172)] }));
    const earlier = result.find((point) => point.date === "2026-01-01");
    expect(earlier?.absoluteStrength).toBe(100);
    expect(earlier?.bodyweight).toBeNull();
    expect(earlier?.relativeStrength).toBeNull();
  });

  it("rejects impossible report dates instead of normalizing them silently", () => {
    expect(() => calculateBulkAnalytics(report({ endDate: "2026-02-30" }))).toThrow(/real calendar date/);
  });

  it("excludes invalid historical dates and non-finite performance evidence", () => {
    const input = report();
    const invalid = report({
      exercisePoints: [...input.exercisePoints, strength("2026-01-40", 120, 3), strength("2026-01-05", Number.NaN, 4)]
    });
    expect(calculateBulkAnalytics(invalid)).toEqual(calculateBulkAnalytics(input));
  });

  it("withholds unversioned legacy performance points from growth comparisons", () => {
    const legacy = report({ exercisePoints: [strength("2026-01-01", 100), strength("2026-01-05", 110)] });
    legacy.exercisePoints = legacy.exercisePoints.map(({ metricVersion: _version, ...point }) => point);
    const result = calculateBulkAnalytics(legacy);
    expect(result.previousStrength).toBeNull();
    expect(result.currentStrength).toBeNull();
    expect(result.coverage.complete).toBe(false);
  });

  it("orders trend evidence by calendar date regardless of input array order", () => {
    const input = report();
    expect(calculateBulkAnalytics(report({
      exercisePoints: [...input.exercisePoints].reverse(), bodyWeightLogs: [...input.bodyWeightLogs].reverse()
    }))).toEqual(calculateBulkAnalytics(input));
  });

  it.each(["America/Los_Angeles", "Asia/Tokyo", "Europe/London"])("uses inclusive calendar windows across daylight-saving changes in %s", (timezone) => {
    process.env.TZ = timezone;
    const result = calculateBulkAnalytics(report({ range: "7d", endDate: "2026-03-15", exercisePoints: [], bodyWeightLogs: [] }));
    expect([result.periodStart, result.periodEnd]).toEqual(["2026-03-09", "2026-03-15"]);
    expect([result.previousPeriodStart, result.previousPeriodEnd]).toEqual(["2026-03-02", "2026-03-08"]);
  });

  it("respects leap days and years below 100 without JavaScript year reinterpretation", () => {
    const leap = calculateBulkAnalytics(report({ range: "7d", endDate: "2024-03-01" }));
    expect(leap.periodStart).toBe("2024-02-24");
    const earlyYear = calculateBulkAnalytics(report({ range: "7d", endDate: "0099-03-01", exercisePoints: [], bodyWeightLogs: [] }));
    expect(earlyYear.periodStart).toBe("0099-02-23");
    expect(earlyYear.previousPeriodEnd).toBe("0099-02-22");
  });
});

describe("performance change per bodyweight gain", () => {
  it("withholds the ratio when performance and bodyweight both decline", () => {
    expect(calculateBulkEfficiency(-10, -5)).toBeNull();
    const result = calculateBulkAnalytics(report({
      exercisePoints: [strength("2026-01-01", 100, 1), strength("2026-01-05", 90, 2)],
      bodyWeightLogs: [bodyweight("2026-01-01", 180, 1), bodyweight("2026-01-05", 170, 2)]
    }));
    expect(result.bulkEfficiency).toBeNull();
    expect(result.status).toMatch(/decreased.*unavailable/);
    expect(result.insight).toBe("Performance and average bodyweight both decreased.");
  });

  it("retains the sign of performance loss when bodyweight rises", () => {
    expect(calculateBulkEfficiency(-10, 5)).toBe(-2);
    expect(getBulkEfficiencyStatus(-2)).toBe("Performance decreased");
  });

  it("requires meaningful positive bodyweight gain and finite inputs", () => {
    expect(calculateBulkEfficiency(10, 0)).toBeNull();
    expect(calculateBulkEfficiency(10, 0.09)).toBeNull();
    expect(calculateBulkEfficiency(10, -0.2)).toBeNull();
    expect(calculateBulkEfficiency(10, 0.1)).toBe(100);
    expect(calculateBulkEfficiency(Number.NaN, 2)).toBeNull();
    expect(calculateBulkEfficiency(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it.each([
    [10, 5], [10, -5], [-10, 5], [-10, -5], [10, 0], [0, 5]
  ])("describes observed changes (%s%% performance, %s%% weight) without body-composition or nutrition claims", (performance, weight) => {
    const insight = generateBulkInsight({
      previousStrength: 100, currentStrength: 100 + performance,
      previousBodyweight: 100, currentBodyweight: 100 + weight,
      strengthChangePercent: performance, bodyweightChangePercent: weight,
      bulkEfficiency: calculateBulkEfficiency(performance, weight)
    });
    expect(insight).not.toMatch(/lean|recomposition|excellent|poor|productive|calories|surplus|recovery/i);
    expect(insight).toMatch(/Performance|performance/);
  });

  it("identifies absent performance evidence without calling it a bodyweight failure", () => {
    const result = calculateBulkAnalytics(report({ exercisePoints: [] }));
    expect(result.bulkEfficiency).toBeNull();
    expect(result.insight).toMatch(/performance observations.*both comparison periods/);
  });
});

describe("one equipment context for an entire dated report", () => {
  const exercise: Exercise = { id: 1, name: "Machine Chest Press", primary_muscle: "Chest", is_strength_exercise: 0, created_at: "2026-01-01" };
  function machinePoints() {
    const observations = [
      observedEntry(1, "2026-01-01", 1, 100, "A"), observedEntry(2, "2026-01-03", 1, 500, "B"),
      observedEntry(3, "2026-01-05", 1, 120, "A"), observedEntry(4, "2026-01-07", 1, 550, "B")
    ];
    return buildExerciseScorePoints([exercise], observations.map((entry) => entry.session), observations.flatMap((entry) => entry.sets));
  }
  it("uses the growth overview's latest verified context at the cutoff and freezes it for every earlier date", () => {
    const points = machinePoints();
    const input = report({ endDate: "2026-01-07", exercisePoints: points, bodyWeightLogs: [bodyweight("2026-01-01", 170)] });
    const result = calculateBulkAnalytics(input);
    const overview = exerciseGrowthReport(points, 1, undefined, "2026-01-07");
    expect(result.coverage.cohortKey).toBe(overview.comparisonKey);
    expect(result.previousStrength).toBe(100); expect(result.currentStrength).toBeCloseTo(108);
    expect(result.trend.map((point) => point.date)).toEqual(["2026-01-01", "2026-01-03", "2026-01-07"]);
    expect(result.trend[0].absoluteStrength).toBeNull(); // Equipment B has not yet been observed.
    expect(result.trend.map((point) => point.coverage.cohortKey)).toEqual(Array(3).fill(overview.comparisonKey));
  });
  it("uses a direct average's end date as its default-context cutoff", () => {
    const input = report({ exercisePoints: machinePoints(), bodyWeightLogs: [] });
    expect(calculateAverageStrength("2026-01-01", "2026-01-06", input)).toBeCloseTo(108); // A: 100,116.
    expect(calculateAverageStrength("2026-01-01", "2026-01-07", input)).toBeCloseTo(104); // B: 100,108.
  });
  it("does not let a future equipment context change a historical report", () => {
    const points = machinePoints();const future = observedEntry(5, "2026-02-01", 1, 999, "C");
    const withFuture = buildExerciseScorePoints([exercise], [future.session], future.sets);
    const input = report({ endDate: "2026-01-07", exercisePoints: points });
    expect(calculateBulkAnalytics({ ...input, exercisePoints: [...points, ...withFuture] })).toEqual(calculateBulkAnalytics(input));
  });
  it("keeps an explicitly missing equipment key unavailable instead of defaulting to another machine", () => {
    const input = report({ exercisePoints: machinePoints(), comparisonKey: "missing-equipment", endDate: "2026-01-07" });
    const result = calculateBulkAnalytics(input);
    expect(result.previousStrength).toBeNull();expect(result.currentStrength).toBeNull();expect(result.relativeStrength).toBeNull();
    expect(result.coverage.cohortKey).toBe("missing-equipment");expect(result.trend.every((point) => point.absoluteStrength === null)).toBe(true);
    expect(strengthSnapshotAtDate(input, "2026-01-07").score).toBeNull();
  });
});

describe("aggregate periods sample only contributing observed dates", () => {
  it("does not weight a fixed muscle cohort again on dates containing only excluded equipment or a later exercise", () => {
    const exercises: Exercise[] = [
      { id: 1, name: "Barbell Bench Press", primary_muscle: "Chest", is_strength_exercise: 0, created_at: "2026-01-01" },
      { id: 2, name: "Machine Chest Press", primary_muscle: "Chest", is_strength_exercise: 0, created_at: "2026-01-01" },
      { id: 3, name: "Dumbbell Bench Press", primary_muscle: "Chest", is_strength_exercise: 0, created_at: "2026-01-01" },
      { id: 4, name: "Barbell Row", primary_muscle: "Back", is_strength_exercise: 0, created_at: "2026-01-01" }
    ];
    const observations = [observedEntry(1, "2026-01-01", 1, 100), observedEntry(2, "2026-01-01", 2, 100, "A"),
      observedEntry(3, "2026-01-02", 2, 999, "B"), observedEntry(4, "2026-01-03", 1, 110),
      observedEntry(5, "2026-01-04", 3, 999), observedEntry(6, "2026-01-05", 4, 999)];
    const exercisePoints = buildExerciseScorePoints(exercises, observations.map((entry) => entry.session), observations.flatMap((entry) => entry.sets));
    const musclePoints = buildMuscleScorePoints(exercises, [], exercisePoints, "2026-01-05");
    const input = { ...report({ exercisePoints, musclePoints, bodyWeightLogs: [], endDate: "2026-01-05" }), scope: "muscle" as const, muscleGroup: "Chest" as const };
    expect(calculateAverageStrength("2026-01-01", "2026-01-05", input)).toBeCloseTo(102);
    expect(calculateBulkTrend(input).map((point) => point.date)).toEqual(["2026-01-01", "2026-01-03"]);
    const overall = { ...input, scope: "overall" as const };
    expect(calculateAverageStrength("2026-01-01", "2026-01-05", overall)).toBeCloseTo(102);
    expect(calculateBulkTrend(overall).map((point) => point.date)).toEqual(["2026-01-01", "2026-01-03"]);
  });
});

describe("period physical ratios use dated training/bodyweight pairs", () => {
  it("does not assign a future weight to an earlier workout even when both lie in the same period", () => {
    const result = calculateBulkAnalytics(report({ range: "7d", endDate: "2026-01-03", exercisePoints: [strength("2026-01-01", 100)], bodyWeightLogs: [bodyweight("2026-01-02", 100)] }));
    expect(result.currentBodyweight).toBe(100);expect(result.relativeStrength).toBeNull();
    expect(result.trend.find((point) => point.date === "2026-01-01")?.relativeStrength).toBeNull();
  });
  it("allows prior bodyweight through day 14 and withholds pairs at day 15", () => {
    const input = report({ range: "30d", bodyWeightLogs: [bodyweight("2026-01-01", 100)] });
    expect(calculateBulkAnalytics({ ...input, endDate: "2026-01-15", exercisePoints: [strength("2026-01-15", 100)] }).relativeStrength).toBe(1);
    const stale = calculateBulkAnalytics({ ...input, endDate: "2026-01-16", exercisePoints: [strength("2026-01-16", 100)] });
    expect(stale.currentBodyweight).toBe(100);expect(stale.relativeStrength).toBeNull();
  });
  it("averages paired ratios rather than dividing two independently sampled period means", () => {
    const result = calculateBulkAnalytics(report({ range: "7d", endDate: "2026-01-03", exercisePoints: [strength("2026-01-01", 100, 1), strength("2026-01-03", 400, 2)], bodyWeightLogs: [bodyweight("2026-01-01", 100, 1), bodyweight("2026-01-03", 200, 2)] }));
    expect(result.currentBodyweight).toBe(150);expect(result.currentStrength).toBe(250);
    expect(result.relativeStrength).toBe(1.5);expect(result.relativeStrength).not.toBe(250 / 150);
  });
});

function observedEntry(id: number, date: string, exerciseId: number, weight: number, tag: string | null = null) {
  return { session: { id, workout_date: date, created_at: date, machine_profile_id: tag } as WorkoutSession,
    sets: [1, 2].map((set_number) => ({ id: id * 10 + set_number, session_id: id, exercise_id: exerciseId, set_number, weight, reps: 5, created_at: date })) as WorkoutSet[] };
}
