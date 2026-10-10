import { describe, expect, it } from "vitest";
import { buildExerciseScorePoints, buildExerciseScoreReport, buildMuscleScorePoints, calculateSessionPerformance, findStrengthReference, growthMetricVersion } from "./strengthService";
import type { BodyWeightLog, Exercise, MuscleStrengthConfig, WorkoutSession, WorkoutSet } from "@/types";
const exercise = (id = 1, name = "Barbell Bench Press"): Exercise => ({ id, name, primary_muscle: "Chest", is_strength_exercise: 1, created_at: "2026-01-01T12:00:00Z" });
function entry(id: number, date: string, exerciseId = 1, load = 100, machineProfileId: string | null = null) {
  return { session: { id, workout_date: date, machine_profile_id: machineProfileId, created_at: `${date}T12:00:00Z` } as WorkoutSession,
    sets: [1, 2].map((set_number) => ({ id: id * 10 + set_number, exercise_id: exerciseId, session_id: id, set_number, reps: 5, weight: load, is_warmup: 0, created_at: `${date}T12:00:00Z` })) as WorkoutSet[] };
}
function points(exercises: Exercise[], entries: ReturnType<typeof entry>[], body: BodyWeightLog[] = []) {
  return buildExerciseScorePoints(exercises, entries.map((e) => e.session), entries.flatMap((e) => e.sets), body);
}
const weight = (date: string, weight = 170, id = 1): BodyWeightLog => ({ id, weight, unit: "lb", logged_date: date, logged_at: `${date}T12:00:00Z`, created_at: `${date}T12:00:00Z` });
const config = (id: number, factor = 1): MuscleStrengthConfig => ({ id, exercise_id: id, muscle_group: "Chest", weight_factor: factor });

