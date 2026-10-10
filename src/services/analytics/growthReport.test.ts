import { describe, expect, it } from "vitest";
import { bodyWeightGrowthReport, exerciseGrowthReport } from "./growthReport";
import { buildExerciseScorePoints, buildMuscleScorePoints } from "@/services/strength/strengthService";
import { calculateBulkAnalytics, calculateBulkTrend, strengthSnapshotAtDate } from "./bulkAnalyticsService";
import type { Exercise, WorkoutSession, WorkoutSet, BodyWeightLog } from "@/types";
const exercise = (id = 1, name = "Barbell Bench Press", muscle: Exercise["primary_muscle"] = "Chest"): Exercise => ({ id, name, primary_muscle: muscle, is_strength_exercise: 0, created_at: "2026-01-01" });
function entry(id: number, date: string, exerciseId = 1, load = 100, tag: string | null = null) {
  return { session: { id, workout_date: date, created_at: date, machine_profile_id: tag } as WorkoutSession,
    sets: [1, 2].map((set_number) => ({ id: id * 10 + set_number, session_id: id, exercise_id: exerciseId, set_number, weight: load, reps: 5, created_at: date })) as WorkoutSet[] };
}
function scores(exercises: Exercise[], entries: ReturnType<typeof entry>[]) { return buildExerciseScorePoints(exercises, entries.map((e) => e.session), entries.flatMap((e) => e.sets)); }
const bw = (date: string, weight = 170): BodyWeightLog => ({ id: 1, weight, unit: "lb", logged_date: date, logged_at: `${date}T12:00:00Z`, created_at: date });

describe("growth overview and drill-down share comparison authority", () => {
  it("shows current/start/best within one equipment context, even with a larger unrelated machine entry", () => {
    const points = scores([exercise(1, "Machine Chest Press")], [entry(1, "2026-01-01", 1, 100, "A"), entry(2, "2026-01-02", 1, 120, "A"), entry(3, "2026-01-03", 1, 999, "B")]);
    const key = points[0].comparisonKey!;
    const report = exerciseGrowthReport(points, 1, key, "2026-01-04");
    expect(report.start?.sessionId).toBe(1); expect(report.current?.sessionId).toBe(2); expect(report.best?.sessionId).toBe(2);
    expect(report.changeFromStartPercent).toBeCloseTo(16); expect(report.excludedContextCount).toBe(1);
  });
  it("does not let future training supply today's current or best performance", () => {
    const points = scores([exercise()], [entry(1, "2026-01-01"), entry(2, "2026-04-01", 1, 999)]);
    const report = exerciseGrowthReport(points, 1, undefined, "2026-02-01");
    expect(report.current?.sessionId).toBe(1); expect(report.best?.sessionId).toBe(1); expect(report.stale).toBe(true);
  });
  it("defaults to the most recently trained equipment context while keeping each context baseline fixed", () => {
    const points = scores([exercise(1, "Machine Chest Press")], [entry(1, "2026-01-01", 1, 100, "A"), entry(2, "2026-01-02", 1, 999, "B"), entry(3, "2026-01-03", 1, 900)]);
    const report = exerciseGrowthReport(points, 1, undefined, "2026-01-04");
    expect(report.current?.sessionId).toBe(3);
    expect(report.contexts).toHaveLength(3);
    expect(exerciseGrowthReport(points, 1, report.contexts[0], "2026-01-04").current?.sessionId).toBe(1);
  });
  it("compares untagged machine entries with each other as one history", () => {
    const points = scores([exercise(1, "Machine Chest Press")], [entry(1, "2026-01-01", 1, 100), entry(2, "2026-01-02", 1, 200)]);
    const report = exerciseGrowthReport(points, 1, undefined, "2026-01-03");
    expect(report.contexts).toHaveLength(1);
    expect(report.points.map((point) => point.sessionId)).toEqual([1, 2]);
    expect(report.start?.sessionId).toBe(1); expect(report.current?.sessionId).toBe(2);
    expect(report.changeFromStartPercent).toBeGreaterThan(0); expect(report.excludedContextCount).toBe(0);
  });
  it("does not mix unversioned legacy scores into current growth reports", () => {
    const [point] = scores([exercise()], [entry(1, "2026-01-01")]);
    const { metricVersion: _version, ...legacy } = point;
    const report = exerciseGrowthReport([legacy], 1, undefined, "2026-01-02");
    expect(report.points).toEqual([]); expect(report.current).toBeNull();
  });
  it("withholds an unknown requested equipment context instead of silently selecting another", () => {
    const points = scores([exercise(1, "Machine Chest Press")], [entry(1, "2026-01-01", 1, 100, "A")]);
    const report = exerciseGrowthReport(points, 1, "exercise:1:machine:deleted", "2026-01-04");
    expect(report.comparisonKey).toBe("exercise:1:machine:deleted");
    expect(report.current).toBeNull(); expect(report.start).toBeNull(); expect(report.points).toEqual([]);
  });
  it("shows the latest actual bodyweight rather than assuming input ordering and excludes future/invalid weights", () => {
    const result = bodyWeightGrowthReport([bw("2026-02-01", 200), bw("2026-01-02", 171), bw("2026-01-01", 170), bw("2026-02-30", 500), bw("2026-01-03", NaN)], "2026-01-03");
    expect(result.start?.weight).toBe(170); expect(result.current?.weight).toBe(171); expect(result.changeLb).toBe(1);
  });
  it("uses explicit measurement dates in both directions when timestamps disagree", () => {
    const earlier = { ...bw("2026-01-01", 170), logged_at: "2026-02-01T12:00:00Z" };
    const later = { ...bw("2026-02-01", 200), logged_at: "2026-01-01T12:00:00Z" };
    expect(bodyWeightGrowthReport([earlier, later], "2026-01-01").points.map((p) => p.weight)).toEqual([170]);
  });
});

