import { describe, expect, it } from "vitest";
import { findStrengthReference, performanceHistoryForContext } from "./strengthService";
import type { ExerciseScorePoint, WorkoutSession } from "@/types";

const points = [
  { sessionId: 1, exerciseId: 1, date: "2026-01-01", estimated1RM: 100 },
  { sessionId: 2, exerciseId: 1, date: "2026-01-02", estimated1RM: 500 },
  { sessionId: 3, exerciseId: 1, date: "2026-01-10", estimated1RM: 600 },
  { sessionId: 4, exerciseId: 1, date: "2026-01-02", estimated1RM: 900 },
  { sessionId: 99, exerciseId: 1, date: "2026-01-01", estimated1RM: 999 }
] as ExerciseScorePoint[];
const sessions = points.filter((point) => point.sessionId !== 99).map((point) => ({ id: point.sessionId, workout_date: point.date, machine_profile_id: point.sessionId === 2 ? "gym-b" : point.sessionId === 4 ? null : "gym-a" })) as WorkoutSession[];

describe("performance feedback has a date and equipment scope", () => {
  it("does not use a future, different-machine, or orphan score as the reference", () => {
    const history = performanceHistoryForContext(points, { exerciseId: 1, asOfDate: "2026-01-05", loadType: "machine_stack", machineProfileId: "gym-a", sessions });
    expect(history.map((point) => point.sessionId)).toEqual([1]);
    expect(findStrengthReference(history)?.estimated1RM).toBe(100);
  });

  it("compares an untagged machine session only with other untagged sessions", () => {
    const history = performanceHistoryForContext(points, { exerciseId: 1, asOfDate: "2026-01-05", loadType: "machine_stack", sessions });
    expect(history.map((point) => point.sessionId)).toEqual([4]);
  });

  it("uses verified exercise/date history for non-machine loads", () => {
    const history = performanceHistoryForContext(points, { exerciseId: 1, asOfDate: "2026-01-05", loadType: "external", sessions });
    expect(history.map((point) => point.sessionId)).toEqual([1, 2, 4]);
  });

  it("withholds comparisons for unresolved dates rather than breaking draft recovery", () => {
    expect(performanceHistoryForContext(points, { exerciseId: 1, asOfDate: "2026-02-30", loadType: "external", sessions })).toEqual([]);
  });
});
