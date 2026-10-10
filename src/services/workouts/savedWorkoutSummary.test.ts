import { describe, expect, it } from "vitest";
import { createActiveWorkout } from "@/constants/activeWorkout";
import { workoutRecordFromDraft } from "@/domain/workoutLifecycle";
import { savedWorkoutSummary } from "./savedWorkoutSummary";
const active = createActiveWorkout({ key: "mon", label: "Monday", muscles: ["Chest"] });
const record = { ...workoutRecordFromDraft(active), status: "completed" as const, finishedAt: "2026-10-04T14:00:00Z", legacyId: active.startedAt };
const input = { sessions: [], sets: [], exercises: [], workoutRecords: [record], workoutReferences: [], completedGuidedWorkouts: [] };
describe("saved summary identity", () => {
  it("resolves stable links from saved metadata without requiring copied route data", () => {
    expect(savedWorkoutSummary(input, { workoutId: record.id })?.workout).toMatchObject({ id: record.id, startedAt: record.startedAt, finishedAt: record.finishedAt });
  });
  it("uses saved metadata after arbitrary route timestamps or labels change", () => {
    const summary = savedWorkoutSummary(input, { workoutId: record.id, workout: { ...active, workoutLabel: "Forged", startedAt: "1900-01-01" }, finishedAt: "2099-01-01" });
    expect(summary?.workout.label).toBe(record.label); expect(summary?.workout.finishedAt).toBe(record.finishedAt);
  });
  it("lets a legacy route identify an existing saved legacy mapping without creating membership", () => {
    expect(savedWorkoutSummary(input, { workout: active })?.workout.id).toBe(record.id);
    expect(savedWorkoutSummary({ ...input, workoutRecords: [] }, { workout: active })).toBeNull();
  });
  it("does not substitute a matching route copy for an explicitly missing linked ID", () => {
    expect(savedWorkoutSummary(input, { workoutId: "missing", workout: active })).toBeNull();
    expect(savedWorkoutSummary(input, {})).toBeNull();
  });
});