describe("aggregate and bodyweight comparisons", () => {
  it("rechecks every member's age at a bodyweight-only date and does not carry an older complete aggregate forever", () => {
    const exercises = [exercise(), exercise(2)];
    const points = scores(exercises, [entry(1, "2026-01-01"), entry(2, "2026-01-01", 2), entry(3, "2026-01-30", 2)]);
    const musclePoints = buildMuscleScorePoints(exercises, [], points, "2026-02-01");
    const snapshot = strengthSnapshotAtDate({ scope: "muscle", muscleGroup: "Chest", exercisePoints: points, musclePoints }, "2026-02-01");
    expect(snapshot.score).toBeNull(); expect(snapshot.coverage.stale).toEqual(["1"]); expect(snapshot.coverage.availableCount).toBe(1);
  });
  it("keeps the overall first-day cohort fixed when another muscle appears later", () => {
    const exercises = [exercise(), exercise(2, "Barbell Row", "Back")];
    const points = scores(exercises, [entry(1, "2026-01-01"), entry(2, "2026-01-10", 2, 999)]);
    const musclePoints = buildMuscleScorePoints(exercises, [], points, "2026-01-10");
    const snapshot = strengthSnapshotAtDate({ scope: "overall", exercisePoints: points, musclePoints }, "2026-01-10");
    expect(snapshot.score).toBe(100); expect(snapshot.coverage.memberCount).toBe(1);
  });
  it("does not blend exercise equipment histories in period averages", () => {
    const points = scores([exercise(1, "Machine Chest Press")], [entry(1, "2026-01-01", 1, 100, "A"), entry(2, "2026-01-03", 1, 999, "B"), entry(3, "2026-01-05", 1, 110, "A")]);
    const result = calculateBulkAnalytics({ scope: "exercise", exerciseId: 1, comparisonKey: points[0].comparisonKey, range: "all", endDate: "2026-01-06", exercisePoints: points, musclePoints: [], bodyWeightLogs: [] });
    expect(result.previousStrength).toBe(100); expect(result.currentStrength).toBe(108); expect(result.coverage.excludedCount).toBe(1);
  });
  it("uses an absolute load ratio for relative strength, rather than dividing a personal growth index by bodyweight", () => {
    const points = scores([exercise()], [entry(1, "2026-01-01", 1, 200)]);
    const trend = calculateBulkTrend({ scope: "exercise", exerciseId: 1, range: "all", endDate: "2026-01-01", exercisePoints: points, musclePoints: [], bodyWeightLogs: [bw("2026-01-01", 100)] });
    expect(trend[0].relativeStrength).toBeCloseTo((200 * (1 + 5 / 30)) / 100);
    expect(trend[0].relativeStrength).not.toBe(1);
  });
  it("does not sum unrelated absolute muscle loads into a physical strength ratio", () => {
    const exercises = [exercise()]; const points = scores(exercises, [entry(1, "2026-01-01")]);
    const musclePoints = buildMuscleScorePoints(exercises, [], points, "2026-01-01");
    const trend = calculateBulkTrend({ scope: "overall", range: "all", endDate: "2026-01-01", exercisePoints: points, musclePoints, bodyWeightLogs: [bw("2026-01-01")] });
    expect(trend[0].relativeStrength).toBeNull(); expect(trend[0].absoluteStrength).toBe(100);
  });
  it("expires bodyweight after 14 days while training remains usable through 30 days", () => {
    const points = scores([exercise()], [entry(1, "2026-01-01"), entry(2, "2026-01-16")]);
    const trend = calculateBulkTrend({ scope: "exercise", exerciseId: 1, range: "all", endDate: "2026-02-10", exercisePoints: points, musclePoints: [], bodyWeightLogs: [bw("2026-01-01"), bw("2026-02-10")] });
    expect(trend.find((p) => p.date === "2026-01-16")?.bodyweight).toBeNull();
    expect(trend.at(-1)?.absoluteStrength).not.toBeNull(); // Jan16 is still 25 days old.
  });
  it("withholds training and its physical ratio after 30 days even with a fresh weight", () => {
    const points = scores([exercise()], [entry(1, "2026-01-01")]);
    const trend = calculateBulkTrend({ scope: "exercise", exerciseId: 1, range: "all", endDate: "2026-02-01", exercisePoints: points, musclePoints: [], bodyWeightLogs: [bw("2026-02-01")] });
    expect(trend.at(-1)?.absoluteStrength).toBeNull(); expect(trend.at(-1)?.relativeStrength).toBeNull();
    expect(trend.at(-1)?.coverage.stale).toEqual(["exercise"]);
  });
  it("honors explicit body dates when a timestamp belongs to a different date", () => {
    const weight = { ...bw("2026-01-01"), logged_at: "2026-02-01T12:00:00Z" };
    const points = scores([exercise()], [entry(1, "2026-01-01")]);
    const trend = calculateBulkTrend({ scope: "exercise", exerciseId: 1, range: "all", endDate: "2026-01-01", exercisePoints: points, musclePoints: [], bodyWeightLogs: [weight] });
    expect(trend[0].bodyweightObservationDate).toBe("2026-01-01"); expect(trend[0].bodyweight).toBe(170);
  });
});
