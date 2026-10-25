import { getExerciseLoadType, isMachineLoadType } from "@/constants/exercises";
import type { ExerciseEntry, Prescription } from "@/domain/types";
import type { Exercise, GuidedWorkoutPreferences } from "@/types";
import { buildGuidedSessionOutcome } from "@/services/guidedWorkout/guidedWorkoutService";

/** Re-evaluate original targets against current authoritative facts, including after historical edits. */
export function guidanceForRecordedEntry(entry: ExerciseEntry, prescription: Prescription | null | undefined,
  exercise: Exercise | undefined, preferences: GuidedWorkoutPreferences) {
  if (!prescription || !exercise) return undefined;
  const type = getExerciseLoadType(exercise);
  const equipment = prescription.equipment;
  // An untagged machine prescription matches an untagged entry: both belong to the shared untagged history.
  const prescribedMachine = equipment?.kind === "machine_profile" ? equipment.machineProfileId : null;
  const equipmentChanged = isMachineLoadType(type)
    ? equipment?.kind === "non_machine" || prescribedMachine !== (entry.machineProfileId ?? null)
    : equipment?.kind === "machine_profile" || equipment?.kind === "unknown"
      || (equipment?.kind === "non_machine" && equipment.loadType !== type);
  if (prescription.exerciseId !== entry.exerciseId || equipmentChanged) {
    return { category: prescription.category, celebrated: false,
      messages: ["The recorded exercise or equipment differs from the original prescription. Target achievement cannot be evaluated."] };
  }
  return buildGuidedSessionOutcome({ exercise, preferences, prescription, unitSystem: "lb",
    sets: entry.sets.map((set) => ({ reps: String(set.reps), weight: String(set.loadLb), isWarmup: set.isWarmup })) });
}
