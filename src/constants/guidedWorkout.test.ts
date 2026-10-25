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
});
