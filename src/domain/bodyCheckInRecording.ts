import type { BodyMeasurementLog, BodyMeasurementValues, BodyUnitPreferences } from "@/types";
import { assertCalendarDate } from "./calendar";
import { bodyMeasurementDefinitions } from "@/utils/bodyMeasurements";
import { sameStoredJson } from "@/database/workoutWrite";

export type BodyCheckInWriteInput = {
  requestId: string;
  /** Expected authenticated account at the start of this capture, never inferred ownership. */
  accountId?: number | string;
  id?: number;
  expected?: BodyMeasurementLog;
  loggedDate: string;
  weight: number | null;
  measurements: BodyMeasurementValues;
  notes?: string | null;
  inputUnits: BodyUnitPreferences;
};

export class BodyCheckInValidationError extends Error {
  constructor(message: string) { super(message); this.name = "BodyCheckInValidationError"; }
}
/** A confirmed rejection, distinct from an ambiguous network acknowledgement. */
export class BodyCheckInConflictError extends Error {
  constructor(message: string) { super(message); this.name = "BodyCheckInConflictError"; }
}

export function assertBodyCheckInWrite(input: BodyCheckInWriteInput) {
  try {
    assertCalendarDate(input.loggedDate);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) throw new Error("The check-in needs a valid save attempt ID.");
    if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id <= 0 || input.expected?.id !== input.id)) throw new Error("Editing requires the saved check-in snapshot.");
    if (input.id === undefined && input.expected !== undefined) throw new Error("A new check-in cannot replace a saved snapshot.");
    if (!["lb", "kg"].includes(input.inputUnits?.weight) || !["cm", "in"].includes(input.inputUnits?.circumference)) throw new Error("Check the displayed weight and tape units.");
    if (input.weight !== null && (!Number.isFinite(input.weight) || input.weight <= 0)) throw new Error("Bodyweight must be greater than zero, or left blank.");
    assertBodyMeasurementValues(input.measurements);
    if (input.weight === null && !Object.keys(input.measurements).length) throw new Error("Enter weight or at least one tape measurement.");
    if (input.notes != null && typeof input.notes !== "string") throw new Error("Check-in notes must be text.");
  } catch (error) {
    throw new BodyCheckInValidationError(error instanceof Error ? error.message : "Check the entered observations.");
  }
}

export function assertBodyMeasurementValues(values: BodyMeasurementValues) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Tape measurements must be a named set of values.");
  for (const [key, value] of Object.entries(values)) {
    const definition = bodyMeasurementDefinitions.find((item) => item.key === key);
    if (!definition) throw new Error(`Unknown tape measurement: ${key}.`);
    const positive = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number > 0;
    if (!definition.sided) {
      if (!positive(value)) throw new Error(`${definition.label} must be greater than zero.`);
    } else {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Check ${definition.label}.`);
      const limb = value as Record<string, unknown>;
      if (limb.mode === "single") {
        if (!positive(limb.value) || Object.keys(limb).some((field) => !["mode", "value"].includes(field))) throw new Error(`Check ${definition.label}.`);
      } else if (limb.mode === "sides") {
        const sides = [limb.left, limb.right].filter((side) => side !== undefined);
        if (!sides.length || !sides.every(positive) || Object.keys(limb).some((field) => !["mode", "left", "right"].includes(field))) throw new Error(`Check ${definition.label} left and right values.`);
      } else throw new Error(`Check ${definition.label} measurement mode.`);
    }
  }
}

/** Only saved facts and revision evidence take part in a whole-check-in edit. */
export function bodyCheckInSnapshot(row: BodyMeasurementLog) {
  return { id: row.id, logged_date: row.logged_date, weight: row.weight, measurements: row.measurements,
    notes: row.notes ?? null, updated_at: row.updated_at,
    weight_input_unit: row.weight_input_unit ?? null, circumference_input_unit: row.circumference_input_unit ?? null };
}

export function sameBodyCheckInSnapshot(current: BodyMeasurementLog, expected: BodyMeasurementLog) {
  return sameStoredJson(bodyCheckInSnapshot(current), bodyCheckInSnapshot(expected));
}

export function bodyCheckInWritePayload(input: BodyCheckInWriteInput) {
  const payload = { accountId: input.accountId ?? null, id: input.id ?? null, expected: input.expected ? bodyCheckInSnapshot(input.expected) : null,
    loggedDate: input.loggedDate, weight: input.weight, measurements: input.measurements,
    notes: input.notes?.trim() || null, inputUnits: input.inputUnits };
  return JSON.stringify(payload, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
}

/** An unchanged historical observation does not acquire invented input provenance. */
export function bodyCheckInObservationUnits(input: BodyCheckInWriteInput) {
  const previous = input.expected;
  const unchangedTape = previous && Object.entries(input.measurements).some(([key, value]) =>
    sameStoredJson(value, previous.measurements[key as keyof BodyMeasurementValues]));
  const changedTape = !previous || Object.entries(input.measurements).some(([key, value]) =>
    !sameStoredJson(value, previous.measurements[key as keyof BodyMeasurementValues]));
  const tapeUnit = unchangedTape
    ? !changedTape || previous?.circumference_input_unit === input.inputUnits.circumference ? previous?.circumference_input_unit ?? null : null
    : input.inputUnits.circumference;
  return {
    weight_input_unit: input.weight === null ? null : previous && input.weight === previous.weight ? previous.weight_input_unit ?? null : input.inputUnits.weight,
    circumference_input_unit: Object.keys(input.measurements).length ? tapeUnit : null
  };
}
