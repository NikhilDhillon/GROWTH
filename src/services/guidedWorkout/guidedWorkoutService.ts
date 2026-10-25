import { categoryForExercise } from "@/constants/guidedWorkout";
import { ExerciseLoadType, getExerciseLoadType } from "@/constants/exercises";
import { daysBetween, isCalendarDate } from "@/domain/calendar";
import type { Prescription, PrescribedSet } from "@/domain/types";
import { Exercise, GuidedExerciseCategory, GuidedSessionOutcome, GuidedWorkoutPreferences, LoggedSetDraft, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { weightToStorageUnit } from "@/utils/units";

const prescribedWorkingSetCount = 3;

export type GuidedSetTarget = {
  draftIndex: number;
  workingSetNumber: number;
  role: "working" | "top_set" | "backoff";
  priorWeight?: number;
  targetReps?: number;
  increaseWeight: boolean;
};

export type GuidedSessionSummary = {
  sessionId: number;
  date: string;
  machineProfileId?: string | null;
  sets: WorkoutSet[];
};

export type GuidedRecommendation = {
  category: GuidedExerciseCategory;
  targets: GuidedSetTarget[];
  latest?: GuidedSessionSummary;
  best?: GuidedSessionSummary;
  topSetBest?: GuidedSessionSummary;
  backoffBest?: GuidedSessionSummary;
  inactive: boolean;
  topSetReady: boolean;
  backoffReady: boolean;
  blockReady: boolean;
};

/** Freeze what was actually prescribed. A request to increase load has no invented numeric target. */
export function buildGuidedPrescription(input: {
  exerciseId: number;
  recommendation: GuidedRecommendation;
  generatedAt: string;
}): Prescription {
  return {
    exerciseId: input.exerciseId,
    category: input.recommendation.category,
    sets: input.recommendation.targets.map((target) => ({
      // Working ordinal is independent of warmups and editable draft row positions.
      setNumber: target.workingSetNumber,
      isWarmup: false,
      targetReps: target.targetReps === undefined ? null : { minimum: target.targetReps, maximum: target.targetReps },
      targetLoadLb: target.increaseWeight ? null : target.priorWeight ?? null
    })),
    generatedAt: input.generatedAt,
    // Increase recommendations can come from an older earned session; the legacy API does not identify it.
    basedOnEntryIds: input.recommendation.latest && !input.recommendation.targets.some((target) => target.increaseWeight)
      ? [input.recommendation.latest.sessionId] : [],
    comparisonContext: null
  };
}

export type GuidedAchievementObservation = { reps: number; loadLb: number; isWarmup: boolean };
export type GuidedAchievementStatus = "achieved" | "not_met" | "not_evaluable";
export type GuidedSetAchievement = {
  setNumber: number;
  status: GuidedAchievementStatus;
  reason?: "missing_target" | "missing_observation" | "invalid_observation" | "reps" | "load";
};
export type GuidedAchievement = { status: GuidedAchievementStatus; sets: GuidedSetAchievement[] };

/** Evaluate observed working sets at the prescribed load, rather than treating rep completion as achievement. */
export function evaluateGuidedAchievement(input: {
  prescription: Prescription;
  loadType: ExerciseLoadType;
  sets: GuidedAchievementObservation[];
}): GuidedAchievement {
  const observations = input.sets.filter((set) => !set.isWarmup);
  const targets = input.prescription.sets.filter((set) => !set.isWarmup);
  const duplicateNumbers = new Set(targets.filter((target, index) => targets.findIndex((other) => other.setNumber === target.setNumber) !== index).map((target) => target.setNumber));
  const sets = targets.map((target): GuidedSetAchievement => {
    if (duplicateNumbers.has(target.setNumber) || !validPrescriptionTarget(target)) {
      return { setNumber: target.setNumber, status: "not_evaluable", reason: "missing_target" };
    }
    const observed = observations[target.setNumber - 1];
    if (!observed) return { setNumber: target.setNumber, status: "not_met", reason: "missing_observation" };
    if (!Number.isInteger(observed.reps) || observed.reps <= 0 || !Number.isFinite(observed.loadLb) || observed.loadLb < 0) {
      return { setNumber: target.setNumber, status: "not_met", reason: "invalid_observation" };
    }
    if (observed.reps < target.targetReps!.minimum) return { setNumber: target.setNumber, status: "not_met", reason: "reps" };
    const loadAchieved = input.loadType === "bodyweight_minus_assistance"
      ? observed.loadLb <= target.targetLoadLb!
      : observed.loadLb >= target.targetLoadLb!;
    return loadAchieved
      ? { setNumber: target.setNumber, status: "achieved" }
      : { setNumber: target.setNumber, status: "not_met", reason: "load" };
  });
  const status: GuidedAchievementStatus = sets.length === 0 || sets.some((set) => set.status === "not_evaluable")
    ? "not_evaluable"
    : sets.every((set) => set.status === "achieved") ? "achieved" : "not_met";
  return { status, sets };
}

function validPrescriptionTarget(target: PrescribedSet) {
  return Number.isInteger(target.setNumber) && target.setNumber > 0 &&
    target.targetReps != null && Number.isInteger(target.targetReps.minimum) && target.targetReps.minimum > 0 &&
    Number.isInteger(target.targetReps.maximum) && target.targetReps.maximum >= target.targetReps.minimum &&
    target.targetLoadLb !== null && Number.isFinite(target.targetLoadLb) && target.targetLoadLb >= 0;
}

export function buildGuidedSessionOutcome(input: {
  exercise: Exercise;
  preferences: GuidedWorkoutPreferences;
  recommendation?: GuidedRecommendation | null;
  /** A persisted draft snapshot takes precedence over a freshly calculated recommendation. */
  prescription?: Prescription | null;
  /** Required to interpret entered load. Missing units cannot establish achievement. */
  unitSystem?: UnitSystem;
  sets: LoggedSetDraft[];
}): GuidedSessionOutcome {
  const category = input.prescription?.category ?? input.recommendation?.category ?? categoryForExercise(input.exercise.name, input.preferences);
  if (category === "unguided") {
    return { category, celebrated: false, messages: ["Session logged for reference. No progression guidance applies to this exercise."] };
  }
  const prescription = input.prescription ?? (input.recommendation ? buildGuidedPrescription({
    exerciseId: input.exercise.id, recommendation: input.recommendation, generatedAt: ""
  }) : null);
  if (!prescription || prescription.exerciseId !== input.exercise.id || !input.unitSystem) {
    return { category, celebrated: false, messages: ["Session logged. Target achievement could not be evaluated without the original prescription and recording unit."] };
  }
  const loadType = getExerciseLoadType(input.exercise);
  const observations = input.sets.map((set) => ({
    reps: set.reps.trim() ? Number(set.reps) : Number.NaN,
    loadLb: set.weight.trim() ? weightToStorageUnit(Number(set.weight), input.unitSystem!) : Number.NaN,
    isWarmup: Boolean(set.isWarmup)
  }));
  const evaluate = (sets: PrescribedSet[]) => evaluateGuidedAchievement({ prescription: { ...prescription, sets }, loadType, sets: observations }).status;
  const nextLoad = loadType === "bodyweight_minus_assistance" ? "Reduce the assistance" : "Increase the weight";
  const missingTarget = "Session logged. No complete numeric target was prescribed, so target achievement could not be evaluated.";
  if (category !== "top_set") {
    const status = evaluate(prescription.sets);
    const achieved = status === "achieved";
    return {
      category,
      celebrated: achieved,
      messages: [status === "not_evaluable" ? missingTarget : achieved
        ? category === "hypertrophy"
          ? `Full pyramid reps and load targets achieved. ${nextLoad} next session.`
          : `All strength reps and load targets achieved. ${nextLoad} next session.`
        : category === "hypertrophy"
          ? "Build toward every prescribed rep and load target in the full pyramid next session."
          : "Build toward the remaining prescribed rep and load targets next session."]
    };
  }

  const messages: string[] = [];
  let celebrated = false;
  const workingTargets = prescription.sets.filter((set) => !set.isWarmup).sort((a, b) => a.setNumber - b.setNumber);
  const topSet = workingTargets.find((target) => target.setNumber === 1);
  if (topSet) {
    const status = evaluate([topSet]);
    const achieved = status === "achieved";
    celebrated ||= achieved;
    messages.push(status === "not_evaluable"
      ? "Top set logged. No complete numeric top-set target was prescribed, so achievement could not be evaluated."
      : achieved ? `Top-set reps and load targets achieved. ${nextLoad} for the top set next session.`
        : "Build toward both the prescribed top-set reps and load next session.");
  } else {
    messages.push("No numeric top-set target was prescribed, so achievement could not be evaluated.");
  }

  const backoffs = workingTargets.filter((target) => target.setNumber > 1);
  if (backoffs.length < 2) {
    messages.push("At least two prescribed back-off working sets are needed to evaluate back-off progression.");
  } else {
    const status = evaluate(backoffs);
    const achieved = status === "achieved";
    celebrated ||= achieved;
    messages.push(status === "not_evaluable"
      ? "Back-off sets logged. No complete numeric back-off targets were prescribed, so achievement could not be evaluated."
      : achieved ? `All back-off reps and load targets achieved. ${nextLoad} for the back-off sets next session.`
        : "Build toward both the prescribed back-off reps and loads next session.");
  }
  return { category, celebrated, messages };
}

export function buildGuidedRecommendation(input: {
  exercise: Exercise;
  preferences: GuidedWorkoutPreferences;
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  workoutDate: string;
  draftWarmups: boolean[];
  machineProfileId?: string | null;
  machineScoped?: boolean;
}): GuidedRecommendation {
  const assistance = getExerciseLoadType(input.exercise) === "bodyweight_minus_assistance";
  const category = categoryForExercise(input.exercise.name, input.preferences);
  const draftWorkingIndexes = prescribedWorkingIndexes(input.draftWarmups);
  const requiredSetCount = prescribedWorkingSetCount;
  const allSummaries = exerciseSessions(input.exercise.id, input.sessions, input.sets).filter((summary) => isCalendarDate(input.workoutDate) && summary.date <= input.workoutDate);
  // Untagged machine sessions form one shared history, matching how they are scored.
  const sameMachineSummaries = allSummaries.filter((summary) => (summary.machineProfileId ?? null) === (input.machineProfileId ?? null));
  const summaries = input.machineScoped || input.machineProfileId ? sameMachineSummaries : allSummaries;
  const latest = summaries.at(-1);
  const inactive = latest ? daysBetween(latest.date, input.workoutDate) > input.preferences.inactivityDays : false;
  const latestWorking = latest?.sets ?? [];
  const targets = category === "unguided"
    ? []
    : draftWorkingIndexes.map((draftIndex, index) => ({
        draftIndex,
        workingSetNumber: index + 1,
        role: category === "top_set" ? (index === 0 ? "top_set" : "backoff") : "working",
        priorWeight: latestWorking[index]?.weight,
        targetReps: targetReps(category, index, input.preferences),
        increaseWeight: false
      } as GuidedSetTarget));

  const blockSource = !inactive && (category === "strength" || category === "hypertrophy")
    ? earnedSource(summaries, (sets) => completesTargets(category, sets, requiredSetCount, input.preferences), (later, earned) => hasIncreasedLoad(later, earned, 0, requiredSetCount, assistance))
    : undefined;
  const topSetSource = !inactive && category === "top_set"
    ? earnedSource(summaries, (sets) => Boolean(sets[0]) && sets[0].reps >= input.preferences.topSetTargetReps, (later, earned) => hasIncreasedLoad(later, earned, 0, 1, assistance))
    : undefined;
  const backoffSource = !inactive && category === "top_set" && requiredSetCount >= 3
    ? earnedSource(summaries, (sets) => sets.length >= requiredSetCount && sets.slice(1, requiredSetCount).every((set) => set.reps >= input.preferences.strengthTargetReps), (later, earned) => hasIncreasedLoad(later, earned, 1, requiredSetCount, assistance))
    : undefined;
  const blockReady = Boolean(blockSource);
  const topSetReady = Boolean(topSetSource);
  const backoffReady = Boolean(backoffSource);

  for (const target of targets) {
    target.increaseWeight = blockReady ||
      (target.role === "top_set" && topSetReady) ||
      (target.role === "backoff" && backoffReady);
    const earned = blockSource ?? (target.role === "top_set" ? topSetSource : target.role === "backoff" ? backoffSource : undefined);
    if (target.increaseWeight && earned) target.priorWeight = earned.sets[target.workingSetNumber - 1]?.weight;
    if (target.increaseWeight) target.targetReps = undefined;
  }

  const completed = summaries.filter((summary) => qualifiesAsBest(category, summary.sets, requiredSetCount, input.preferences));
  const best = completed.reduce<GuidedSessionSummary | undefined>((current, summary) => {
    if (!current || compareLoad(summary, current, category, assistance) > 0) return summary;
    return current;
  }, undefined);
  const topSetBest = category === "top_set"
    ? chooseBest(summaries.filter((summary) => summary.sets[0]?.reps >= input.preferences.topSetTargetReps), "top_set", assistance)
    : undefined;
  const backoffBest = category === "top_set" && requiredSetCount >= 3
    ? chooseBest(
        summaries.filter((summary) => summary.sets.length >= requiredSetCount && summary.sets.slice(1, requiredSetCount).every((set) => set.reps >= input.preferences.strengthTargetReps)),
        "backoff", assistance
      )
    : undefined;

  return { category, targets, latest, best, topSetBest, backoffBest, inactive, topSetReady, backoffReady, blockReady };
}

function prescribedWorkingIndexes(draftWarmups: boolean[]) {
  const indexes = draftWarmups
    .map((warmup, index) => warmup ? -1 : index)
    .filter((index) => index >= 0)
    .slice(0, prescribedWorkingSetCount);
  for (let index = draftWarmups.length; indexes.length < prescribedWorkingSetCount; index += 1) {
    indexes.push(index);
  }
  return indexes;
}

function exerciseSessions(exerciseId: number, sessions: WorkoutSession[], sets: WorkoutSet[]) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const grouped = sets
    .filter((set) => set.exercise_id === exerciseId && !set.is_warmup)
    .reduce<Map<number, WorkoutSet[]>>((output, set) => {
      output.set(set.session_id, [...(output.get(set.session_id) ?? []), set]);
      return output;
    }, new Map());
  return [...grouped.entries()]
    .map(([sessionId, groupedSets]) => ({
      sessionId,
      date: sessionById.get(sessionId)?.workout_date ?? "",
      machineProfileId: sessionById.get(sessionId)?.machine_profile_id ?? null,
      sets: groupedSets.sort((a, b) => a.set_number - b.set_number)
    }))
    .filter((summary) => isCalendarDate(summary.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
}

function targetReps(category: GuidedExerciseCategory, index: number, preferences: GuidedWorkoutPreferences) {
  if (category === "hypertrophy") {
    return Math.max(1, preferences.hypertrophyTargetReps - (index * preferences.hypertrophyRepDecrement));
  }
  if (category === "top_set" && index === 0) return preferences.topSetTargetReps;
  return preferences.strengthTargetReps;
}

function completesTargets(category: GuidedExerciseCategory, sets: WorkoutSet[], requiredSetCount: number, preferences: GuidedWorkoutPreferences) {
  return requiredSetCount > 0 &&
    sets.length >= requiredSetCount &&
    sets.slice(0, requiredSetCount).every((set, index) => set.reps >= targetReps(category, index, preferences));
}

function qualifiesAsBest(category: GuidedExerciseCategory, sets: WorkoutSet[], requiredSetCount: number, preferences: GuidedWorkoutPreferences) {
  if (category === "unguided") return sets.length > 0;
  if (category === "top_set") {
    return requiredSetCount >= 3 &&
      sets.length >= requiredSetCount &&
      sets[0].reps >= preferences.topSetTargetReps &&
      sets.slice(1, requiredSetCount).every((set) => set.reps >= preferences.strengthTargetReps);
  }
  return completesTargets(category, sets, requiredSetCount, preferences);
}

function compareLoad(a: GuidedSessionSummary, b: GuidedSessionSummary, category: GuidedExerciseCategory, assistance: boolean) {
  const direction = assistance ? -1 : 1;
  if (category === "top_set") return (a.sets[0].weight - b.sets[0].weight) * direction || (totalWeight(a) - totalWeight(b)) * direction;
  if (category === "unguided") return (totalWeight(a) - totalWeight(b)) * direction || totalReps(a) - totalReps(b);
  return (totalWeight(a) - totalWeight(b)) * direction;
}

function totalWeight(summary: GuidedSessionSummary) {
  return summary.sets.reduce((total, set) => total + set.weight, 0);
}

function totalReps(summary: GuidedSessionSummary) {
  return summary.sets.reduce((total, set) => total + set.reps, 0);
}

function chooseBest(summaries: GuidedSessionSummary[], block: "top_set" | "backoff", assistance = false) {
  return summaries.reduce<GuidedSessionSummary | undefined>((current, summary) => {
    if (!current) return summary;
    const currentSets = block === "top_set" ? current.sets.slice(0, 1) : current.sets.slice(1);
    const summarySets = block === "top_set" ? summary.sets.slice(0, 1) : summary.sets.slice(1);
    const currentLoad = currentSets.reduce((total, set) => total + set.weight, 0);
    const summaryLoad = summarySets.reduce((total, set) => total + set.weight, 0);
    return (assistance ? summaryLoad < currentLoad : summaryLoad > currentLoad) ? summary : current;
  }, undefined);
}

function earnedSource(
  summaries: GuidedSessionSummary[],
  achieved: (sets: WorkoutSet[]) => boolean,
  consumed: (later: WorkoutSet[], earned: WorkoutSet[]) => boolean
) {
  for (let index = summaries.length - 1; index >= 0; index -= 1) {
    const candidate = summaries[index];
    if (!achieved(candidate.sets)) continue;
    const used = summaries.slice(index + 1).some((summary) => consumed(summary.sets, candidate.sets));
    if (!used) return candidate;
    return undefined;
  }
  return undefined;
}

function hasIncreasedLoad(later: WorkoutSet[], earned: WorkoutSet[], from: number, to: number, assistance: boolean) {
  return later.slice(from, to).some((set, offset) => {
    const prior = earned[from + offset];
    return prior && (assistance ? set.weight < prior.weight : set.weight > prior.weight);
  });
}
