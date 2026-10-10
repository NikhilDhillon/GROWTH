import { describe, expect, it } from "vitest";

import { createActiveWorkout, normalizeActiveWorkout } from "@/constants/activeWorkout";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { assertGuidedObservationsConfirmed, buildUnconfirmedGuidedSets, canConfirmGuidedObservation, confirmGuidedObservation, GuidedCommitAttempt, GuidedObservationContext, isGuidedObservationConfirmed, reconcileGuidedCommit } from "@/services/guidedWorkout/guidedObservationService";
import { CompletedWorkoutExercise, Exercise, LoggedSetDraft, WorkoutSet } from "@/types";

const context: GuidedObservationContext = { exerciseId: 1, workoutDate: "2026-10-04", machineProfileId: "machine-a", unitSystem: "lb" };
const exercise: Exercise = { id: 1, name: "Barbell Curl", primary_muscle: "Biceps", is_strength_exercise: 1, created_at: "2026-01-01" };
const previousSets: WorkoutSet[] = [1, 2, 3].map((id) => ({
  id, session_id: 10, exercise_id: 1, set_number: id, reps: 5, weight: 100, is_warmup: false, created_at: "2026-10-01"
}));

function suggestedSets(selectedExercise = exercise) {
  return buildUnconfirmedGuidedSets({
    exercise: selectedExercise,
    preferences: createDefaultGuidedWorkoutPreferences(),
    sessions: [{ id: 10, workout_date: "2026-10-01", created_at: "2026-10-01", machine_profile_id: "machine-a" }],
    sets: previousSets,
    workoutDate: context.workoutDate,
    machineProfileId: context.machineProfileId,
    unitSystem: context.unitSystem
  });
}

describe("guided observations", () => {
  it("keeps suggested reps and prior loads unrecordable until the user confirms each set", () => {
    const draft = suggestedSets();
    expect(draft.map((set) => [set.reps, set.weight])).toEqual([["8", "100"], ["8", "100"], ["8", "100"]]);
    expect(() => assertGuidedObservationsConfirmed(draft, context)).toThrow(/set 1.*performed/);

    const firstConfirmed = [confirmGuidedObservation(draft[0], context), ...draft.slice(1)];
    expect(() => assertGuidedObservationsConfirmed(firstConfirmed, context)).toThrow(/set 2.*performed/);

    const performed = draft.map((set) => confirmGuidedObservation(set, context));
    expect(() => assertGuidedObservationsConfirmed(performed, context)).not.toThrow();
    expect(draft.every((set) => !set.observationConfirmation)).toBe(true);
  });

  it("does not mistake copied unguided history for newly performed work", () => {
    const draft = suggestedSets({ ...exercise, name: "Pull-Up" });
    expect(draft[0].reps).toBe("5");
    expect(() => assertGuidedObservationsConfirmed(draft, context)).toThrow(/performed/);
  });

  it("preserves legacy draft values without assigning confirmation on resume", () => {
    const active = createActiveWorkout({ key: "sun", label: "Sunday", muscles: ["Biceps"] });
    active.workoutDate = context.workoutDate;
    active.currentExercise.exerciseId = context.exerciseId;
    active.currentExercise.sets = [{ reps: "8", weight: "100" }, { reps: "7", weight: "95", isWarmup: true }];
    const persisted = JSON.parse(JSON.stringify(active));
    const resumed = normalizeActiveWorkout(persisted)!;

    expect(resumed.currentExercise.sets).toEqual(active.currentExercise.sets);
    expect(() => assertGuidedObservationsConfirmed(resumed.currentExercise.sets, context)).toThrow(/performed/);
  });

  it.each([
    { reps: "9" },
    { weight: "110" },
    { isWarmup: true }
  ])("invalidates confirmation when observed input changes: %j", (patch) => {
    const confirmed = confirmGuidedObservation({ reps: "8", weight: "100" }, context);
    expect(isGuidedObservationConfirmed({ ...confirmed, ...patch }, context)).toBe(false);
    expect(() => assertGuidedObservationsConfirmed([{ ...confirmed, ...patch }], context)).toThrow(/changed values/);
  });

  it.each([
    { exerciseId: 2 },
    { workoutDate: "2026-10-05" },
    { machineProfileId: "machine-b" },
    { unitSystem: "kg" as const }
  ])("requires renewed confirmation when recording context changes: %j", (patch) => {
    const confirmed = confirmGuidedObservation({ reps: "8", weight: "100" }, context);
    expect(isGuidedObservationConfirmed(confirmed, { ...context, ...patch })).toBe(false);
  });

  it("retains deliberate confirmation across persistence and resume", () => {
    const confirmed = confirmGuidedObservation({ reps: "8", weight: "100" }, context);
    const resumed = JSON.parse(JSON.stringify(confirmed));
    expect(isGuidedObservationConfirmed(resumed, context)).toBe(true);
  });

  it("requires confirmation of entered warm-ups, while allowing unused blank rows", () => {
    const working = confirmGuidedObservation({ reps: "8", weight: "100" }, context);
    const warmup = { reps: "10", weight: "45", isWarmup: true };
    const blank = { reps: "", weight: "" };
    expect(() => assertGuidedObservationsConfirmed([working, warmup, blank], context)).toThrow(/set 2/);
    expect(() => assertGuidedObservationsConfirmed([working, confirmGuidedObservation(warmup, context), blank], context)).not.toThrow();
  });

  it.each<LoggedSetDraft>([
    { reps: "", weight: "100" },
    { reps: "8", weight: "" },
    { reps: "0", weight: "100" },
    { reps: "8.5", weight: "100" },
    { reps: "8", weight: "-1" },
    { reps: "8", weight: "Infinity" }
  ])("does not confirm incomplete or invalid observations: %j", (draft) => {
    expect(canConfirmGuidedObservation(draft)).toBe(false);
    expect(() => confirmGuidedObservation(draft, context)).toThrow(/Enter the reps and load/);
  });

  it("permits deliberate confirmation of zero added load for bodyweight work", () => {
    const confirmed = confirmGuidedObservation({ reps: "8", weight: "0" }, context);
    expect(isGuidedObservationConfirmed(confirmed, context)).toBe(true);
  });
});

