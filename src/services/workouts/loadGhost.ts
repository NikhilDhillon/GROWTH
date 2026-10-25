/**
 * Which faint load picture flow mode shows above the numbers: a loaded bar for
 * barbell lifts, a weight stack for machines and cables, standing plates for
 * weighted dips and pull-ups, nothing otherwise.
 */
import { plateWeights } from "@/constants/plates";
import { ExerciseLoadType, isMachineLoadType, supportsBarbellCalculator } from "@/constants/exercises";
import type { MachineProfile, UnitSystem } from "@/types";

export type FlowLoadGhostKind =
  | { kind: "barbell"; barWeight: number }
  /** plateSize is in the displayed unit; plates is the stack's height. */
  | { kind: "stack"; plateSize: number; plates: number }
  /** The added weight as plates standing on the floor. */
  | { kind: "plates" };

/** Stack plates are usually about 5 kg (10 lb) each. */
const standardStackPlate: Record<UnitSystem, number> = { kg: 5, lb: 10 };
const defaultStackPlates = 12;

export function flowLoadGhost(input: {
  exerciseName: string;
  loadType: ExerciseLoadType;
  unitSystem: UnitSystem;
  profile: MachineProfile | null;
  barWeight?: number;
}): FlowLoadGhostKind | null {
  // The plate calculator only knows pound plates.
  if (supportsBarbellCalculator(input.exerciseName)) {
    return input.unitSystem === "lb" ? { kind: "barbell", barWeight: input.barWeight && input.barWeight > 0 ? input.barWeight : 45 } : null;
  }
  if (input.loadType === "bodyweight_plus_load") return input.unitSystem === "lb" ? { kind: "plates" } : null;
  if (!isMachineLoadType(input.loadType)) return null;
  const profile = input.profile;
  if (profile?.stackUnit === "plate") return { kind: "stack", plateSize: 1, plates: stackHeight(profile.maxLoad) };
  // A machine tag's increment is used only when it describes whole plates, not a dial step.
  const sameUnit = profile?.stackUnit === input.unitSystem;
  const standard = standardStackPlate[input.unitSystem];
  const plateSize = sameUnit && profile.increment >= standard ? profile.increment : standard;
  return { kind: "stack", plateSize, plates: sameUnit && profile.maxLoad > 0 ? stackHeight(profile.maxLoad / plateSize) : defaultStackPlates };
}

/** Added weight as whole plates, largest first; a few at most, since it is only a picture. */
export function standingPlates(load: number, limit = 6) {
  const plates: number[] = [];
  let left = Math.max(0, load);
  for (const plate of plateWeights) {
    while (left + 1e-9 >= plate && plates.length < limit) {
      plates.push(plate);
      left -= plate;
    }
  }
  return plates;
}

function stackHeight(plates: number) {
  return Math.max(8, Math.min(20, Math.ceil(plates) || defaultStackPlates));
}
