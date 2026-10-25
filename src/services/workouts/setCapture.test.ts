import { describe, expect, it } from "vitest";

import { editedSetCaptureColumns } from "@/database/workoutWrite";
import { prepareWorkoutObservations } from "@/services/workouts/workoutRecording";
import { finalizeSetCapture, isLoggedSet, isPlannedSuggestion, flowCapturedSet, plannedSuggestion, stampSetCapture } from "@/services/workouts/setCapture";
import type { Exercise, WorkoutSet } from "@/types";

const tap = "2026-10-24T18:00:00.000Z";
const later = "2026-10-24T18:03:00.000Z";
const exercise: Exercise = { id: 7, name: "Cable Fly", primary_muscle: "Chest", is_strength_exercise: 1, created_at: tap };

describe("set capture evidence", () => {
  it("vouches for pad values only while the row still holds them", () => {
    const logged = flowCapturedSet({ reps: "", weight: "70" }, { reps: "12", weight: "70" }, tap);
    expect(finalizeSetCapture(logged)).toMatchObject({ reps: "12", weight: "70", performedAt: tap, evidence: "flow" });
    const corrected = finalizeSetCapture({ ...logged, reps: "11" });
    expect(corrected).toMatchObject({ reps: "11", performedAt: tap, evidence: "typed" });
    expect(finalizeSetCapture(corrected)).toBe(corrected);
  });

  it("treats a complete row without evidence as typed, and leaves suggestions alone", () => {
    expect(finalizeSetCapture({ reps: "8", weight: "185" })).toMatchObject({ evidence: "typed" });
    const suggestion = { reps: "", weight: "185" };
    expect(finalizeSetCapture(suggestion)).toBe(suggestion);
  });

  it("stamps the time a row becomes complete once, and forgets it when the row is cleared", () => {
    const [first] = stampSetCapture([{ reps: "8", weight: "185" }], tap);
    expect(first.performedAt).toBe(tap);
    expect(stampSetCapture([first], later)[0]).toBe(first);
    expect(stampSetCapture([{ ...first, reps: "" }], later)[0]).toEqual({ reps: "", weight: "185" });
  });

  it("keeps a prefilled row as a waiting suggestion, saved as planned only if untouched", () => {
    const suggestion = plannedSuggestion({ reps: "8", weight: "210" });
    expect(isPlannedSuggestion(suggestion)).toBe(true);
    expect(isLoggedSet(suggestion)).toBe(false);
    expect(stampSetCapture([suggestion], tap)[0]).toBe(suggestion);
    expect(finalizeSetCapture(suggestion)).toMatchObject({ evidence: "planned" });
    const edited = stampSetCapture([{ ...suggestion, reps: "7" }], tap)[0];
    expect(isLoggedSet(edited)).toBe(true);
    expect(finalizeSetCapture(edited)).toMatchObject({ reps: "7", performedAt: tap, evidence: "typed" });
    expect(plannedSuggestion({ reps: "", weight: "210" })).toEqual({ reps: "", weight: "210" });
  });

  it("sends capture metadata with the observation without changing its values", () => {
    const prepared = prepareWorkoutObservations({ exerciseId: 7, workoutDate: "2026-10-24", notes: "", sets: [
      flowCapturedSet({ reps: "", weight: "70" }, { reps: "12", weight: "70" }, tap), { reps: "10", weight: "70" }
    ] }, exercise, "lb");
    expect(prepared.sets).toEqual([
      { reps: 12, weight: 70, isWarmup: false, performedAt: tap, evidence: "flow" },
      { reps: 10, weight: 70, isWarmup: false, evidence: "typed" }
    ]);
  });
});

describe("history edits", () => {
  const stored: WorkoutSet = { id: 1, session_id: 2, exercise_id: 7, set_number: 1, reps: 12, weight: 70, is_warmup: false, performed_at: tap, evidence: "flow", created_at: tap };

  it("keep the original evidence of an unchanged set", () => {
    expect(editedSetCaptureColumns(stored, { reps: 12, weight: 70, evidence: "typed" })).toEqual({ performed_at: tap, evidence: "flow" });
  });

  it("mark a changed set as typed but keep when it was performed", () => {
    expect(editedSetCaptureColumns(stored, { reps: 11, weight: 70 })).toEqual({ performed_at: tap, evidence: "typed" });
  });

  it("never invent evidence for unknown history", () => {
    expect(editedSetCaptureColumns({ ...stored, performed_at: null, evidence: null }, { reps: 12, weight: 70, evidence: "typed" })).toEqual({ performed_at: null, evidence: null });
  });
});
