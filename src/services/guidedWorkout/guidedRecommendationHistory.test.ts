import { describe, expect, it } from "vitest";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import type { Exercise, WorkoutSession, WorkoutSet } from "@/types";
import { buildGuidedRecommendation } from "./guidedWorkoutService";
import { latestSetsForExercise } from "@/utils/workoutHistory";

const exercise: Exercise = { id: 1, name: "Overhead Press", primary_muscle: "Shoulders", is_strength_exercise: 1, created_at: "2026-01-01" };
function history(loads: number[], dates = ["2026-03-07", "2026-03-08", "2026-03-15"]) {
  return {
    sessions: loads.map((_, index): WorkoutSession => ({ id: index + 1, workout_date: dates[index], notes: null, created_at: dates[index] })),
    sets: loads.flatMap((weight, index) => [1, 2, 3].map((set_number): WorkoutSet => ({ id: index * 3 + set_number, session_id: index + 1, exercise_id: 1, set_number, reps: 8, weight, rir: null, created_at: dates[index] })))
  };
}
function recommend(data: ReturnType<typeof history>, selected = exercise, workoutDate = "2026-03-08") {
  return buildGuidedRecommendation({ ...data, exercise: selected, preferences: { ...createDefaultGuidedWorkoutPreferences(), exerciseCategories: { [selected.name]: "strength" } }, workoutDate, draftWarmups: [false, false, false] });
}

describe("recommendations use observed history available on the chosen date", () => {
  it("cannot read a later workout when recommending for a backdated entry", () => {
    const data = history([100, 110, 500]);
    const result = recommend(data);
    expect(result.latest?.sessionId).toBe(2);
    expect(result.best?.sessionId).toBe(2);
    expect(result.targets.map((set) => set.priorWeight)).toEqual([110, 110, 110]);
    expect(latestSetsForExercise({ ...data, exerciseId: 1, asOfDate: "2026-03-08" }).map((set) => set.weight)).toEqual([110, 110, 110]);
  });

  it("uses no future, orphan, or invalid-date observations as a starting point", () => {
    const data = history([500], ["2026-03-15"]);
    expect(recommend(data).latest).toBeUndefined();
    expect(latestSetsForExercise({ ...data, sessions: [], exerciseId: 1 })).toEqual([]);
    expect(recommend(history([500], ["2026-02-30"])).latest).toBeUndefined();
  });

  it("measures inactivity in calendar days across daylight saving", () => {
    const data = history([100], ["2026-03-01"]);
    expect(recommend(data, exercise, "2026-03-15").inactive).toBe(false);
    expect(recommend(data, exercise, "2026-03-16").inactive).toBe(true);
  });

  it("selects lower assistance as best and consumes an earned increase after assistance decreases", () => {
    const assisted = { ...exercise, name: "Assisted Dip" };
    const data = history([50, 40, 60]);
    const result = recommend(data, assisted, "2026-03-15");
    expect(result.best?.sessionId).toBe(2);
    expect(result.latest?.sessionId).toBe(3);
    // The latest 60-lb session itself earned the next reduction; the 40-lb
    // observation must remain the best, irrespective of the later regression.
    expect(result.targets.map((set) => set.priorWeight)).toEqual([60, 60, 60]);
    const lowerReps = { ...data, sets: data.sets.map((set) => set.session_id === 2 ? { ...set, reps: 7 } : set) };
    expect(recommend({ sessions: lowerReps.sessions.slice(0, 2), sets: lowerReps.sets.filter((set) => set.session_id <= 2) }, assisted).blockReady).toBe(false);
  });

  it("keeps a different machine out of the recommendation scope", () => {
    const data = history([100, 500]);
    data.sessions[0].machine_profile_id = "gym-a";
    data.sessions[1].machine_profile_id = "gym-b";
    const result = buildGuidedRecommendation({ ...data, exercise, preferences: createDefaultGuidedWorkoutPreferences(), workoutDate: "2026-03-08", draftWarmups: [], machineScoped: true, machineProfileId: "gym-a" });
    expect(result.latest?.sessionId).toBe(1);
  });
});
