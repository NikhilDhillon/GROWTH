import { describe, expect, it } from "vitest";
import { createActiveWorkout } from "@/constants/activeWorkout";
import { CompletedGuidedWorkout, Exercise, WorkoutSession, WorkoutSet } from "@/types";
import { projectWorkoutHistory, recordedWorkoutTotals, resolveWorkoutSummary } from "./workoutHistory";
import { WorkoutRecord, WorkoutEntryReference } from "./workoutLifecycle";

const exercise: Exercise = { id: 1, name: "Bench Press", primary_muscle: "Chest", is_strength_exercise: 1, created_at: "2026-10-01" };
const session: WorkoutSession = { id: 10, workout_date: "2026-10-01", notes: "Actual", machine_profile_id: "gym-a", created_at: "2026-10-01" };
const sets: WorkoutSet[] = [1, 2].map((id) => ({ id, session_id: 10, exercise_id: 1, set_number: id, reps: 5, weight: 100, rir: 0, is_warmup: 0, created_at: "2026-10-01" }));
function archive(): CompletedGuidedWorkout {
  return { ...createActiveWorkout({ key: "thu", label: "Thu", muscles: ["Chest"] }), startedAt: "2026-10-01T12:00:00Z", workoutDate: "2026-10-01", id: "old-archive", finishedAt: "2026-10-01T13:00:00Z", completedExercises: [{ exerciseId: 1, sessionId: 10, exerciseName: "Bench Press", muscle: "Chest", sets: [{ reps: "99", weight: "999" }], completedAt: "2026-10-01" }] };
}
function input() { return { exercises: [exercise], sessions: [session], sets, completedGuidedWorkouts: [archive()] }; }

describe("one authority for completed observations", () => {
  it("reconstructs an archive solely through explicit recorded identities", () => {
    const resolved = resolveWorkoutSummary(input(), archive());
    expect(resolved.totals.volumeLb).toBe(1000);
    expect(resolved.workout.entryIds).toEqual([10]);
    expect(resolved.entries[0].sets.map((set) => set.loadLb)).toEqual([100, 100]);
    expect(resolved.entries[0].sets[0].sourceUnit.status).toBe("unknown");
    expect(resolved.entries[0].sets[0].rirSource).toBe("unknown");
  });
  it("historical edits change summaries without changing or trusting archive copies", () => {
    const data = { ...input(), sessions: [{ ...session, workout_date: "2026-10-02", machine_profile_id: "gym-b" }], sets: sets.map((set) => ({ ...set, weight: 110 })) };
    const rawBefore = JSON.stringify(data.completedGuidedWorkouts);
    const resolved = resolveWorkoutSummary(data, archive());
    expect(resolved.totals.volumeLb).toBe(1100);
    expect(resolved.workout.workoutDate).toBe("2026-10-02");
    expect(resolved.entries[0].machineProfileId).toBe("gym-b");
    expect(JSON.stringify(data.completedGuidedWorkouts)).toBe(rawBefore);
  });
  it("deleted observations remain deleted even when archive copies survive", () => {
    const resolved = resolveWorkoutSummary({ ...input(), sessions: [], sets: [] }, archive());
    expect(resolved.totals.volumeLb).toBe(0);
    expect(resolved.entries).toEqual([]);
    expect(resolved.resolution).toBe("unavailable");
    expect(resolved.issues.some((issue) => issue.code === "missing_session")).toBe(true);
  });
  it("never guesses a session from matching dates, names or values", () => {
    const unlinked = archive(); delete unlinked.completedExercises[0].sessionId;
    const projected = projectWorkoutHistory({ ...input(), completedGuidedWorkouts: [unlinked] });
    expect(projected.workouts.find((workout) => workout.kind === "guided")?.entryIds).toEqual([]);
    expect(projected.workouts.find((workout) => workout.kind === "standalone")?.entryIds).toEqual([10]);
    expect(projected.issues.some((issue) => issue.code === "legacy_unlinked_reference")).toBe(true);
  });
  it("retains observations once when different workouts claim the same session", () => {
    const second = { ...archive(), startedAt: "2026-10-02T12:00:00Z", id: "second" };
    const projected = projectWorkoutHistory({ ...input(), completedGuidedWorkouts: [archive(), second] });
    expect(projected.workouts.filter((workout) => workout.kind === "guided").flatMap((workout) => workout.entryIds)).toEqual([]);
    expect(projected.workouts.find((workout) => workout.kind === "standalone")?.entryIds).toEqual([10]);
    expect(recordedWorkoutTotals(projected.entries).volumeLb).toBe(1000);
  });
  it("does not double-count repeated links within one archive", () => {
    const duplicated = archive(); duplicated.completedExercises.push(duplicated.completedExercises[0]);
    const resolved = resolveWorkoutSummary({ ...input(), completedGuidedWorkouts: [duplicated] }, duplicated);
    expect(resolved.totals).toMatchObject({ exercises: 1, workingSets: 2, volumeLb: 1000 });
  });
  it("keeps mixed legacy sessions standalone instead of inventing exercise entries", () => {
    const projected = projectWorkoutHistory({ ...input(), sets: [sets[0], { ...sets[1], exercise_id: 2 }] });
    expect(projected.entries[0].exerciseId).toBeNull();
    expect(projected.entries[0].sets.map((set) => set.exerciseId)).toEqual([1, 2]);
    expect(projected.workouts.find((workout) => workout.kind === "guided")?.entryIds).toEqual([]);
  });
  it("keeps invalid or orphan evidence outside valid totals", () => {
    const projected = projectWorkoutHistory({ ...input(), sets: [...sets, { ...sets[0], id: 3, session_id: 999 }, { ...sets[0], id: 4, reps: -1 }] });
    expect(projected.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["orphan_set", "invalid_observation"]));
    expect(recordedWorkoutTotals(projected.entries).volumeLb).toBe(1000);
  });
  it("does not choose one of two conflicting copies with the same recorded identity", () => {
    const projected = projectWorkoutHistory({ ...input(), sets: [...sets, { ...sets[0], weight: 999 }] });
    expect(projected.issues.some((issue) => issue.code === "duplicate_set_identity")).toBe(true);
    expect(recordedWorkoutTotals(projected.entries).volumeLb).toBe(500);
  });
  it("exposes malformed raw archives preserved outside compatibility normalization", () => {
    const malformed = { weights: [999], originalUnit: "unknown" };
    const evidence = [archive(), malformed];
    const original = JSON.stringify(evidence);
    const projected = projectWorkoutHistory({ ...input(), workoutArchiveEvidence: evidence });
    expect(projected.metadataEvidence.some((record) => record.metadata === malformed)).toBe(true);
    expect(projected.issues.some((issue) => issue.code === "invalid_archive_metadata")).toBe(true);
    expect(JSON.stringify(evidence)).toBe(original);
  });
  it("invalid historical dates are flagged, not replaced with today", () => {
    const projected = projectWorkoutHistory({ ...input(), sessions: [{ ...session, workout_date: "2026-02-30" }] });
    expect(projected.entries[0].workoutDate).toBeNull();
    expect(projected.issues.some((issue) => issue.code === "invalid_session")).toBe(true);
  });
  it("does not turn the current display unit into input-unit provenance", () => {
    const projected = projectWorkoutHistory({ ...input(), sessions: [{ ...session, input_unit: "kg" }] });
    expect(projected.entries[0].sets[0]).toMatchObject({ loadLb: 100, sourceUnit: { status: "recorded", unit: "kg" } });
  });
});

