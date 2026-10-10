import { describe, expect, it } from "vitest";
import { createActiveWorkout } from "@/constants/activeWorkout";
import { ActiveWorkout, CompletedGuidedWorkout, Exercise, WorkoutSession, WorkoutSet } from "@/types";
import { confirmGuidedObservation } from "@/services/guidedWorkout/guidedObservationService";
import { advanceWorkoutDraft, assertGuidedRecordingInput, committedWorkoutDraft, DraftConflictError,
  planWorkoutReferenceMigration, WorkoutRecordingInput } from "./workoutLifecycle";
import { standaloneWorkoutRecord, workoutRecordFromDraft } from "./workoutLifecycle";

const date = "2026-10-01";
const startedAt = `${date}T12:00:00Z`;
const workoutId = "40575c52-a52d-424a-b0ed-5e1d05a3eef6";
const exercise: Exercise = { id: 1, name: "Barbell Bench Press", primary_muscle: "Chest", is_strength_exercise: 1, created_at: date };
const session: WorkoutSession = { id: 10, workout_date: date, notes: "Actual", machine_profile_id: null, created_at: date };
const sets: WorkoutSet[] = [1, 2].map((id) => ({ id, session_id: 10, exercise_id: 1, set_number: id,
  reps: 5, weight: 100, rir: null, is_warmup: 0, created_at: date }));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function active(): ActiveWorkout {
  return { ...createActiveWorkout({ key: "thu", label: "Thursday", muscles: ["Chest"] }), workoutId, revision: 0,
    startedAt, workoutDate: date, todayDayKey: "thu", sourceDayKey: "thu" };
}
function legacyArchive(): CompletedGuidedWorkout {
  return { ...active(), workoutId: undefined, revision: undefined, id: startedAt, finishedAt: `${date}T13:00:00Z`,
    completedExercises: [{ sessionId: 10, exerciseId: 1, exerciseName: exercise.name, muscle: "Chest",
      sets: [{ reps: "99", weight: "999" }], completedAt: `${date}T12:30:00Z` }] };
}
function history() {
  return { sessions: [session], sets, exercises: [exercise], workoutArchiveEvidence: [legacyArchive()] };
}

