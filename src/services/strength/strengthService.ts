import { ExerciseLoadType, getExerciseLoadType } from "@/constants/exercises";
import { getClosestBodyweightForDate } from "@/services/analytics/bulkAnalyticsService";
import { BodyWeightLog, Exercise, ExerciseScorePoint, MuscleGroup, MuscleScorePoint, MuscleStrengthConfig, MuscleSummary, TrendStatus, WorkoutSession, WorkoutSet } from "@/types";
import { muscles } from "@/utils/theme";

const strengthWeight = 0.45;
const volumeWeight = 0.35;
const resistanceWeight = 0.2;
const maximumEstimated1RMReps = 10;

type ScoreableSet = Pick<WorkoutSet, "weight" | "reps" | "set_number">;
type PerformanceReference = Pick<ExerciseScorePoint, "estimated1RM" | "failureVolume" | "fatigueResistance">;
type LoadContext = { loadType?: ExerciseLoadType; bodyWeight?: number };

export type SessionPerformance = {
  performancePoints: number;
  estimated1RM: number;
  failureVolume: number;
  fatigueResistance: number;
  normalizedStrength: number;
  normalizedVolume: number;
  normalizedResistance: number;
};

export function calculateEstimated1RM(weight: number, reps: number) {
  return weight * (1 + Math.min(reps, maximumEstimated1RMReps) / 30);
}

export function calculateSessionPerformance(sets: ScoreableSet[], reference?: PerformanceReference, loadContext: LoadContext = {}): SessionPerformance | null {
  const orderedSets = [...sets].sort((a, b) => a.set_number - b.set_number);
  const loadType = loadContext.loadType ?? "external";
  if (orderedSets.length < 2 || orderedSets.some((set) => !isValidEnteredSet(set, loadType))) return null;
  const effectiveSets = orderedSets.map((set) => ({
    ...set,
    weight: effectiveWeight(set.weight, loadType, loadContext.bodyWeight)
  }));
  if (effectiveSets.some((set) => !isScoreableSet(set))) return null;

  const estimated1RMs = effectiveSets.map((set) => calculateEstimated1RM(set.weight, set.reps));
  const estimated1RM = Math.max(...estimated1RMs);
  const failureVolume = effectiveSets.reduce((total, set) => total + set.weight * set.reps, 0);
  const fatigueResistance = Math.min(1, estimated1RMs.at(-1)! / estimated1RMs[0]);
  const normalizedStrength = reference ? estimated1RM / reference.estimated1RM : 1;
  const normalizedVolume = reference ? failureVolume / reference.failureVolume : 1;
  const normalizedResistance = reference ? fatigueResistance / reference.fatigueResistance : 1;
  const performancePoints = 100 * (
    strengthWeight * normalizedStrength +
    volumeWeight * normalizedVolume +
    resistanceWeight * normalizedResistance
  );

  return {
    performancePoints,
    estimated1RM,
    failureVolume,
    fatigueResistance,
    normalizedStrength,
    normalizedVolume,
    normalizedResistance
  };
}

export function calculateExerciseScore(sets: ScoreableSet[]) {
  return calculateSessionPerformance(sets)?.performancePoints ?? 0;
}

export function calculateTrendDirection(percentChange: number): TrendStatus {
  if (percentChange > 2) return "Increasing";
  if (percentChange < -2) return "Decreasing";
  return "Stable";
}

export function findStrengthReference(points: ExerciseScorePoint[]) {
  return points.reduce<ExerciseScorePoint | undefined>((best, point) => {
    if (!best || compareReference(point, best) > 0) return point;
    return best;
  }, undefined);
}