describe("guidance commit reconciliation", () => {
  function committingWorkout() {
    const workout = createActiveWorkout({ key: "sun", label: "Sunday", muscles: ["Biceps"] });
    workout.workoutDate = context.workoutDate;
    workout.currentExercise = {
      ...workout.currentExercise, requestId: "committed-request", exerciseId: exercise.id, muscle: "Biceps",
      sets: [confirmGuidedObservation({ reps: "8", weight: "100" }, context)], notes: "Original notes"
    };
    const attempt: GuidedCommitAttempt = {
      workoutId: workout.startedAt, workoutDate: workout.workoutDate, unitSystem: "lb",
      draft: { ...workout.currentExercise, requestId: "committed-request" }
    };
    const completed: CompletedWorkoutExercise & { sessionId: number } = {
      exerciseId: exercise.id, sessionId: 42, exerciseName: exercise.name, muscle: exercise.primary_muscle,
      sets: attempt.draft.sets, completedAt: "2026-10-04T19:00:00Z"
    };
    return { workout, attempt, completed };
  }

  it("clears only the exact committed draft and appends its canonical session once", () => {
    const { workout, attempt, completed } = committingWorkout();
    const first = reconcileGuidedCommit(workout, attempt, completed, "lb");
    expect(first.currentUnchanged).toBe(true);
    expect(first.workout.currentExercise.exerciseId).toBeNull();
    expect(first.workout.completedExercises.map((entry) => entry.sessionId)).toEqual([42]);

    const retry = reconcileGuidedCommit({ ...first.workout, currentExercise: attempt.draft }, attempt, completed, "lb");
    expect(retry.workout.completedExercises.map((entry) => entry.sessionId)).toEqual([42]);
  });

  it("keeps newer entries, notes, and schedule state after a suspended commit resumes", () => {
    const { workout, attempt, completed } = committingWorkout();
    const newer = {
      ...workout, scheduleChanges: ["Newer schedule choice"],
      currentExercise: { ...workout.currentExercise, notes: "New notes", sets: [{ reps: "10", weight: "110" }] }
    };
    const result = reconcileGuidedCommit(newer, attempt, completed, "lb");
    expect(result.currentUnchanged).toBe(false);
    expect(result.workout.currentExercise).toBe(newer.currentExercise);
    expect(result.workout.scheduleChanges).toEqual(["Newer schedule choice"]);
    expect(result.workout.completedExercises[0].sets).toEqual(attempt.draft.sets);
  });

  it("does not clear a draft whose recording units changed while the commit was pending", () => {
    const { workout, attempt, completed } = committingWorkout();
    const result = reconcileGuidedCommit(workout, attempt, completed, "kg");
    expect(result.currentUnchanged).toBe(false);
    expect(result.workout.currentExercise).toBe(workout.currentExercise);
  });

  it("cannot replace an unrelated active workout with a captured older workout", () => {
    const { workout, attempt, completed } = committingWorkout();
    const newer = { ...workout, startedAt: "2026-10-04T20:00:00Z" };
    expect(() => reconcileGuidedCommit(newer, attempt, completed, "lb")).toThrow(/newer workout was kept/);
    expect(newer.currentExercise).toBe(workout.currentExercise);
    expect(newer.completedExercises).toEqual([]);
  });
});