describe("explicit workout reference migration rules", () => {
  it("preserves a canonical link created before the checkpoint even when legacy copies claim it", () => {
    const record = standaloneWorkoutRecord("already-recorded");
    const reference = { workoutId: record.id, sessionId: 10, prescription: null, completedAt: startedAt };
    const migration = planWorkoutReferenceMigration({ ...history(), workoutRecords: [record], workoutReferences: [reference] });
    expect(migration.records).toEqual([record]);
    expect(migration.references).toEqual([reference]);
  });

  it("retains an existing active lifecycle and links only still-unlinked entries", () => {
    const draft = { ...active(), completedExercises: legacyArchive().completedExercises };
    const record = workoutRecordFromDraft(draft);
    const reference = { workoutId, sessionId: 10, prescription: null, completedAt: startedAt };
    const migration = planWorkoutReferenceMigration({ ...history(), workoutArchiveEvidence: [], activeWorkout: draft,
      workoutRecords: [record], workoutReferences: [reference] });
    expect(migration.records).toEqual([record]);
    expect(migration.references).toEqual([reference]);
    expect(migration.activeWorkout).toEqual(draft);
  });

  it("does not reuse an unrelated existing lifecycle identity for a legacy active draft", () => {
    expect(() => planWorkoutReferenceMigration({ sessions: [], sets: [], exercises: [exercise], activeWorkout: active(),
      workoutRecords: [standaloneWorkoutRecord(workoutId)], workoutReferences: [] })).toThrow(/conflicts/i);
  });
  it("allocates durable identities only from verified explicit group membership", () => {
    const data = history();
    const original = JSON.stringify(data);
    const migration = planWorkoutReferenceMigration(data);
    expect(migration.records).toHaveLength(1);
    expect(migration.records[0]).toMatchObject({ kind: "guided", legacyId: startedAt, status: "completed" });
    expect(migration.records[0].id).toMatch(uuid);
    expect(migration.references).toEqual([{ workoutId: migration.records[0].id, sessionId: 10, prescription: null, completedAt: null }]);
    expect(migration.records[0]).not.toHaveProperty("sets");
    expect(migration.records[0]).not.toHaveProperty("entryIds");
    expect(JSON.stringify(data)).toBe(original);
  });

  it("retains the durable active identity and associates verified entries with it", () => {
    const draft = { ...active(), completedExercises: legacyArchive().completedExercises };
    const migration = planWorkoutReferenceMigration({ ...history(), activeWorkout: draft, workoutArchiveEvidence: [] });
    expect(migration.activeWorkout?.workoutId).toBe(workoutId);
    expect(migration.activeWorkout?.revision).toBe(0);
    expect(migration.records).toEqual([expect.objectContaining({ id: workoutId, status: "active", legacyId: startedAt })]);
    expect(migration.references).toEqual([{ workoutId, sessionId: 10, prescription: null, completedAt: null }]);
  });

  it("adds identity to a valid legacy active draft without assigning historical ownership or units", () => {
    const draft = { ...active(), workoutId: undefined, revision: undefined, originalFields: { untouched: 7 } };
    const migration = planWorkoutReferenceMigration({ sessions: [], sets: [], exercises: [exercise], activeWorkout: draft });
    expect(migration.activeWorkout?.workoutId).toMatch(uuid);
    expect(migration.activeWorkout?.revision).toBe(0);
    expect(migration.activeWorkout).toMatchObject({ originalFields: { untouched: 7 } });
    expect(migration.records[0]).not.toHaveProperty("ownerId");
    expect(migration.records[0]).not.toHaveProperty("inputUnit");
    expect(draft.workoutId).toBeUndefined();
  });

  it.each(["unlinked", "conflicting", "wrong-exercise", "malformed", "duplicate-reference", "missing-date", "partial-missing-reference"])(
    "keeps observations standalone when %s archive evidence cannot establish a safe group", (reason) => {
      const archive = legacyArchive();
      let raw: unknown = [archive];
      let sessions = [session];
      if (reason === "unlinked") delete archive.completedExercises[0].sessionId;
      if (reason === "conflicting") raw = [archive, { ...archive, id: "other", startedAt: `${date}T14:00:00Z` }];
      if (reason === "wrong-exercise") archive.completedExercises[0].exerciseId = 2;
      if (reason === "malformed") raw = [{ startedAt, originalValue: 999, unknownUnit: true }];
      if (reason === "duplicate-reference") archive.completedExercises.push(archive.completedExercises[0]);
      if (reason === "missing-date") sessions = [{ ...session, workout_date: "2026-02-30" }];
      if (reason === "partial-missing-reference") archive.completedExercises.push({ ...archive.completedExercises[0], sessionId: 999 });
      const data = { ...history(), sessions, workoutArchiveEvidence: raw };
      const original = JSON.stringify(data);
      const migration = planWorkoutReferenceMigration(data);
      expect(migration.records).toEqual([expect.objectContaining({ kind: "standalone", legacyId: null })]);
      expect(migration.references).toEqual([{ workoutId: migration.records[0].id, sessionId: 10, prescription: null, completedAt: null }]);
      expect(JSON.stringify(data)).toBe(original);
    }
  );

  it("does not infer grouping from the same date, matching values or exercise names", () => {
    const archive = legacyArchive();
    delete archive.completedExercises[0].sessionId;
    archive.completedExercises[0].sets = [{ reps: "5", weight: "100" }, { reps: "5", weight: "100" }];
    const migration = planWorkoutReferenceMigration({ ...history(), workoutArchiveEvidence: [archive] });
    expect(migration.records[0].kind).toBe("standalone");
    expect(migration.references[0].sessionId).toBe(10);
  });
});

describe("revision-aware workout drafts", () => {
  it("accepts the expected revision and leaves the original draft unchanged", () => {
    const candidate = active();
    const saved = advanceWorkoutDraft(null, candidate);
    expect(saved).toEqual({ ...candidate, revision: 1 });
    expect(candidate.revision).toBe(0);
    const updated = advanceWorkoutDraft(saved, { ...saved, scheduleChanges: ["Changed schedule"] });
    expect(updated.revision).toBe(2);
    expect(saved.scheduleChanges).toEqual([]);
  });

  it("returns the existing revision for an identical save retry", () => {
    const candidate = active();
    const saved = advanceWorkoutDraft(null, candidate);
    expect(advanceWorkoutDraft(saved, candidate)).toBe(saved);
    expect(advanceWorkoutDraft(saved, { ...saved })).toBe(saved);
  });

  it("exposes both differing versions on a stale conflict", () => {
    const old = advanceWorkoutDraft(null, active());
    const saved = advanceWorkoutDraft(old, { ...old, scheduleChanges: ["Newer change"] });
    const stale = { ...old, scheduleChanges: ["Other device change"] };
    let conflict: unknown;
    try { advanceWorkoutDraft(saved, stale); } catch (error) { conflict = error; }
    expect(conflict).toBeInstanceOf(DraftConflictError);
    expect((conflict as DraftConflictError).draft).toBe(stale);
    expect((conflict as DraftConflictError).current).toBe(saved);
    expect(saved.scheduleChanges).toEqual(["Newer change"]);
  });

  it("rejects replacement by a different durable workout even when the start time matches", () => {
    const saved = advanceWorkoutDraft(null, active());
    expect(() => advanceWorkoutDraft(saved, { ...saved, workoutId: "different-id" })).toThrow(DraftConflictError);
  });

  it("does not recreate a removed draft through a stale revision", () => {
    const saved = advanceWorkoutDraft(null, active());
    expect(() => advanceWorkoutDraft(null, saved)).toThrow(DraftConflictError);
  });
});

