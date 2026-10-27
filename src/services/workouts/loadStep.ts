/**
 * How far one click of flow mode's weight dial moves. You can pick it for each
 * exercise on each machine; until then it is the machine's increment, the finest
 * jump between loads you have used on that machine, or a common plate step.
 */
import { isLoadStep } from "@/constants/guidedWorkout";
import type { MachineProfile, UnitSystem } from "@/types";

/** The steps the dial offers, smallest first; any other can be typed. */
export function loadStepChoices(unitSystem: UnitSystem): number[] {
  return unitSystem === "kg" ? [0.5, 1, 1.25, 2.5, 5, 10] : [1, 2.5, 5, 10, 15, 20];
}

/** A remembered step belongs to an exercise, on one machine (or none), in one unit. */
export function loadStepKey(exerciseId: number, machineProfileId: string | null | undefined, unitSystem: UnitSystem) {
  return `${exerciseId}|${machineProfileId ?? ""}|${unitSystem}`;
}

/** The smallest jump between loads you have used, when it is a sensible step. */
export function learnedLoadStep(loads: readonly number[]): number | null {
  const distinct = [...new Set(loads.filter((load) => Number.isFinite(load) && load > 0).map((load) => Math.round(load * 100) / 100))].sort((a, b) => a - b);
  let finest = Infinity;
  for (let index = 1; index < distinct.length; index += 1) finest = Math.min(finest, distinct[index] - distinct[index - 1]);
  // Loads converted between units land a little off; a quarter is as fine as weights go.
  const step = Math.round(finest * 4) / 4;
  return Number.isFinite(step) && step >= 0.5 && step <= 25 ? step : null;
}

export function flowLoadStep(input: { chosen?: number; unitSystem: UnitSystem; profile: MachineProfile | null; machineLoads?: readonly number[] }) {
  if (isLoadStep(input.chosen)) return input.chosen;
  const { profile, unitSystem } = input;
  if (profile && profile.stackUnit === unitSystem && profile.increment > 0) return profile.increment;
  return (input.machineLoads ? learnedLoadStep(input.machineLoads) : null) ?? (unitSystem === "kg" ? 2.5 : 5);
}
