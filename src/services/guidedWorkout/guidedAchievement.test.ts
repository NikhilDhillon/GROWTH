import { describe, expect, it } from "vitest";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import type { Prescription } from "@/domain/types";
import type { Exercise, LoggedSetDraft } from "@/types";
import { weightToStorageUnit } from "@/utils/units";
import {
  buildGuidedPrescription,
  buildGuidedSessionOutcome,
  evaluateGuidedAchievement,
  GuidedAchievementObservation,
  GuidedRecommendation
} from "./guidedWorkoutService";

const exercise: Exercise = { id: 1, name: "Overhead Press", primary_muscle: "Shoulders", is_strength_exercise: 0, created_at: "2026-10-09T12:00:00Z" };
const preferences = createDefaultGuidedWorkoutPreferences();
function prescription(load = 100): Prescription {
  return {
    exerciseId: 1, category: "strength", generatedAt: "2026-10-09T12:00:00Z", basedOnEntryIds: [], comparisonContext: null,
    sets: [1, 2, 3].map((setNumber) => ({ setNumber, isWarmup: false, targetReps: { minimum: 8, maximum: 8 }, targetLoadLb: load }))
  };
}
function observations(loadLb = 100, reps = 8): GuidedAchievementObservation[] {
  return [1, 2, 3].map(() => ({ reps, loadLb, isWarmup: false }));
}
function draft(weight = "100", reps = "8"): LoggedSetDraft[] {
  return [1, 2, 3].map(() => ({ reps, weight, isWarmup: false }));
}
function recommendation(): GuidedRecommendation {
  return {
    category: "strength", inactive: false, topSetReady: false, backoffReady: false, blockReady: false,
    targets: [0, 1, 2].map((draftIndex) => ({ draftIndex, workingSetNumber: draftIndex + 1, role: "working", targetReps: 8, priorWeight: 100, increaseWeight: false }))
  };
}

