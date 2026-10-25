import { catalogExercises, ExerciseLoadType, getExerciseLoadType, isBodyweightLoadType } from "@/constants/exercises";
import { getBodyweightEstimateForDate } from "@/services/body/bodyWeightService";
import { getScoringEligibility } from "@/domain/observations";
import { BodyWeightLog, Exercise, ExerciseScorePoint, MuscleGroup, MuscleScoreCoverage, MuscleScorePoint, MuscleStrengthConfig, WorkoutSession, WorkoutSet } from "@/types";
import { muscles } from "@/utils/theme";
import { todayIso } from "@/utils/date";
import { assertCalendarDate, daysBetween, isCalendarDate } from "@/domain/calendar";

const strengthWeight = 0.45;
const volumeWeight = 0.35;
const resistanceWeight = 0.2;
const maximumEstimated1RMReps = 10;
export const growthMetricVersion = "performance-points.first-eligible.v1";
export const trainingMaximumAgeCalendarDays = 30;

type ScoreableSet = Pick<WorkoutSet, "weight" | "reps" | "set_number"> & Pick<Partial<WorkoutSet>, "is_warmup">;
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
  const orderedSets = [...sets].filter((set) => !set.is_warmup).sort((a, b) => a.set_number - b.set_number);
  const loadType = loadContext.loadType ?? "external";
  if (!hasUnambiguousWorkingSetOrder(orderedSets)) return null;
  if (!getScoringEligibility(orderedSets.map((set) => ({ reps: set.reps, weight: set.weight, isWarmup: false })), { loadType, bodyWeightLb: loadContext.bodyWeight }).eligible) return null;
  const effectiveSets = orderedSets.map((set) => ({
    ...set,
    weight: effectiveWeight(set.weight, loadType, loadContext.bodyWeight)
  }));
  if (effectiveSets.some((set) => !isScoreableSet(set))) return null;

  const estimated1RMs = effectiveSets.map((set) => calculateEstimated1RM(set.weight, set.reps));
  const estimated1RM = Math.max(...estimated1RMs);
  const failureVolume = effectiveSets.reduce((total, set) => total + set.weight * set.reps, 0);
  const fatigueResistance = Math.min(1, estimated1RMs.at(-1)! / estimated1RMs[0]);
  if ([estimated1RM, failureVolume, fatigueResistance].some((value) => !Number.isFinite(value) || value <= 0)) return null;
  if (reference && [reference.estimated1RM, reference.failureVolume, reference.fatigueResistance].some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const normalizedStrength = reference ? estimated1RM / reference.estimated1RM : 1;
  const normalizedVolume = reference ? failureVolume / reference.failureVolume : 1;
  const normalizedResistance = reference ? fatigueResistance / reference.fatigueResistance : 1;
  const performancePoints = 100 * (
    strengthWeight * normalizedStrength +
    volumeWeight * normalizedVolume +
    resistanceWeight * normalizedResistance
  );

  if (!Number.isFinite(performancePoints) || performancePoints <= 0) return null;
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

export function findStrengthReference(points: ExerciseScorePoint[]) {
  return points.reduce<ExerciseScorePoint | undefined>((best, point) => {
    if (!best || compareReference(point, best) > 0) return point;
    return best;
  }, undefined);
}

/** Session feedback uses only history available in the selected equipment context. */
export function performanceHistoryForContext(points: ExerciseScorePoint[], input: {
  exerciseId: number;
  asOfDate: string;
  loadType: ExerciseLoadType;
  machineProfileId?: string | null;
  sessions: WorkoutSession[];
}) {
  if (!isCalendarDate(input.asOfDate)) return [];
  const sessions = new Map(input.sessions.map((session) => [session.id, session]));
  return points.filter((point) => {
    if (point.exerciseId !== input.exerciseId || !isCalendarDate(point.date) || point.date > input.asOfDate) return false;
    const session = sessions.get(point.sessionId);
    if (!session || session.workout_date !== point.date) return false;
    return input.loadType !== "machine_stack" || (session.machine_profile_id ?? null) === (input.machineProfileId ?? null);
  });
}

export type GrowthScoringExclusion = { sessionId: number; exerciseId: number; date: string | null; reason: string };

export function buildExerciseScorePoints(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[], bodyWeightLogs: BodyWeightLog[] = []) {
  return buildExerciseScoreReport(exercises, sessions, sets, bodyWeightLogs).points;
}

/** All metrics derive from existing observations; neither a timestamp fallback
 * nor another machine context can establish an eligible baseline. */
export function buildExerciseScoreReport(exercises: Exercise[], sessions: WorkoutSession[], sets: WorkoutSet[], bodyWeightLogs: BodyWeightLog[] = []) {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const duplicateSessionIds = new Set(sessions.filter((session, index) => sessions.findIndex((other) => other.id === session.id) !== index).map((session) => session.id));
  const grouped = new Map<number, WorkoutSet[]>();
  const setIdentityCounts = new Map<number, number>();
  for (const set of sets) {
    grouped.set(set.session_id, [...(grouped.get(set.session_id) ?? []), set]);
    setIdentityCounts.set(set.id, (setIdentityCounts.get(set.id) ?? 0) + 1);
  }
  const exclusions: GrowthScoringExclusion[] = [];
  const entries: Array<{ exercise: Exercise; session: WorkoutSession; sets: WorkoutSet[] }> = [];
  for (const [sessionId, observedSets] of grouped) {
    const session = sessionById.get(sessionId);
    const exerciseIds = [...new Set(observedSets.map((set) => set.exercise_id))];
    const exercise = exerciseById.get(exerciseIds[0]);
    const exclusion = (reason: string) => exclusions.push({ sessionId, exerciseId: exerciseIds[0], date: session && isCalendarDate(session.workout_date) ? session.workout_date : null, reason });
    if (!session || duplicateSessionIds.has(sessionId)) { exclusion("The exercise entry identity is missing or ambiguous."); continue; }
    if (!isCalendarDate(session.workout_date)) { exclusion("The exercise entry has no valid recorded calendar date."); continue; }
    if (!exercise || exerciseIds.length !== 1) { exclusion("The recorded exercise identity is missing or inconsistent."); continue; }
    const workingSets = observedSets.filter((set) => !set.is_warmup);
    if (workingSets.some((set) => !Number.isSafeInteger(set.id) || set.id <= 0 || setIdentityCounts.get(set.id) !== 1)
      || !hasUnambiguousWorkingSetOrder(workingSets)) {
      exclusion("The working set identity or recorded order is missing or ambiguous."); continue;
    }
    if (!catalogExercises.some((catalogExercise) => catalogExercise.name === exercise.name)) {
      exclusion("This exercise has no explicitly defined load semantics. Its recorded observations are preserved without an inferred score."); continue;
    }
    entries.push({ exercise, session, sets: observedSets });
  }
  entries.sort((left, right) => left.session.workout_date.localeCompare(right.session.workout_date) || left.session.id - right.session.id);
  const output: ExerciseScorePoint[] = [];
  const baselines = new Map<string, ExerciseScorePoint>();
  for (const entry of entries) {
    const { exercise, session, sets: observedSets } = entry;
    const loadType = getExerciseLoadType(exercise);
    const bodyWeight = isBodyweightLoadType(loadType) ? getBodyweightEstimateForDate(session.workout_date, bodyWeightLogs) : null;
    const eligibility = getScoringEligibility(observedSets.map((set) => ({ reps: set.reps, weight: set.weight, isWarmup: Boolean(set.is_warmup) })),
      { loadType, bodyWeightLb: bodyWeight?.status === "available" ? bodyWeight.weightLb : undefined });
    if (!eligibility.eligible) {
      const reason = bodyWeight?.status === "unavailable" ? bodyWeight.reason === "stale_prior_observation"
        ? "Bodyweight context is older than 14 calendar days." : "A bodyweight observation on or before this date is required." : eligibility.reason!;
      exclusions.push({ sessionId: session.id, exerciseId: exercise.id, date: session.workout_date, reason }); continue;
    }
    const machineProfileId = loadType === "machine_stack" ? session.machine_profile_id ?? null : null;
    // Untagged machine entries share one context per exercise, so a lifter who never
    // tags machines still gets a trend. A tag splits that machine into its own context.
    const comparability = "comparable" as const;
    const comparisonKey = loadType === "machine_stack"
      ? machineProfileId ? `exercise:${exercise.id}:machine:${machineProfileId}` : `exercise:${exercise.id}:machine:untagged`
      : `exercise:${exercise.id}:load:${loadType}`;
    const baseline = baselines.get(comparisonKey);
    const metrics = calculateSessionPerformance(observedSets, baseline, { loadType, bodyWeight: bodyWeight?.status === "available" ? bodyWeight.weightLb : undefined });
    if (!metrics) { exclusions.push({ sessionId: session.id, exerciseId: exercise.id, date: session.workout_date, reason: "The observed metrics cannot establish finite positive comparison values." }); continue; }
    const date = session.workout_date;
    const contextPoints = output.filter((point) => point.comparisonKey === comparisonKey);
    const contextStart = baseline?.date ?? date;
    const range = { startDate: contextStart, endDate: date };
    const contextExclusions = [
      ...exclusions.filter((issue) => issue.exerciseId === exercise.id && (issue.date === null || issue.date <= date)).map((issue) => ({ observationId: issue.sessionId, reason: issue.reason })),
      ...output.filter((point) => point.exerciseId === exercise.id && point.comparisonKey !== comparisonKey).map((point) => ({ observationId: point.sessionId, reason: "A different or unverified equipment context cannot establish this comparison." }))
    ];
    const point: ExerciseScorePoint = {
      exerciseId: exercise.id, exerciseName: exercise.name, sessionId: session.id, date, ...metrics,
      score: metrics.performancePoints, volume: metrics.failureVolume, topSet: metrics.estimated1RM,
      workingSets: observedSets.filter((set) => !set.is_warmup).sort((left, right) => left.set_number - right.set_number).map((set) => ({ weight: set.weight, reps: set.reps })),
      metricVersion: growthMetricVersion, comparisonKey, baselineSessionId: baseline?.sessionId ?? session.id, comparability, machineProfileId, loadType,
      bodyWeightEstimate: bodyWeight?.status === "available" ? { observationId: bodyWeight.observationId, observationDate: bodyWeight.observationDate,
        ageCalendarDays: bodyWeight.ageCalendarDays, weightLb: bodyWeight.weightLb, isEstimated: bodyWeight.isEstimated } : null,
      comparisonContext: {
        contractVersion: "growth-comparison.v1", metric: { id: "performance-points", version: growthMetricVersion, unit: "points", preferredDirection: "increase" },
        baseline: { kind: "first_eligible", range }, range,
        equipment: loadType === "machine_stack" ? machineProfileId ? { kind: "machine_profile", machineProfileId } : { kind: "unknown", reason: "No machine tag. Untagged entries for this exercise are compared with each other." }
          : { kind: "non_machine", loadType },
        freshness: { asOfDate: date, latestObservationDate: date, staleAfterCalendarDays: trainingMaximumAgeCalendarDays },
        coverage: { availableObservationCount: contextPoints.length + 1 + contextExclusions.length, eligibleObservationCount: contextPoints.length + 1,
          includedObservationIds: [...contextPoints.map((point) => point.sessionId), session.id], exclusions: contextExclusions }
      }
    };
    output.push(point);
    if (!baseline) baselines.set(comparisonKey, point);
  }
  return { points: output, exclusions };
}

/** A report fixes membership and each member's first comparable context before
 * looking at any daily value. New exercises/equipment never change its meaning. */
export function buildMuscleScorePoints(exercises: Exercise[], configs: MuscleStrengthConfig[], exercisePoints: ExerciseScorePoint[], asOfDate = todayIso()) {
  assertCalendarDate(asOfDate);
  const ordered = exercisePoints.filter((point) => isCalendarDate(point.date) && point.date <= asOfDate)
    .sort((left, right) => left.date.localeCompare(right.date) || left.sessionId - right.sessionId);
  const eligible = ordered.filter((point) => point.metricVersion === growthMetricVersion && point.comparability === "comparable" && Boolean(point.comparisonKey) && Number.isFinite(point.score) && point.score > 0);
  const dates = [...new Set([...ordered.map((point) => point.date), asOfDate])].sort();
  const output: MuscleScorePoint[] = [];
  for (const muscle of muscles) {
    const configured = configs.filter((config) => config.muscle_group === muscle);
    const candidates = exercises.filter((exercise) => exercise.primary_muscle === muscle);
    const firstObservedDate = eligible.find((point) => candidates.some((exercise) => exercise.id === point.exerciseId))?.date ?? null;
    const inputs = configured.length ? configured.filter((config) => Number.isFinite(config.weight_factor) && config.weight_factor > 0)
      .map((config) => ({ exerciseId: config.exercise_id, weightFactor: config.weight_factor }))
      : candidates.filter((exercise) => eligible.some((point) => point.exerciseId === exercise.id && point.date === firstObservedDate))
        .map((exercise) => ({ exerciseId: exercise.id, weightFactor: 1 }));
    if (!inputs.length) continue;
    const members = inputs.map((input) => ({ ...input, comparisonKey: eligible.find((point) => point.exerciseId === input.exerciseId)?.comparisonKey ?? null }));
    const cohortStartDate = configured.length ? members.reduce<string | null>((first, member) => {
      const date = eligible.find((point) => point.comparisonKey === member.comparisonKey)?.date;
      return date && (first === null || date < first) ? date : first;
    }, null) : firstObservedDate;
    const cohortKey = `${muscle}:${configured.length ? "configured" : "first_observed"}:${members.map((member) => `${member.exerciseId}=${member.comparisonKey ?? "missing"}@${member.weightFactor}`).join("|")}`;
    for (const date of dates) {
      const coverage: MuscleScoreCoverage = { source: configured.length ? "configured" : "first_observed", cohortStartDate, members,
        includedSessionIds: [], includedObservations: [], missingExerciseIds: [], staleExerciseIds: [], exclusions: [],
        totalWeight: members.reduce((total, member) => total + member.weightFactor, 0), availableWeight: 0, complete: false };
      let weightedScore = 0;
      for (const member of members) {
        const point = eligible.filter((candidate) => candidate.comparisonKey === member.comparisonKey && candidate.date <= date).at(-1);
        if (!point) { coverage.missingExerciseIds.push(member.exerciseId); continue; }
        if (daysBetween(point.date, date) > trainingMaximumAgeCalendarDays) { coverage.staleExerciseIds.push(member.exerciseId); continue; }
        coverage.includedSessionIds.push(point.sessionId);
        coverage.includedObservations.push({ exerciseId: member.exerciseId, sessionId: point.sessionId, date: point.date, comparisonKey: point.comparisonKey!, score: point.score });
        coverage.availableWeight += member.weightFactor;
        weightedScore += point.score * member.weightFactor;
      }
      coverage.exclusions = ordered.filter((point) => point.date <= date && (candidates.some((exercise) => exercise.id === point.exerciseId) || members.some((member) => member.exerciseId === point.exerciseId))
        && !members.some((member) => member.exerciseId === point.exerciseId && member.comparisonKey === point.comparisonKey))
        .map((point) => ({ sessionId: point.sessionId, reason: point.comparability === "self_context" ? "The machine equipment is unverified." : "This observation is outside the fixed exercise/equipment cohort." }));
      coverage.complete = coverage.missingExerciseIds.length === 0 && coverage.staleExerciseIds.length === 0;
      const score = coverage.complete ? weightedScore / coverage.totalWeight : null;
      output.push({ muscle: muscle as MuscleGroup, date, score: score !== null && Number.isFinite(score) ? score : null,
        metricVersion: growthMetricVersion, cohortKey, coverage });
    }
  }
  return output;
}

function isScoreableSet(set: ScoreableSet) {
  return Number.isFinite(set.weight) && set.weight > 0 &&
    Number.isInteger(set.reps) && set.reps >= 1;
}

function hasUnambiguousWorkingSetOrder(sets: ScoreableSet[]) {
  return sets.every((set) => Number.isSafeInteger(set.set_number) && set.set_number > 0)
    && new Set(sets.map((set) => set.set_number)).size === sets.length;
}

function effectiveWeight(weight: number, loadType: ExerciseLoadType, bodyWeight?: number) {
  if (!isBodyweightLoadType(loadType)) return weight;
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
