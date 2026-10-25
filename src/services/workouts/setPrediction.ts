/**
 * What the next set will probably be, so flow mode can start its dial there:
 * today's previous set minus your usual drop between those two sets last time;
 * otherwise last session's same set at today's load; otherwise the target.
 */
import type { LoggedSetDraft } from "@/types";
import { isLoggedSet } from "./setCapture";

type Observation = { reps: number; load: number };
const defaultRepDrop = 1;

/** Reps at one load carried to another through the same e1RM (Epley, as Performance Points use). */
export function repsAtLoad(observation: Observation, load: number, scaleByLoad: boolean) {
  if (!scaleByLoad || observation.load <= 0 || load <= 0 || observation.load === load) return observation.reps;
  return Math.max(1, 30 * (observation.load * (1 + observation.reps / 30) / load - 1));
}

export type RepPredictionInput = {
  load: number;
  /** Whether reps can be carried across loads; only meaningful for external load. */
  scaleByLoad: boolean;
  /** This set and the one before it, from the last session of this exercise. */
  previous?: Observation | null;
  previousBefore?: Observation | null;
  /** The set before this one, as logged today. */
  loggedBefore?: Observation | null;
  targetReps?: number;
};

export function expectedReps(input: RepPredictionInput) {
  if (input.loggedBefore) {
    const usualDrop = input.previous && input.previousBefore
      ? repsAtLoad(input.previousBefore, input.load, input.scaleByLoad) - repsAtLoad(input.previous, input.load, input.scaleByLoad)
      : defaultRepDrop;
    return Math.max(1, repsAtLoad(input.loggedBefore, input.load, input.scaleByLoad) - Math.min(4, Math.max(-1, usualDrop)));
  }
  if (input.previous) return repsAtLoad(input.previous, input.load, input.scaleByLoad);
  return input.targetReps && input.targetReps > 0 ? input.targetReps : 10;
}

/** The draft row flow mode logs next: the first one that is empty or only a suggestion. */
export function nextFlowRow(sets: readonly LoggedSetDraft[]) {
  const index = sets.findIndex((set) => !isLoggedSet(set));
  return index >= 0 ? index : null;
}

function parsed(set: LoggedSetDraft | undefined): Observation | null {
  if (!set || !isLoggedSet(set)) return null;
  const reps = Number(set.reps);
  const load = Number(set.weight);
  return set.reps.trim() && set.weight.trim() && Number.isInteger(reps) && reps > 0 && Number.isFinite(load) && load >= 0 ? { reps, load } : null;
}

/**
 * History for a draft row. Working rows line up with last session's working sets by
 * working-set number; warm-ups only learn from today's earlier warm-up.
 */
export function flowHistoryForRow(sets: readonly LoggedSetDraft[], row: number, previousWorking: readonly Observation[]) {
  const warmup = Boolean(sets[row]?.isWarmup);
  const before = sets.slice(0, row).filter((set) => Boolean(set.isWarmup) === warmup).at(-1);
  const ordinal = warmup ? -1 : sets.slice(0, row).filter((set) => !set.isWarmup).length;
  return {
    loggedBefore: parsed(before),
    previous: ordinal >= 0 ? previousWorking[ordinal] ?? null : null,
    previousBefore: ordinal > 0 ? previousWorking[ordinal - 1] ?? null : null
  };
}

/** The load flow mode offers: this row's own value, else the nearest earlier row of the same kind. */
export function plannedFlowLoad(sets: readonly LoggedSetDraft[], row: number, fallback?: number) {
  const warmup = Boolean(sets[row]?.isWarmup);
  for (let index = row; index >= 0; index -= 1) {
    if (Boolean(sets[index]?.isWarmup) !== warmup) continue;
    const value = Number(sets[index]?.weight);
    if (sets[index]?.weight.trim() && Number.isFinite(value) && value >= 0) return value;
  }
  return fallback !== undefined && Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
}