describe("durable workout references determine historical membership", () => {
  const workoutId = "290168a3-7011-4665-a2a7-f8b150ae7d50";
  function record(): WorkoutRecord {
    return { id: workoutId, legacyId: "2026-10-01T12:00:00Z", kind: "guided", status: "completed",
      startedAt: "2026-10-01T12:00:00Z", finishedAt: "2026-10-01T13:00:00Z", label: "Recorded workout",
      notes: null, templateId: "template-a", scheduledDayId: "weekday:thu", plannedMuscles: ["Chest"], scheduleChanges: [] };
  }
  function canonicalInput() {
    const reference: WorkoutEntryReference = { workoutId, sessionId: 10, prescription: null, completedAt: "2026-10-01T12:30:00Z" };
    return { ...input(), workoutRecords: [record()], workoutReferences: [reference] };
  }

  it("uses durable grouping when legacy and route copies claim different entries", () => {
    const legacy = { ...archive(), workoutId, workoutLabel: "Stale label" };
    const anotherSession = { ...session, id: 20, notes: "Separate recorded work" };
    const anotherSets = sets.map((set) => ({ ...set, id: set.id + 20, session_id: 20, weight: 300 }));
    const route = { ...legacy, workoutLabel: "Forged route label", completedExercises: legacy.completedExercises.map((entry) => ({ ...entry, sessionId: 20 })) };
    const data = { ...canonicalInput(), sessions: [session, anotherSession], sets: [...sets, ...anotherSets], completedGuidedWorkouts: [route] };
    const original = JSON.stringify(data);
    const resolved = resolveWorkoutSummary(data, route);
    expect(resolved.workout).toMatchObject({ id: workoutId, label: "Recorded workout", templateId: "template-a", entryIds: [10] });
    expect(resolved.totals).toMatchObject({ exercises: 1, workingSets: 2, volumeLb: 1000 });
    expect(projectWorkoutHistory(data).workouts.find((workout) => workout.id === "session:20")?.entryIds).toEqual([20]);
    expect(JSON.stringify(data)).toBe(original);
  });

  it("reflects date, machine and set edits through the same durable workout identity", () => {
    const metadata = { ...archive(), workoutId };
    const data = canonicalInput();
    const changed = { ...data, sessions: [{ ...session, workout_date: "2026-10-02", machine_profile_id: "gym-b", notes: "Edited observation" }],
      sets: sets.map((set) => ({ ...set, reps: 6, weight: 110 })) };
    const before = resolveWorkoutSummary(data, metadata);
    const after = resolveWorkoutSummary(changed, metadata);
    expect(after.workout.id).toBe(before.workout.id);
    expect(after.workout.workoutDate).toBe("2026-10-02");
    expect(after.entries[0]).toMatchObject({ notes: "Edited observation", machineProfileId: "gym-b" });
    expect(after.totals.volumeLb).toBe(1320);
    expect(before.totals.volumeLb).toBe(1000);
  });

  it("does not recreate deleted observations from archives when the durable reference is removed", () => {
    const metadata = { ...archive(), workoutId };
    const data = { ...canonicalInput(), sessions: [], sets: [], workoutReferences: [] };
    const resolved = resolveWorkoutSummary(data, metadata);
    expect(resolved.workout.id).toBe(workoutId);
    expect(resolved.workout.status).toBe("completed");
    expect(resolved.entries).toEqual([]);
    expect(resolved.totals).toMatchObject({ exercises: 0, sets: 0, volumeLb: 0 });
    expect(data.completedGuidedWorkouts[0].completedExercises[0].sets).toEqual([{ reps: "99", weight: "999" }]);
  });

  it("does not trust route grouping when durable tables are explicitly empty", () => {
    const metadata = { ...archive(), workoutId };
    const resolved = resolveWorkoutSummary({ ...input(), workoutRecords: [], workoutReferences: [] }, metadata);
    expect(resolved.entries).toEqual([]);
    expect(resolved.totals.volumeLb).toBe(0);
    expect(projectWorkoutHistory({ ...input(), workoutRecords: [], workoutReferences: [] }).workouts).toEqual([
      expect.objectContaining({ id: "session:10", kind: "standalone", entryIds: [10] })
    ]);
  });

  it("preserves unknown archive fields and malformed evidence for reconciliation without adding recorded work", () => {
    const unknown = { ...archive(), workoutId, originalFields: { loadUnit: "ambiguous", value: 900 } };
    const malformed = { originalUnit: null, rawValues: [1000, 2000] };
    const raw = [unknown, malformed];
    const original = JSON.stringify(raw);
    const projected = projectWorkoutHistory({ ...canonicalInput(), workoutArchiveEvidence: raw });
    expect(projected.metadataEvidence.some((item) => item.metadata === unknown)).toBe(true);
    expect(projected.metadataEvidence.some((item) => item.metadata === malformed)).toBe(true);
    expect(projected.workouts.find((workout) => workout.id === workoutId)?.entryIds).toEqual([10]);
    expect(recordedWorkoutTotals(projected.entries).volumeLb).toBe(1000);
    expect(JSON.stringify(raw)).toBe(original);
  });

  it("keeps disputed durable membership independent instead of choosing a workout", () => {
    const data = canonicalInput();
    const secondRecord = { ...record(), id: "second-durable-workout" };
    const projected = projectWorkoutHistory({ ...data, workoutRecords: [...data.workoutRecords, secondRecord],
      workoutReferences: [...data.workoutReferences, { ...data.workoutReferences[0], workoutId: secondRecord.id }] });
    expect(projected.workouts.filter((workout) => workout.kind === "guided").flatMap((workout) => workout.entryIds)).toEqual([]);
    expect(projected.workouts.find((workout) => workout.id === "session:10")?.entryIds).toEqual([10]);
    expect(projected.issues.some((issue) => issue.code === "conflicting_workout_link")).toBe(true);
    expect(recordedWorkoutTotals(projected.entries).volumeLb).toBe(1000);
  });

  it("resolves preserved historical metadata through its registered legacy identity when its old UUID differs", () => {
    const metadata = { ...archive(), workoutId: "old-unregistered-uuid" };
    const resolved = resolveWorkoutSummary(canonicalInput(), metadata);
    expect(resolved.workout.id).toBe(workoutId);
    expect(resolved.workout.entryIds).toEqual([10]);
    expect(resolved.totals.volumeLb).toBe(1000);
  });

  it("reports an unavailable referenced observation instead of a complete empty summary", () => {
    const metadata = { ...archive(), workoutId };
    const resolved = resolveWorkoutSummary({ ...canonicalInput(), sessions: [], sets: [] }, metadata);
    expect(resolved.entries).toEqual([]);
    expect(resolved.resolution).toBe("unavailable");
    expect(resolved.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing_session", workoutId, sessionId: 10 })]));
  });
});
