import { buildGuidedRecommendation } from "@/services/guidedWorkout/guidedWorkoutService";
import { emptyActiveExercise } from "@/constants/activeWorkout";
import { ActiveWorkout, ActiveWorkoutExerciseDraft, CompletedWorkoutExercise, Exercise, GuidedWorkoutPreferences, LoggedSetDraft, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { formatWeightInput } from "@/utils/units";

export type GuidedObservationContext = {
  exerciseId: number;
  workoutDate: string;
  machineProfileId?: string | null;
  unitSystem: UnitSystem;
};

/** Ephemeral commit context; the durable retry identity remains on the existing draft. */
export type GuidedCommitAttempt = {
  workoutId: string;
  workoutDate: string;
  unitSystem: UnitSystem;
  draft: ActiveWorkoutExerciseDraft & { requestId: string };
};

export function sameGuidedExerciseDraft(left: ActiveWorkoutExerciseDraft, right: ActiveWorkoutExerciseDraft) {
  function signature(draft: ActiveWorkoutExerciseDraft) {
    return JSON.stringify([
      draft.requestId, draft.requestUnit, draft.muscle, draft.exerciseId, draft.machineProfileId ?? null,
      draft.notes, draft.barWeight,
      Object.entries(draft.plateCounts).sort(([left], [right]) => left.localeCompare(right)),
      draft.sets.map((set) => [set.reps, set.weight, Boolean(set.isWarmup), set.observationConfirmation])
    ]);
  }
  return signature(left) === signature(right);
}

export function sameGuidedSetValues(left: LoggedSetDraft[], right: LoggedSetDraft[]) {
  const values = (sets: LoggedSetDraft[]) => JSON.stringify(sets.map((set) => [set.reps, set.weight, Boolean(set.isWarmup)]));
  return values(left) === values(right);
}

/** Append one known committed entry without replacing work entered while the request was pending. */
export function reconcileGuidedCommit(
  latest: ActiveWorkout,
  attempt: GuidedCommitAttempt,
  completed: CompletedWorkoutExercise & { sessionId: number },
  currentUnitSystem: UnitSystem
) {
  if (latest.startedAt !== attempt.workoutId) {
    throw new Error("Exercise saved. Your active workout changed while saving; the newer workout was kept.");
  }
  const currentUnchanged = latest.workoutDate === attempt.workoutDate
    && currentUnitSystem === attempt.unitSystem
    && sameGuidedExerciseDraft(latest.currentExercise, attempt.draft);
  const alreadyCompleted = latest.completedExercises.some((entry) => entry.sessionId === completed.sessionId && entry.exerciseId === completed.exerciseId);
  return {
    currentUnchanged,
    workout: {
      ...latest,
      completedExercises: alreadyCompleted ? latest.completedExercises : [...latest.completedExercises, completed],
      currentExercise: currentUnchanged ? emptyActiveExercise() : latest.currentExercise
    }
  };
}

export function canConfirmGuidedObservation(set: LoggedSetDraft) {
  const reps = Number(set.reps);
  const weight = Number(set.weight);
  return Boolean(set.reps.trim() && set.weight.trim())
    && Number.isInteger(reps) && reps > 0
    && Number.isFinite(weight) && weight >= 0;
}

function observationFingerprint(set: LoggedSetDraft, context: GuidedObservationContext) {
  return JSON.stringify([
    "guided-observation-v1",
    context.exerciseId,
    context.workoutDate,
    context.machineProfileId ?? null,
    context.unitSystem,
    set.reps.trim(),
    set.weight.trim(),
    Boolean(set.isWarmup)
  ]);
}

/** Only call in response to the user explicitly marking this set as performed. */
export function confirmGuidedObservation(set: LoggedSetDraft, context: GuidedObservationContext): LoggedSetDraft {
  if (!canConfirmGuidedObservation(set)) {
    throw new Error("Enter the reps and load you performed before confirming this set.");
  }
  return { ...set, observationConfirmation: observationFingerprint(set, context) };
}

export function isGuidedObservationConfirmed(set: LoggedSetDraft, context: GuidedObservationContext) {
  return canConfirmGuidedObservation(set)
    && set.observationConfirmation === observationFingerprint(set, context);
}

/** A recording-boundary guard, including warm-ups and previously persisted drafts. */
export function assertGuidedObservationsConfirmed(sets: LoggedSetDraft[], context: GuidedObservationContext) {
  for (const [index, set] of sets.entries()) {
    if (!set.reps.trim() && !set.weight.trim()) continue;
    if (!isGuidedObservationConfirmed(set, context)) {
      throw new Error(`Check set ${index + 1}, then mark it as performed. Suggested or changed values cannot be saved without confirmation.`);
    }
  }
}

/** Suggestions are editable drafts. They never acquire observation confirmation here. */
export function buildUnconfirmedGuidedSets(input: {
  exercise: Exercise;
  preferences: GuidedWorkoutPreferences;
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  workoutDate: string;
  machineProfileId?: string | null;
  machineScoped?: boolean;
  unitSystem: UnitSystem;
}): LoggedSetDraft[] {
  const baseSets: LoggedSetDraft[] = [{ reps: "", weight: "" }, { reps: "", weight: "" }, { reps: "", weight: "" }];
  const recommendation = buildGuidedRecommendation({
    exercise: input.exercise,
    preferences: input.preferences,
    sessions: input.sessions,
    sets: input.sets,
    workoutDate: input.workoutDate,
    draftWarmups: baseSets.map((set) => Boolean(set.isWarmup)),
    machineProfileId: input.machineProfileId,
    machineScoped: input.machineScoped
  });
  const targetCount = Math.max(3, recommendation.targets.reduce((max, target) => Math.max(max, target.draftIndex + 1), 0), recommendation.latest?.sets.length ?? 0);
  const nextSets = Array.from({ length: targetCount }, (): LoggedSetDraft => ({ reps: "", weight: "" }));

  if (recommendation.category === "unguided" && recommendation.latest?.sets.length) {
    return recommendation.latest.sets.map((set) => ({
      reps: String(set.reps),
      weight: formatWeightInput(set.weight, input.unitSystem),
      isWarmup: Boolean(set.is_warmup)
    }));
  }

  for (const target of recommendation.targets) {
    const targetReps = Number(target.targetReps);
    if (Number.isInteger(targetReps) && targetReps > 0) nextSets[target.draftIndex].reps = String(targetReps);
    if (target.increaseWeight) continue;
    const sourceWeight = target.priorWeight ?? recommendation.latest?.sets[target.workingSetNumber - 1]?.weight;
    if (Number.isFinite(sourceWeight)) nextSets[target.draftIndex].weight = formatWeightInput(Number(sourceWeight), input.unitSystem);
  }

  return nextSets;
}
