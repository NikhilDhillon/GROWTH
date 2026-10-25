import { ExerciseLoadType, isBodyweightLoadType } from "@/constants/exercises";
import type { LoggedSetDraft, UnitSystem } from "@/types";
import { weightToStorageUnit } from "@/utils/units";
import type { ParsedObservedSet } from "./types";

/** Confirmation belongs to the capture boundary; this parser never confirms a suggestion. */
export function parseObservedSets(drafts: readonly LoggedSetDraft[], unit: UnitSystem, loadType: ExerciseLoadType): ParsedObservedSet[] {
  if (unit !== "lb" && unit !== "kg") throw new Error("Choose an explicit recording unit.");
  const entered = drafts.filter((set) => set.reps.trim() || set.weight.trim());
  if (!entered.length) throw new Error("Record at least one observed set.");
  return entered.map((set) => {
    if (!set.reps.trim() || !set.weight.trim()) throw new Error("Enter both reps and load for each performed set; enter 0 explicitly for no added load or assistance.");
    const reps = Number(set.reps);
    const load = Number(set.weight);
    if (!Number.isSafeInteger(reps) || reps <= 0) throw new Error("Observed reps must be positive whole numbers.");
    if (!Number.isFinite(load) || (isBodyweightLoadType(loadType) ? load < 0 : load <= 0)) {
      throw new Error(isBodyweightLoadType(loadType) ? "Added load or assistance cannot be negative." : "Enter a positive external load for this exercise.");
    }
    const weight = weightToStorageUnit(load, unit);
    if (!Number.isFinite(weight)) throw new Error("The entered load is too large to record.");
    return { reps, weight, isWarmup: Boolean(set.isWarmup),
      ...(set.performedAt ? { performedAt: set.performedAt } : {}),
      ...(set.evidence ? { evidence: set.evidence } : {}) };
  });
}

/** The performed values alone, without capture metadata. */
export function observationValues(sets: readonly { reps: number; weight: number; isWarmup?: boolean }[]) {
  return sets.map((set) => ({ reps: set.reps, weight: set.weight, isWarmup: Boolean(set.isWarmup) }));
}

/** Existing score requirements remain separate from the permission to record observations. */
export function getScoringEligibility(sets: readonly ParsedObservedSet[], context: { loadType?: ExerciseLoadType; bodyWeightLb?: number } = {}) {
  const workingSets = sets.filter((set) => !set.isWarmup);
  if (workingSets.length < 2) return { eligible: false, reason: "At least two working sets are needed for Performance Points." };
  const loadType = context.loadType ?? "external";
  if (workingSets.some((set) => !Number.isSafeInteger(set.reps) || set.reps <= 0 || !Number.isFinite(set.weight)
    || (isBodyweightLoadType(loadType) ? set.weight < 0 : set.weight <= 0))) {
    return { eligible: false, reason: "The working observations are invalid." };
  }
  if (isBodyweightLoadType(loadType)) {
    if (!Number.isFinite(context.bodyWeightLb) || Number(context.bodyWeightLb) <= 0) return { eligible: false, reason: "Bodyweight context is required for this score." };
    if (loadType === "bodyweight_minus_assistance" && workingSets.some((set) => set.weight >= context.bodyWeightLb!)) return { eligible: false, reason: "Assistance leaves no positive effective load for this score." };
  }
  return { eligible: true, reason: null };
}
