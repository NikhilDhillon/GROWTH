import { Exercise, ExerciseScorePoint, MuscleGroup, MuscleScorePoint, MuscleStrengthConfig, MuscleSummary, TrendStatus, WorkoutSet } from "@/types";
import { muscles } from "@/utils/theme";

export function calculateEstimated1RM(weight: number, reps: number) {
  return weight * (1 + reps / 30);
}

export function getRepQualityMultiplier(reps: number) {
  if (reps <= 5) return 1;
  if (reps <= 8) return 0.97;
  if (reps <= 12) return 0.93;
  return 0.88;
}

export function getSetImportanceWeight(setNumber: number) {
  const weights = [1, 0.9, 0.82, 0.75, 0.69];
  if (setNumber <= weights.length) return weights[Math.max(setNumber, 1) - 1];
  return Math.max(0.25, 0.69 - (setNumber - 5) * 0.06);
}

export function calculateSetScore(input: { weight: number; reps: number }) {
  return calculateEstimated1RM(input.weight, input.reps) * getRepQualityMultiplier(input.reps);
}

export function calculateWeightedContribution(input: { weight: number; reps: number; setNumber: number }) {
  return calculateSetScore(input) * getSetImportanceWeight(input.setNumber);
}

export function calculateExerciseScore(sets: Pick<WorkoutSet, "weight" | "reps" | "set_number">[]) {
  const orderedSets = [...sets]
    .sort((a, b) => a.set_number - b.set_number)
    .filter((set) => set.reps > 0 && set.weight >= 0);

  if (!orderedSets.length) return 0;

  const weightedSetScore = orderedSets.reduce((total, set, index) => {
    const setNumber = set.set_number || index + 1;
    return total + calculateWeightedContribution({ weight: set.weight, reps: set.reps, setNumber });
  }, 0);

  return weightedSetScore / Math.sqrt(orderedSets.length);
}

export function calculateNormalizedExerciseScore(currentScore: number, baselineScore: number) {
  if (baselineScore <= 0) return 1;
  return currentScore / baselineScore;
}

export function calculateMuscleStrengthScore(scores: { normalizedScore: number; weightFactor: number }[]) {
  const usableScores = scores.filter((score) => score.weightFactor > 0);
  if (!usableScores.length) return 0;
  const totalWeight = usableScores.reduce((total, score) => total + score.weightFactor, 0);
  return usableScores.reduce((total, score) => total + score.normalizedScore * score.weightFactor, 0) / totalWeight;
}

export function calculateTrendDirection(percentChange: number): TrendStatus {
  if (percentChange > 2) return "Increasing";
  if (percentChange < -2) return "Decreasing";
  return "Stable";
}

export function buildExerciseScorePoints(exercises: Exercise[], sets: WorkoutSet[]) {
  const byExerciseSession = new Map<string, WorkoutSet[]>();

  for (const set of sets) {
    const key = `${set.exercise_id}:${set.session_id}`;
    byExerciseSession.set(key, [...(byExerciseSession.get(key) ?? []), set]);
  }

  return [...byExerciseSession.entries()]
    .map(([key, groupedSets]) => {
      const [exerciseIdRaw, sessionIdRaw] = key.split(":");
      const exerciseId = Number(exerciseIdRaw);
      const sessionId = Number(sessionIdRaw);
      const date = groupedSets[0]?.created_at.slice(0, 10) ?? "";
      const exercise = exercises.find((item) => item.id === exerciseId);
      const topSet = Math.max(...groupedSets.map((set) => calculateEstimated1RM(set.weight, set.reps)));

      return {
        exerciseId,
        sessionId,
        exerciseName: exercise?.name ?? "Exercise",
        date,
        score: calculateExerciseScore(groupedSets),
        volume: groupedSets.reduce((total, set) => total + set.weight * set.reps, 0),
        topSet
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId);
}

export function baselineForExercise(points: ExerciseScorePoint[], exerciseId: number, currentDate: string) {
  const current = new Date(`${currentDate}T00:00:00`).getTime();
  const windowStart = current - 30 * 24 * 60 * 60 * 1000;
  const candidates = points.filter((point) => {
    const time = new Date(`${point.date}T00:00:00`).getTime();
    return point.exerciseId === exerciseId && time < current && time >= windowStart;
  });

  const fallback = points.filter((point) => point.exerciseId === exerciseId && point.date < currentDate);
  const selected = candidates.length ? candidates : fallback;
  if (!selected.length) return points.find((point) => point.exerciseId === exerciseId)?.score ?? 1;
  return selected.reduce((total, point) => total + point.score, 0) / selected.length;
}

export function buildMuscleScorePoints(exercises: Exercise[], configs: MuscleStrengthConfig[], exercisePoints: ExerciseScorePoint[]) {
  const dates = [...new Set(exercisePoints.map((point) => point.date))].sort();
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
          const point = exercisePoints.find((item) => item.exerciseId === input.exerciseId && item.date === date);
          const exercise = exercises.find((item) => item.id === input.exerciseId);
          if (!point || !exercise) return null;
          const baseline = baselineForExercise(exercisePoints, input.exerciseId, date);
          return {
            normalizedScore: calculateNormalizedExerciseScore(point.score, baseline),
            weight: input.weightFactor
          };
        })
        .filter((item): item is { normalizedScore: number; weight: number } => Boolean(item));

      if (weightedScores.length) {
        const score = calculateMuscleStrengthScore(
          weightedScores.map((item) => ({ normalizedScore: item.normalizedScore, weightFactor: item.weight }))
        );
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
      score: current || 1,
      percentChange,
      trend: calculateTrendDirection(percentChange),
      contributors: contributors.length ? contributors : fallbackContributors
    };
  });
}

function averageTail(points: MuscleScorePoint[], count: number) {
  const selected = points.slice(-count);
  if (!selected.length) return 1;
  return selected.reduce((total, point) => total + point.score, 0) / selected.length;
}

function averageWindowBeforeTail(points: MuscleScorePoint[], count: number) {
  const selected = points.slice(-count * 2, -count);
  if (!selected.length) return averageTail(points, count);
  return selected.reduce((total, point) => total + point.score, 0) / selected.length;
}