function recording() {
  const draft = active();
  const context = { exerciseId: exercise.id, workoutDate: date, machineProfileId: "gym-a", unitSystem: "lb" as const };
  const current: ActiveWorkout = { ...draft, revision: 3, currentExercise: { ...draft.currentExercise,
    exerciseId: exercise.id, requestId: "record-attempt", requestUnit: "lb", muscle: "Chest", machineProfileId: "gym-a",
    sets: [{ reps: "5", weight: "100" }, { reps: "4", weight: "90", isWarmup: true }].map((set) => confirmGuidedObservation(set, context)) } };
  const input: WorkoutRecordingInput = { requestId: "record-attempt", workoutId, exerciseId: exercise.id,
    workoutDate: date, notes: "", machineProfileId: "gym-a", inputUnit: "lb", recordingOrigin: "guided",
    sets: [{ reps: 5, weight: 100, isWarmup: false }, { reps: 4, weight: 90, isWarmup: true }],
    expectedActive: current, completedAt: `${date}T12:30:00Z` };
  return { current, input };
}

describe("committed guided draft contracts", () => {
  it("advances the exact saved draft with only a recorded reference and clears the entry form", () => {
    const { current, input } = recording();
    const original = JSON.stringify(current);
    const committed = committedWorkoutDraft(current, input, 10);
    expect(committed.revision).toBe(4);
    expect(committed.completedExercises).toEqual([expect.objectContaining({ sessionId: 10, exerciseId: exercise.id, sets: [], completedAt: input.completedAt })]);
    expect(committed.completedExercises[0]).not.toHaveProperty("outcome");
    expect(committed.currentExercise.exerciseId).toBeNull();
    expect(committed.currentExercise.sets.every((set) => !set.reps && !set.weight)).toBe(true);
    expect(JSON.stringify(current)).toBe(original);
  });

  it.each(["workout", "date", "attempt", "exercise", "revision", "notes"])("rejects a changed %s recording context", (changed) => {
    const { current, input } = recording();
    const candidate = { ...input };
    if (changed === "workout") candidate.workoutId = "other-workout";
    if (changed === "date") candidate.workoutDate = "2026-10-02";
    if (changed === "attempt") candidate.requestId = "other-attempt";
    if (changed === "exercise") candidate.exerciseId = 2;
    if (changed === "revision") candidate.expectedActive = { ...current, revision: 2 };
    if (changed === "notes") candidate.expectedActive = { ...current, currentExercise: { ...current.currentExercise, notes: "Changed notes" } };
    expect(() => committedWorkoutDraft(current, candidate, 10)).toThrow();
    expect(current.completedExercises).toEqual([]);
  });

  it("requires a real muscle context rather than inventing one", () => {
    const { current, input } = recording();
    const invalid = { ...current, currentExercise: { ...current.currentExercise, muscle: null } };
    expect(() => committedWorkoutDraft(invalid, { ...input, expectedActive: invalid }, 10)).toThrow(/muscle context/i);
  });
});

describe("confirmed guided values at the recording boundary", () => {
  it("accepts observed values matching the confirmed saved draft", () => {
    const { input } = recording();
    expect(() => assertGuidedRecordingInput(input, exercise)).not.toThrow();
  });

  it("rejects recommendations without a user confirmation, even when parsed values match", () => {
    const { current, input } = recording();
    const unconfirmed = { ...current, currentExercise: { ...current.currentExercise,
      sets: current.currentExercise.sets.map(({ observationConfirmation: _confirmation, ...set }) => set) } };
    expect(() => assertGuidedRecordingInput({ ...input, expectedActive: unconfirmed }, exercise)).toThrow(/mark it as performed/i);
  });

  it.each(["reps", "load", "warmup", "date", "machine", "unit"])("invalidates confirmation when %s changes", (changed) => {
    const { current, input } = recording();
    const edited = { ...current, currentExercise: { ...current.currentExercise, sets: current.currentExercise.sets.map((set) => ({ ...set })) } };
    const candidate = { ...input, expectedActive: edited };
    if (changed === "reps") edited.currentExercise.sets[0].reps = "6";
    if (changed === "load") edited.currentExercise.sets[0].weight = "110";
    if (changed === "warmup") edited.currentExercise.sets[0].isWarmup = true;
    if (changed === "date") candidate.workoutDate = "2026-10-02";
    if (changed === "machine") candidate.machineProfileId = "gym-b";
    if (changed === "unit") { candidate.inputUnit = "kg"; edited.currentExercise.requestUnit = "kg"; }
    expect(() => assertGuidedRecordingInput(candidate, exercise)).toThrow(/mark it as performed/i);
  });

  it("rejects a payload that disagrees with the confirmed observations", () => {
    const { input } = recording();
    expect(() => assertGuidedRecordingInput({ ...input, sets: [{ reps: 50, weight: 100 }] }, exercise)).toThrow(/differ from the confirmed draft/i);
  });
});
