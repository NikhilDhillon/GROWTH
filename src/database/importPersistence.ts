import type { ImportBodyMeasurementLog, ImportBodyWeightLog, ImportResult, ImportWorkoutLog } from "@/services/import/importService";
import { assertBodyMeasurementValues } from "@/domain/bodyCheckInRecording";
import { assertCalendarDate } from "@/domain/calendar";
import { assertWorkoutWrite } from "./workoutWrite";

export type TrainingImportInput = {
  bodyWeightLogs: ImportBodyWeightLog[];
  bodyMeasurementLogs?: ImportBodyMeasurementLog[];
  workouts: ImportWorkoutLog[];
  exerciseIdsToEnable: number[];
  expectedAccountId?: string | number;
};

/** Only combine observations in this import; never merge with an occupied saved date. */
export function importedBodyCheckIns(input: TrainingImportInput): ImportBodyMeasurementLog[] {
  const rows = new Map<string, ImportBodyMeasurementLog>();
  for (const log of input.bodyMeasurementLogs ?? []) {
    assertCalendarDate(log.loggedDate);
    assertBodyMeasurementValues(log.measurements);
    if (log.weight !== null && (!Number.isFinite(log.weight) || log.weight <= 0)) throw new Error("Imported bodyweight must be positive.");
    if (log.weightInputUnit != null && !["lb", "kg"].includes(log.weightInputUnit)) throw new Error("Invalid imported weight unit.");
    if (log.circumferenceInputUnit != null && !["in", "cm"].includes(log.circumferenceInputUnit)) throw new Error("Invalid imported tape unit.");
    if (log.weight === null && !Object.keys(log.measurements).length) throw new Error("An imported check-in needs an observation.");
    if (rows.has(log.loggedDate)) throw new Error("Import contains duplicate tape check-in dates.");
    rows.set(log.loggedDate, { ...log });
  }
  const weightDates = new Set<string>();
  for (const log of input.bodyWeightLogs) {
    assertCalendarDate(log.loggedDate);
    if (!Number.isFinite(log.weight) || log.weight <= 0) throw new Error("Imported bodyweight must be positive.");
    if (log.weightInputUnit != null && !["lb", "kg"].includes(log.weightInputUnit)) throw new Error("Invalid imported weight unit.");
    if (weightDates.has(log.loggedDate)) throw new Error("Import contains duplicate bodyweight dates.");
    weightDates.add(log.loggedDate);
    const tape = rows.get(log.loggedDate);
    if (tape?.weight != null && tape.weight !== log.weight) throw new Error("Import contains conflicting weights on the same date.");
    rows.set(log.loggedDate, { ...tape, loggedDate: log.loggedDate, weight: log.weight,
      weightInputUnit: log.weightInputUnit ?? null, measurements: tape?.measurements ?? {}, notes: tape?.notes ?? null });
  }
  for (const workout of input.workouts) {
    assertWorkoutWrite({ ...workout, recordingOrigin: "import" });
    if (!workout.fingerprint?.trim()) throw new Error("An imported workout needs a source identity.");
    if (workout.sets.some((set) => set.rir != null && (!Number.isFinite(set.rir) || set.rir < 0 || set.rir > 10))) throw new Error("Imported RIR must be between zero and ten.");
  }
  return [...rows.values()];
}

export function emptyImportResult(): ImportResult {
  return { inserted: { bodyCheckIns: 0, workouts: 0, sets: 0 }, skipped: { bodyCheckIns: 0, workouts: 0 }, failed: 0 };
}

export function committedImportResult(value: unknown): ImportResult {
  const result = value as ImportResult | null;
  const counts = [result?.inserted?.bodyCheckIns, result?.inserted?.workouts, result?.inserted?.sets,
    result?.skipped?.bodyCheckIns, result?.skipped?.workouts, result?.failed];
  if (counts.some((n) => !Number.isSafeInteger(n) || Number(n) < 0) || result?.failed !== 0) {
    throw new Error("The import acknowledgement is incomplete. Refresh history before retrying the same file.");
  }
  return result!;
}

/**
 * Legacy receipts retain their payload text; stable external identities remain retired even when a file changes its values.
 * Only receipts from earlier imports retire a source: one external workout carries one entry per exercise, so its sibling
 * entries in the same file must all be imported. Exact duplicates are still skipped within the batch.
 */
export function hasImportedWorkoutReceipt(priorReceipts: Set<string>, batchReceipts: Set<string>, fingerprint: string) {
  if (priorReceipts.has(fingerprint) || batchReceipts.has(fingerprint)) return true;
  if (!fingerprint.startsWith("external:")) return false;
  const source = fingerprint.split("::", 1)[0];
  return [...priorReceipts].some((receipt) => receipt.startsWith(`${source}::`));
}
