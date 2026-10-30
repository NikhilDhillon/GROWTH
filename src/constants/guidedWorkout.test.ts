import { describe, expect, it } from "vitest";

import { createDefaultGuidedWorkoutPreferences, normalizeGuidedWorkoutPreferences } from "@/constants/guidedWorkout";

describe("workout logging preference", () => {
  it("starts in the classic list and keeps flow mode only when it was chosen", () => {
    expect(createDefaultGuidedWorkoutPreferences().flowMode).toBe(false);
    expect(normalizeGuidedWorkoutPreferences({ hypertrophyTargetReps: 10 }).flowMode).toBe(false);
    expect(normalizeGuidedWorkoutPreferences({ flowMode: "yes" }).flowMode).toBe(false);
    const chosen = normalizeGuidedWorkoutPreferences({ ...createDefaultGuidedWorkoutPreferences(), flowMode: true });
    expect(chosen.flowMode).toBe(true);
    expect(normalizeGuidedWorkoutPreferences(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
  });

  it("keeps flow mode's rest between 1:30 and 5:00, in five-second steps", () => {
    expect(createDefaultGuidedWorkoutPreferences().restSeconds).toBe(90);
    expect(normalizeGuidedWorkoutPreferences({}).restSeconds).toBe(90);
    expect(normalizeGuidedWorkoutPreferences({ restSeconds: "120" }).restSeconds).toBe(90);
    expect(normalizeGuidedWorkoutPreferences({ restSeconds: 240 }).restSeconds).toBe(240);
    expect(normalizeGuidedWorkoutPreferences({ restSeconds: 30 }).restSeconds).toBe(90);
    expect(normalizeGuidedWorkoutPreferences({ restSeconds: 600 }).restSeconds).toBe(300);
    expect(normalizeGuidedWorkoutPreferences({ restSeconds: 137 }).restSeconds).toBe(135);
  });

  it("keeps only sensible remembered dial steps", () => {
    expect(normalizeGuidedWorkoutPreferences({}).loadSteps).toBeUndefined();
    expect(normalizeGuidedWorkoutPreferences({ loadSteps: { "4|cable|kg": 2.5, "5||lb": 0, "6||lb": "5", "7||lb": 500 } }).loadSteps).toEqual({ "4|cable|kg": 2.5 });
  });
});
