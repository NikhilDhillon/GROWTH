import { categoryForExercise } from "@/constants/guidedWorkout";
import { Exercise, GuidedExerciseCategory, GuidedWorkoutPreferences, WorkoutSession, WorkoutSet } from "@/types";

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

export function buildGuidedRecommendation(input: {
  exercise: Exercise;
  preferences: GuidedWorkoutPreferences;
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  workoutDate: string;
  draftWarmups: boolean[];
}): GuidedRecommendation {
  const category = categoryForExercise(input.exercise.name, input.preferences);
  const draftWorkingIndexes = input.draftWarmups
    .map((warmup, index) => warmup ? -1 : index)
    .filter((index) => index >= 0);
  const requiredSetCount = draftWorkingIndexes.length;
  const summaries = exerciseSessions(input.exercise.id, input.sessions, input.sets);
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
    ? earnedSource(summaries, (sets) => completesTargets(category, sets, requiredSetCount, input.preferences), (later, earned) => hasIncreasedLoad(later, earned, 0, requiredSetCount))
    : undefined;
  const topSetSource = !inactive && category === "top_set"
    ? earnedSource(summaries, (sets) => Boolean(sets[0]) && sets[0].reps >= input.preferences.topSetTargetReps, (later, earned) => hasIncreasedLoad(later, earned, 0, 1))
    : undefined;
  const backoffSource = !inactive && category === "top_set" && requiredSetCount >= 3
    ? earnedSource(summaries, (sets) => sets.length >= requiredSetCount && sets.slice(1, requiredSetCount).every((set) => set.reps >= input.preferences.strengthTargetReps), (later, earned) => hasIncreasedLoad(later, earned, 1, requiredSetCount))
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
    if (!current || compareLoad(summary, current, category) > 0) return summary;
    return current;
  }, undefined);
  const topSetBest = category === "top_set"
    ? chooseBest(summaries.filter((summary) => summary.sets[0]?.reps >= input.preferences.topSetTargetReps), "top_set")
    : undefined;
  const backoffBest = category === "top_set" && requiredSetCount >= 3
    ? chooseBest(
        summaries.filter((summary) => summary.sets.length >= requiredSetCount && summary.sets.slice(1, requiredSetCount).every((set) => set.reps >= input.preferences.strengthTargetReps)),
        "backoff"
      )
    : undefined;

  return { category, targets, latest, best, topSetBest, backoffBest, inactive, topSetReady, backoffReady, blockReady };
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
      date: sessionById.get(sessionId)?.workout_date ?? groupedSets[0].created_at.slice(0, 10),
      sets: groupedSets.sort((a, b) => a.set_number - b.set_number)
    }))
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

function compareLoad(a: GuidedSessionSummary, b: GuidedSessionSummary, category: GuidedExerciseCategory) {
  if (category === "top_set") return a.sets[0].weight - b.sets[0].weight || totalWeight(a) - totalWeight(b);
  if (category === "unguided") return totalWeight(a) - totalWeight(b) || totalReps(a) - totalReps(b);
  return totalWeight(a) - totalWeight(b);
}

function totalWeight(summary: GuidedSessionSummary) {
  return summary.sets.reduce((total, set) => total + set.weight, 0);
}

function totalReps(summary: GuidedSessionSummary) {
  return summary.sets.reduce((total, set) => total + set.reps, 0);
}

function chooseBest(summaries: GuidedSessionSummary[], block: "top_set" | "backoff") {
  return summaries.reduce<GuidedSessionSummary | undefined>((current, summary) => {
    if (!current) return summary;
    const currentSets = block === "top_set" ? current.sets.slice(0, 1) : current.sets.slice(1);
    const summarySets = block === "top_set" ? summary.sets.slice(0, 1) : summary.sets.slice(1);
    const currentLoad = currentSets.reduce((total, set) => total + set.weight, 0);
    const summaryLoad = summarySets.reduce((total, set) => total + set.weight, 0);
    return summaryLoad > currentLoad ? summary : current;
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

function hasIncreasedLoad(later: WorkoutSet[], earned: WorkoutSet[], from: number, to: number) {
  return later.slice(from, to).some((set, offset) => set.weight > (earned[from + offset]?.weight ?? Number.POSITIVE_INFINITY));
}

function daysBetween(previous: string, current: string) {
  const previousTime = new Date(`${previous}T12:00:00`).getTime();
  const currentTime = new Date(`${current}T12:00:00`).getTime();
  return Math.floor((currentTime - previousTime) / (24 * 60 * 60 * 1000));
}