describe("fixed first-eligible growth points", () => {
  it("preserves cumulative improvement when a later session exceeds a previous personal best", () => {
    const result = points([exercise()], [entry(1, "2026-01-01", 1, 100), entry(2, "2026-01-02", 1, 110), entry(3, "2026-01-03", 1, 121)]);
    [100, 108, 116.8].forEach((expected, index) => expect(result[index].score).toBeCloseTo(expected));
    expect(result.every((p) => p.baselineSessionId === 1 && p.metricVersion === growthMetricVersion)).toBe(true);
    expect(result[2].comparisonContext?.baseline.kind).toBe("first_eligible");
    expect(result[2].comparisonContext?.coverage.includedObservationIds).toEqual([1, 2, 3]);
  });
  it("retains absolute estimated-load, volume and resistance alongside normalized points", () => {
    const result = points([exercise()], [entry(1, "2026-01-01")])[0];
    expect(result.estimated1RM).toBeCloseTo(100 * (1 + 5 / 30));
    expect(result.failureVolume).toBe(1000);expect(result.fatigueResistance).toBe(1);
  });
  it("does not let future observations change an earlier point or baseline", () => {
    const initial = [entry(1, "2026-01-01"), entry(2, "2026-01-02", 1, 110)];
    expect(points([exercise()], [...initial, entry(3, "2026-12-01", 1, 1000)]).slice(0, 2)).toEqual(points([exercise()], initial));
  });
  it("orders observations deterministically without mutating caller arrays", () => {
    const entries = [entry(3, "2026-01-03", 1, 121), entry(1, "2026-01-01"), entry(2, "2026-01-02", 1, 110)];
    expect(points([exercise()], entries).map((p) => p.baselineSessionId)).toEqual([1, 1, 1]);expect(entries.map((e) => e.session.id)).toEqual([3, 1, 2]);
  });
  it("starts from the first eligible observation rather than an incomplete capture", () => {
    const first = entry(1, "2026-01-01");first.sets = first.sets.slice(0, 1);
    const result = points([exercise()], [first, entry(2, "2026-01-02"), entry(3, "2026-01-03", 1, 110)]);
    expect(result.map((p) => p.baselineSessionId)).toEqual([2, 2]);expect(result[0].score).toBe(100);
    expect(result[1].comparisonContext?.coverage.exclusions).toEqual([expect.objectContaining({ observationId: 1, reason: expect.stringMatching(/two working sets/) })]);
  });
  it("excludes warmups from all calculated metrics", () => {
    const record = entry(1, "2026-01-01");record.sets.unshift({ ...record.sets[0], id: 100, set_number: 0, weight: 9999, is_warmup: 1 });
    expect(points([exercise()], [record])[0].failureVolume).toBe(1000);expect(points([exercise()], [record])[0].workingSets).toHaveLength(2);
  });
  it("never manufactures a workout date for orphan observations", () => {
    const record = entry(1, "2026-01-01");const result = buildExerciseScoreReport([exercise()], [], record.sets);
    expect(result.points).toEqual([]);expect(result.exclusions).toEqual([expect.objectContaining({ sessionId: 1, date: null, reason: expect.stringMatching(/identity/) })]);
  });
  it("rejects invalid dates, missing exercise identities and mixed-exercise entries", () => {
    const invalid = entry(1, "2026-02-30");const missing = entry(2, "2026-01-02", 99);const mixed = entry(3, "2026-01-03");mixed.sets.push({ ...mixed.sets[0], exercise_id: 2 });
    const result = buildExerciseScoreReport([exercise()], [invalid.session, missing.session, mixed.session], [...invalid.sets, ...missing.sets, ...mixed.sets]);
    expect(result.points).toEqual([]);expect(result.exclusions).toHaveLength(3);
  });
  it("withholds a whole metric when one working observation is invalid", () => {
    const bad = entry(1, "2026-01-01");bad.sets[1].weight = Number.NaN;expect(points([exercise()], [bad])).toEqual([]);
  });
  it("does not count a duplicated working observation twice or let it establish a baseline", () => {
    const duplicated = entry(1, "2026-01-01");duplicated.sets[1].id = duplicated.sets[0].id;
    const next = entry(2, "2026-01-02");
    const result = buildExerciseScoreReport([exercise()], [duplicated.session, next.session], [...duplicated.sets, ...next.sets]);
    expect(result.points.map((point) => point.baselineSessionId)).toEqual([2]);
    expect(result.exclusions).toEqual([expect.objectContaining({ sessionId: 1, reason: expect.stringMatching(/identity.*ambiguous/) })]);
  });
  it("withholds every entry affected by a set identity duplicated across entries", () => {
    const first = entry(1, "2026-01-01");const second = entry(2, "2026-01-02");second.sets[0].id = first.sets[0].id;
    const result = buildExerciseScoreReport([exercise()], [first.session, second.session], [...first.sets, ...second.sets]);
    expect(result.points).toEqual([]);expect(result.exclusions.map((issue) => issue.sessionId)).toEqual([1, 2]);
  });
  it("does not infer the order of working sets when their recorded numbers are duplicated or invalid", () => {
    for (const number of [1, 0, -1, 1.5, Number.NaN]) {
      const bad = entry(1, "2026-01-01");bad.sets[1].set_number = number;
      const result = buildExerciseScoreReport([exercise()], [bad.session], bad.sets);
      expect(result.points).toEqual([]);expect(result.exclusions[0].reason).toMatch(/order.*ambiguous/);
      expect(calculateSessionPerformance(bad.sets)).toBeNull();
    }
  });
  it("allows gaps in positive recorded working-set order without inventing missing observations", () => {
    const recorded = entry(1, "2026-01-01");recorded.sets[0].set_number = 3;recorded.sets[1].set_number = 7;
    expect(points([exercise()], [recorded])[0].failureVolume).toBe(1000);
  });
  it("preserves unknown legacy observations without assuming external-load semantics", () => {
    const legacy = exercise(1, "Bench Press");const recorded = entry(1, "2026-01-01");
    const result = buildExerciseScoreReport([legacy], [recorded.session], recorded.sets);
    expect(result.points).toEqual([]);expect(result.exclusions[0].reason).toMatch(/no explicitly defined load semantics/);
    expect(recorded.sets.map((set) => set.weight)).toEqual([100, 100]);
  });
  it("does not produce infinite points from overflowing metrics or invalid divisors", () => {
    expect(calculateSessionPerformance([{ weight: Number.MAX_VALUE, reps: 10, set_number: 1 }, { weight: Number.MAX_VALUE, reps: 10, set_number: 2 }])).toBeNull();
    expect(calculateSessionPerformance(entry(1, "2026-01-01").sets, { estimated1RM: 0, failureVolume: 1, fatigueResistance: 1 })).toBeNull();
  });
  it("keeps immediate best-session feedback distinct from the fixed growth baseline", () => {
    const result = points([exercise()], [entry(1, "2026-01-01"), entry(2, "2026-01-02", 1, 110)]);
    expect(findStrengthReference(result)?.sessionId).toBe(2);expect(result[1].baselineSessionId).toBe(1);
  });
});

