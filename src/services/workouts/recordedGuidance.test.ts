import { describe, expect, it } from "vitest";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import type { ExerciseEntry, Prescription } from "@/domain/types";
import type { Exercise } from "@/types";
import { guidanceForRecordedEntry } from "./recordedGuidance";

const exercise: Exercise = { id: 1, name: "Barbell Bench Press", primary_muscle: "Chest", is_strength_exercise: 1, created_at: "2026-10-09" };
const preferences = createDefaultGuidedWorkoutPreferences();
const prescription: Prescription = { exerciseId: 1, category: "strength", generatedAt: "2026-10-09T12:00:00Z", basedOnEntryIds: [], comparisonContext: null,
  equipment: { kind: "non_machine", loadType: "external" }, sets: [1, 2, 3].map((setNumber) => ({ setNumber, isWarmup: false, targetReps: { minimum: 8, maximum: 8 }, targetLoadLb: 100 })) };
function entry(loadLb = 100): ExerciseEntry {
  return { id: 10, sessionId: 10, exerciseId: 1, workoutDate: "2026-10-09", notes: "", machineProfileId: null, origin: "guided", createdAt: "2026-10-09T12:00:00Z",
    sets: [1, 2, 3].map((id) => ({ id, exerciseId: 1, setNumber: id, reps: 8, loadLb, isWarmup: false, rir: null, rirSource: null, sourceUnit: { status: "recorded", unit: "lb" }, createdAt: "2026-10-09T12:00:00Z" })) };
}

describe("historical guidance reads current observations against saved targets", () => {
  it("changes achievement after an observed-load edit without changing original targets", () => {
    const original = JSON.stringify(prescription);
    expect(guidanceForRecordedEntry(entry(), prescription, exercise, preferences)?.celebrated).toBe(true);
    expect(guidanceForRecordedEntry(entry(90), prescription, exercise, preferences)?.celebrated).toBe(false);
    expect(JSON.stringify(prescription)).toBe(original);
  });

  it("does not reinterpret the original prescription when preferences change", () => {
    expect(guidanceForRecordedEntry({ ...entry(), sets: entry().sets.map((set) => ({ ...set, reps: 5 })) }, prescription, exercise,
      { ...preferences, strengthTargetReps: 3 })?.celebrated).toBe(false);
  });

  it("makes changed exercise/equipment and absent targets not evaluable", () => {
    expect(guidanceForRecordedEntry({ ...entry(), exerciseId: 2 }, prescription, exercise, preferences)?.messages.join(" ")).toMatch(/cannot be evaluated/i);
    const machine = { ...exercise, name: "Machine Chest Press" };
    const machinePrescription: Prescription = { ...prescription, equipment: { kind: "machine_profile", machineProfileId: "machine-a" } };
    expect(guidanceForRecordedEntry({ ...entry(), machineProfileId: "machine-b" }, machinePrescription, machine, preferences)?.celebrated).toBe(false);
    expect(guidanceForRecordedEntry(entry(), machinePrescription, exercise, preferences)?.celebrated).toBe(false);
    const assisted = { ...exercise, name: "Assisted Dip" };
    expect(guidanceForRecordedEntry(entry(), prescription, assisted, preferences)?.celebrated).toBe(false);
    expect(guidanceForRecordedEntry(entry(), null, exercise, preferences)).toBeUndefined();
  });

  it("evaluates an untagged machine prescription against an untagged entry", () => {
    const machine = { ...exercise, name: "Machine Chest Press" };
    const untagged: Prescription = { ...prescription, equipment: { kind: "unknown", reason: "No machine tag." } };
    expect(guidanceForRecordedEntry(entry(), untagged, machine, preferences)?.messages.join(" ")).not.toMatch(/cannot be evaluated/i);
    expect(guidanceForRecordedEntry({ ...entry(), machineProfileId: "machine-a" }, untagged, machine, preferences)?.messages.join(" ")).toMatch(/cannot be evaluated/i);
  });
});