describe("guided achievement compares performed reps and load with the original prescription", () => {
  it("does not celebrate completed reps performed at a lighter external load", () => {
    const outcome = buildGuidedSessionOutcome({ exercise, preferences, prescription: prescription(), unitSystem: "lb", sets: draft("99", "12") });
    expect(outcome.celebrated).toBe(false);
    expect(outcome.messages.join(" ")).not.toMatch(/achieved/i);
    expect(evaluateGuidedAchievement({ prescription: prescription(), loadType: "external", sets: observations(99, 12) }).sets.every((set) => set.reason === "load")).toBe(true);
  });

  it("requires every prescribed working set to meet reps and external load", () => {
    expect(evaluateGuidedAchievement({ prescription: prescription(), loadType: "external", sets: observations(105, 9) }).status).toBe("achieved");
    const fewerReps = observations();
    fewerReps[2].reps = 7;
    expect(evaluateGuidedAchievement({ prescription: prescription(), loadType: "external", sets: fewerReps }).status).toBe("not_met");
  });

  it("accepts equal or lower assistance and rejects greater assistance", () => {
    const target = prescription(50);
    expect(evaluateGuidedAchievement({ prescription: target, loadType: "bodyweight_minus_assistance", sets: observations(50) }).status).toBe("achieved");
    expect(evaluateGuidedAchievement({ prescription: target, loadType: "bodyweight_minus_assistance", sets: observations(40) }).status).toBe("achieved");
    expect(evaluateGuidedAchievement({ prescription: target, loadType: "bodyweight_minus_assistance", sets: observations(60, 12) }).status).toBe("not_met");
    const assistedExercise = { ...exercise, name: "Assisted Dip" };
    const outcome = buildGuidedSessionOutcome({ exercise: assistedExercise, preferences, prescription: target, unitSystem: "lb", sets: draft("40") });
    expect(outcome.celebrated).toBe(true);
    expect(outcome.messages.join(" ")).toContain("Reduce the assistance");
  });

  it("treats added bodyweight load and machine stack targets as increasing load", () => {
    for (const loadType of ["bodyweight_plus_load", "machine_stack"] as const) {
      expect(evaluateGuidedAchievement({ prescription: prescription(20), loadType, sets: observations(19, 12) }).status).toBe("not_met");
      expect(evaluateGuidedAchievement({ prescription: prescription(20), loadType, sets: observations(20) }).status).toBe("achieved");
    }
  });

  it("does not add a tolerance that permits a slightly lighter recorded load", () => {
    expect(evaluateGuidedAchievement({ prescription: prescription(), loadType: "external", sets: observations(99.9999999) }).status).toBe("not_met");
  });

  it("does not shift working targets when a warmup is added before recorded working sets", () => {
    const target = prescription();
    target.sets[1].targetLoadLb = 90;
    target.sets[2].targetLoadLb = 80;
    const sets = [{ reps: 2, loadLb: 20, isWarmup: true }, ...[100, 90, 80].map((loadLb) => ({ reps: 8, loadLb, isWarmup: false }))];
    expect(evaluateGuidedAchievement({ prescription: target, loadType: "external", sets }).status).toBe("achieved");
    const outcome = buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "lb", sets: [{ reps: "2", weight: "20", isWarmup: true }, ...[100, 90, 80].map((weight) => ({ reps: "8", weight: String(weight) }))] });
    expect(outcome.celebrated).toBe(true);
  });

  it("excludes prescribed and observed warmups from achievement", () => {
    const target = prescription();
    target.sets.unshift({ setNumber: 1, isWarmup: true, targetReps: null, targetLoadLb: null });
    expect(evaluateGuidedAchievement({ prescription: target, loadType: "external", sets: [{ reps: 0, loadLb: 0, isWarmup: true }, ...observations()] }).status).toBe("achieved");
  });

  it("cannot complete a missing prescribed set with fewer observations", () => {
    const result = evaluateGuidedAchievement({ prescription: prescription(), loadType: "external", sets: observations().slice(0, 2) });
    expect(result.status).toBe("not_met");
    expect(result.sets[2].reason).toBe("missing_observation");
  });

  it("does not evaluate absent numeric load or reps targets", () => {
    const noLoad = prescription();
    noLoad.sets[0].targetLoadLb = null;
    const noReps = prescription();
    noReps.sets[0].targetReps = null;
    for (const target of [noLoad, noReps, { ...prescription(), sets: [] }]) {
      expect(evaluateGuidedAchievement({ prescription: target, loadType: "external", sets: observations(150, 20) }).status).toBe("not_evaluable");
      expect(buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "lb", sets: draft("150", "20") }).celebrated).toBe(false);
    }
  });

  it("never fabricates a heavier target from an increase recommendation", () => {
    const recommended = recommendation();
    recommended.targets.forEach((target) => { target.increaseWeight = true; target.targetReps = undefined; });
    const target = buildGuidedPrescription({ exerciseId: 1, recommendation: recommended, generatedAt: "2026-10-09T12:00:00Z" });
    expect(target.sets.every((set) => set.targetLoadLb === null && set.targetReps === null)).toBe(true);
    expect(evaluateGuidedAchievement({ prescription: target, loadType: "external", sets: observations(150, 20) }).status).toBe("not_evaluable");
  });

  it("binds numeric target identity to the working ordinal instead of the original draft row", () => {
    const recommended = recommendation();
    recommended.targets.forEach((target) => { target.draftIndex += 2; });
    const target = buildGuidedPrescription({ exerciseId: 1, recommendation: recommended, generatedAt: "2026-10-09T12:00:00Z" });
    expect(target.sets.map((set) => set.setNumber)).toEqual([1, 2, 3]);
  });

  it("compares kilogram entry against the canonical pound target", () => {
    const target = prescription(weightToStorageUnit(50, "kg"));
    expect(buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "kg", sets: draft("50") }).celebrated).toBe(true);
    expect(buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "kg", sets: draft("49.9", "12") }).celebrated).toBe(false);
  });

  it("keeps achievement unknown when the entered unit or original prescription is absent", () => {
    expect(buildGuidedSessionOutcome({ exercise, preferences, prescription: prescription(), sets: draft() }).celebrated).toBe(false);
    expect(buildGuidedSessionOutcome({ exercise, preferences, unitSystem: "lb", sets: draft("150", "20") }).celebrated).toBe(false);
    expect(buildGuidedSessionOutcome({ exercise, preferences, prescription: { ...prescription(), exerciseId: 2 }, unitSystem: "lb", sets: draft() }).celebrated).toBe(false);
  });

  it("uses the saved prescription even after recommendation or preferences change", () => {
    const changedRecommendation = recommendation();
    changedRecommendation.targets.forEach((target) => { target.priorWeight = 40; target.targetReps = 3; });
    expect(buildGuidedSessionOutcome({ exercise, preferences: { ...preferences, strengthTargetReps: 3 }, prescription: prescription(), recommendation: changedRecommendation, unitSystem: "lb", sets: draft("50", "4") }).celebrated).toBe(false);
  });

  it("evaluates top and back-off blocks independently at their prescribed loads", () => {
    const target = { ...prescription(), category: "top_set" as const };
    target.sets[0].targetLoadLb = 120;
    const failed = buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "lb", sets: draft("90", "12") });
    expect(failed.celebrated).toBe(false);
    const topOnly = buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "lb", sets: [{ reps: "8", weight: "120" }, ...draft("90").slice(0, 2)] });
    expect(topOnly.celebrated).toBe(true);
    expect(topOnly.messages[0]).toMatch(/achieved/);
    expect(topOnly.messages[1]).not.toMatch(/achieved/);
  });

  it("does not interpret blank or invalid entered loads as zero-load achievements", () => {
    const target = prescription(0);
    for (const weight of ["", " ", "invalid", "-1"]) {
      expect(buildGuidedSessionOutcome({ exercise, preferences, prescription: target, unitSystem: "lb", sets: draft(weight) }).celebrated).toBe(false);
    }
  });
});