describe("equipment and bodyweight comparison evidence", () => {
  it("gives each tagged machine its own first baseline and compares untagged entries with each other", () => {
    const result = points([exercise(1, "Machine Chest Press")], [entry(1, "2026-01-01", 1, 100, "A"), entry(2, "2026-01-02", 1, 200, "B"), entry(3, "2026-01-03", 1, 110, "A"), entry(4, "2026-01-04", 1, 500), entry(5, "2026-01-05", 1, 600)]);
    expect(result.slice(0, 4).map((p) => p.score)).toEqual([100, 100, 108, 100]);expect(result[4].score).toBeCloseTo(116);
    expect(result.map((p) => p.baselineSessionId)).toEqual([1, 2, 1, 4, 4]);
    expect(result.slice(3).every((p) => p.comparability === "comparable" && p.comparisonContext?.equipment.kind === "unknown")).toBe(true);
    expect(result[3].comparisonKey).toBe(result[4].comparisonKey);
    expect([result[0].comparisonKey, result[1].comparisonKey]).not.toContain(result[3].comparisonKey);
  });
  it("uses explicit prior bodyweight with age/provenance and withholds stale effective loads", () => {
    const result = points([exercise(1, "Pull-Up")], [entry(1, "2026-01-01", 1, 0), entry(2, "2026-01-15", 1, 0), entry(3, "2026-01-16", 1, 0)], [weight("2026-01-01")]);
    expect(result).toHaveLength(2);expect(result[1].bodyWeightEstimate).toEqual({ observationId: 1, observationDate: "2026-01-01", ageCalendarDays: 14, weightLb: 170, isEstimated: true });expect(result[1].estimated1RM).toBeCloseTo(170 * (1 + 5 / 30));
  });
  it("does not infer earlier bodyweight from a future measurement", () => {
    expect(points([exercise(1, "Pull-Up")], [entry(1, "2026-01-01", 1, 0)], [weight("2026-01-02")])).toEqual([]);
  });
  it("treats less assistance as increased effective load within the same context", () => {
    const result = points([exercise(1, "Assisted Dip")], [entry(1, "2026-01-01", 1, 40), entry(2, "2026-01-02", 1, 20)], [weight("2026-01-01")]);
    expect(result[1].score).toBeGreaterThan(100);expect(result[1].estimated1RM).toBeGreaterThan(result[0].estimated1RM);
  });
});

