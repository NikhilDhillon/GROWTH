import type { BodyMeasurementValues } from "@/types";
import { assertBodyCheckInWrite, assertBodyMeasurementValues, BodyCheckInValidationError, BodyCheckInWriteInput } from "@/domain/bodyCheckInRecording";
import { bodyMeasurementValuesFromStorage, bodyMeasurementValuesToStorage, bodyWeightFromStorage, bodyWeightToStorage } from "@/utils/bodyMeasurements";
import { sameStoredJson } from "@/database/workoutWrite";

export type BodyCheckInCaptureInput = Omit<BodyCheckInWriteInput, "weight"> & { weight: string };

/** Entered units belong to this form; current preferences cannot reinterpret them. */
export function prepareBodyCheckInWrite(input: BodyCheckInCaptureInput): BodyCheckInWriteInput {
  try {
    assertBodyMeasurementValues(input.measurements);
    const enteredWeight = input.weight.trim();
    const parsedWeight = enteredWeight ? Number(enteredWeight.replace(",", ".")) : null;
    const previous = input.expected;
    const unchangedWeight = previous?.weight != null && enteredWeight === String(bodyWeightFromStorage(previous.weight, input.inputUnits.weight));
    const converted = bodyMeasurementValuesToStorage(input.measurements, input.inputUnits.circumference);
    const displayedPrevious = previous ? bodyMeasurementValuesFromStorage(previous.measurements, input.inputUnits.circumference) : {};
    const measurements: BodyMeasurementValues = Object.fromEntries(Object.entries(converted).map(([key, value]) => {
      const metric = key as keyof BodyMeasurementValues;
      return [key, previous && sameStoredJson(input.measurements[metric], displayedPrevious[metric]) ? previous.measurements[metric] : value];
    }));
    const prepared: BodyCheckInWriteInput = { ...input,
      weight: unchangedWeight ? previous!.weight : parsedWeight === null ? null : bodyWeightToStorage(parsedWeight, input.inputUnits.weight), measurements };
    assertBodyCheckInWrite(prepared);
    return prepared;
  } catch (error) {
    throw new BodyCheckInValidationError(error instanceof Error ? error.message : "Check the entered body observations.");
  }
}