export function buildExerciseScorePoints(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[], bodyWeightLogs: BodyWeightLog[] = []) {
  const byExerciseSession = new Map<string, WorkoutSet[]>();
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  for (const set of sets) {
    const key = `${set.exercise_id}:${set.session_id}`;
    byExerciseSession.set(key, [...(byExerciseSession.get(key) ?? []), set]);
  }

  const sessionsToScore = [...byExerciseSession.entries()]
    .map(([key, groupedSets]) => {
      const [exerciseIdRaw, sessionIdRaw] = key.split(":");
      const exerciseId = Number(exerciseIdRaw);
      const sessionId = Number(sessionIdRaw);
      const session = sessionById.get(sessionId);
      return {
        exerciseId,
        sessionId,
        exerciseName: exercises.find((item) => item.id === exerciseId)?.name ?? "Exercise",
        date: session?.workout_date ?? groupedSets[0]?.created_at.slice(0, 10) ?? "",
        sets: groupedSets
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);

  const output: ExerciseScorePoint[] = [];
  for (const session of sessionsToScore) {
    const loadType = getExerciseLoadType(session.exerciseName);
    const bodyWeight = loadType === "external" ? undefined : getClosestBodyweightForDate(session.date, bodyWeightLogs)?.weight;
    const reference = findStrengthReference(output.filter((point) => point.exerciseId === session.exerciseId));
    const metrics = calculateSessionPerformance(session.sets, reference, { loadType, bodyWeight });
    if (!metrics) continue;
    output.push({
      exerciseId: session.exerciseId,
      sessionId: session.sessionId,
      exerciseName: session.exerciseName,
      date: session.date,
      ...metrics,
      score: metrics.performancePoints,
      volume: metrics.failureVolume,
      topSet: metrics.estimated1RM
    });
  }

  return output;
}

export function buildMuscleScorePoints(exercises: Exercise[], configs: MuscleStrengthConfig[], exercisePoints: ExerciseScorePoint[]) {
  const dates = [...new Set(exercisePoints.map((point) => point.date))].sort();
  const orderedPoints = [...exercisePoints].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
  const output: MuscleScorePoint[] = [];

  for (const muscle of muscles) {
    const muscleConfigs = configs.filter((config) => config.muscle_group === muscle);
    const scoringInputs = muscleConfigs.length
      ? muscleConfigs.map((config) => ({ exerciseId: config.exercise_id, weightFactor: config.weight_factor }))
      : exercises
          .filter((exercise) => exercise.is_strength_exercise && exercise.primary_muscle === muscle)
          .map((exercise) => ({ exerciseId: exercise.id, weightFactor: 1 }));

    for (const date of dates) {
      const weightedScores = scoringInputs
        .map((input) => {
          const point = orderedPoints
            .filter((item) => item.exerciseId === input.exerciseId && item.date <= date)
            .at(-1);
          if (!point || input.weightFactor <= 0) return null;
          return { score: point.performancePoints, weight: input.weightFactor };
        })
        .filter((item): item is { score: number; weight: number } => Boolean(item));

      if (weightedScores.length) {
        const totalWeight = weightedScores.reduce((total, point) => total + point.weight, 0);
        const score = weightedScores.reduce((total, point) => total + point.score * point.weight, 0) / totalWeight;
        output.push({ muscle: muscle as MuscleGroup, date, score });
      }
    }
  }

  return output;
}

export function trendFromChange(percentChange: number): TrendStatus {
  return calculateTrendDirection(percentChange);
}

export function summarizeMuscles(exercises: Exercise[], configs: MuscleStrengthConfig[], points: MuscleScorePoint[]): MuscleSummary[] {
  return muscles.map((muscle) => {
    const musclePoints = points.filter((point) => point.muscle === muscle).sort((a, b) => a.date.localeCompare(b.date));
    const current = averageTail(musclePoints, 14);
    const previous = averageWindowBeforeTail(musclePoints, 14);
    const percentChange = previous > 0 ? ((current - previous) / previous) * 100 : 0;
    const contributors = configs
      .filter((config) => config.muscle_group === muscle)
      .map((config) => exercises.find((exercise) => exercise.id === config.exercise_id)?.name)
      .filter((name): name is string => Boolean(name));
    const fallbackContributors = exercises
      .filter((exercise) => exercise.is_strength_exercise && exercise.primary_muscle === muscle)
      .map((exercise) => exercise.name);

    return {
      muscle,
      score: current,
      percentChange,
      trend: calculateTrendDirection(percentChange),
      contributors: contributors.length ? contributors : fallbackContributors
    };
  });
}

function isScoreableSet(set: ScoreableSet) {
  return Number.isFinite(set.weight) && set.weight > 0 &&
    Number.isInteger(set.reps) && set.reps >= 1;
}

function isValidEnteredSet(set: ScoreableSet, loadType: ExerciseLoadType) {
  return Number.isFinite(set.weight) && (loadType === "external" ? set.weight > 0 : set.weight >= 0) &&
    Number.isInteger(set.reps) && set.reps >= 1;
}

function effectiveWeight(weight: number, loadType: ExerciseLoadType, bodyWeight?: number) {
  if (loadType === "external") return weight;
  if (!Number.isFinite(bodyWeight) || !bodyWeight) return 0;
  return loadType === "bodyweight_plus_load" ? bodyWeight + weight : bodyWeight - weight;
}

function compareReference(a: ExerciseScorePoint, b: ExerciseScorePoint) {
  return a.estimated1RM - b.estimated1RM ||
    a.failureVolume - b.failureVolume ||
    a.fatigueResistance - b.fatigueResistance ||
    a.date.localeCompare(b.date) ||
    a.sessionId - b.sessionId;
}

function averageTail(points: MuscleScorePoint[], count: number) {
  const selected = points.slice(-count);
  if (!selected.length) return 0;
  return selected.reduce((total, point) => total + point.score, 0) / selected.length;
}

function averageWindowBeforeTail(points: MuscleScorePoint[], count: number) {
  const selected = points.slice(-count * 2, -count);
  if (!selected.length) return averageTail(points, count);
  return selected.reduce((total, point) => total + point.score, 0) / selected.length;
}