describe("fixed muscle cohorts and truthful coverage", () => {
  it("withholds a configured aggregate when a member has no eligible observation", () => {
    const result = buildMuscleScorePoints([exercise(), exercise(2)], [config(1), config(2)], points([exercise()], [entry(1, "2026-01-01")]), "2026-01-02");
    const latest = result.filter((p) => p.muscle === "Chest").at(-1)!;expect(latest.score).toBeNull();expect(latest.coverage?.missingExerciseIds).toEqual([2]);expect(latest.coverage?.includedSessionIds).toEqual([1]);expect(latest.coverage?.complete).toBe(false);
  });
  it("uses fixed configured weights only when every member is available", () => {
    const exercises = [exercise(), exercise(2)];const scorePoints = points(exercises, [entry(1, "2026-01-01"), entry(2, "2026-01-01", 2), entry(3, "2026-01-02", 1, 110)]);
    const result = buildMuscleScorePoints(exercises, [config(1, 3), config(2, 1)], scorePoints, "2026-01-02").at(-1)!;
    expect(result.score).toBeCloseTo(106);expect(result.coverage?.totalWeight).toBe(4);expect(result.coverage?.complete).toBe(true);expect(result.coverage?.includedObservations.map((p) => p.date)).toEqual(["2026-01-02", "2026-01-01"]);
  });
  it("makes 30 days inclusive and shows stale coverage without any new workouts", () => {
    const scorePoints = points([exercise()], [entry(1, "2026-01-01")]);
    expect(buildMuscleScorePoints([exercise()], [], scorePoints, "2026-01-31").at(-1)?.score).toBe(100);
    const stale = buildMuscleScorePoints([exercise()], [], scorePoints, "2026-02-01").at(-1)!;expect(stale.date).toBe("2026-02-01");expect(stale.score).toBeNull();expect(stale.coverage?.staleExerciseIds).toEqual([1]);
  });
  it("does not silently drop one stale member while another has fresh evidence", () => {
    const exercises = [exercise(), exercise(2)];const scorePoints = points(exercises, [entry(1, "2026-01-01"), entry(2, "2026-01-01", 2), entry(3, "2026-01-30", 2, 110)]);
    const result = buildMuscleScorePoints(exercises, [config(1), config(2)], scorePoints, "2026-02-01").at(-1)!;expect(result.score).toBeNull();expect(result.coverage?.staleExerciseIds).toEqual([1]);expect(result.coverage?.includedSessionIds).toEqual([3]);
  });
  it("keeps first-day fallback membership fixed when a new exercise appears later", () => {
    const exercises = [exercise(), exercise(2)];const scorePoints = points(exercises, [entry(1, "2026-01-01"), entry(2, "2026-01-02", 2, 500)]);
    const result = buildMuscleScorePoints(exercises, [], scorePoints, "2026-01-02").at(-1)!;expect(result.score).toBe(100);expect(result.coverage?.members.map((p) => p.exerciseId)).toEqual([1]);expect(result.coverage?.exclusions).toEqual([expect.objectContaining({ sessionId: 2, reason: expect.stringMatching(/fixed/) })]);
  });
  it("does not remove recorded fallback history when logging selection is disabled", () => {
    const recorded = exercise();const scorePoints = points([recorded], [entry(1, "2026-01-01")]);expect(buildMuscleScorePoints([{ ...recorded, is_strength_exercise: 0 }], [], scorePoints, "2026-01-02").at(-1)?.score).toBe(100);
  });
  it("fixes each machine cohort member to its first tagged context and excludes untagged evidence", () => {
    const machine = exercise(1, "Machine Chest Press");const scorePoints = points([machine], [entry(1, "2026-01-01", 1, 100, "A"), entry(2, "2026-01-02", 1, 500, "B"), entry(3, "2026-01-03", 1, 999)]);
    const result = buildMuscleScorePoints([machine], [], scorePoints, "2026-01-03").at(-1)!;expect(result.score).toBe(100);expect(result.coverage?.includedSessionIds).toEqual([1]);expect(result.coverage?.exclusions.map((p) => p.sessionId)).toEqual([2, 3]);
  });
  it("does not let a configured future member establish a historical cutoff value", () => {
    const exercises = [exercise(), exercise(2)];const scorePoints = points(exercises, [entry(1, "2026-01-01"), entry(2, "2026-01-05", 2)]);
    const result = buildMuscleScorePoints(exercises, [config(1), config(2)], scorePoints, "2026-01-02").at(-1)!;expect(result.score).toBeNull();expect(result.coverage?.members[1].comparisonKey).toBeNull();
  });
  it("withholds unversioned legacy metrics rather than mixing formula meanings", () => {
    const scorePoints = points([exercise()], [entry(1, "2026-01-01")]).map(({ metricVersion: _version, ...p }) => p);
    const result = buildMuscleScorePoints([exercise()], [config(1)], scorePoints, "2026-01-02").at(-1)!;expect(result.score).toBeNull();expect(result.coverage?.missingExerciseIds).toEqual([1]);
  });
});
