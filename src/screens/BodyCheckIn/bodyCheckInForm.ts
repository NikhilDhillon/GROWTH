import type { BodyLimbMeasurement, BodyMeasurementLog, BodyMeasurementValues, BodyUnitPreferences } from "@/types";
import { assertCalendarDate, isCalendarDate } from "@/domain/calendar";
import { bodyMeasurementDefinitions, bodyMeasurementValuesFromStorage, type BodyMeasurementKey } from "@/utils/bodyMeasurements";
import { bodyWeightFromStorageUnit } from "@/utils/units";
import { buildBodyMeasurementReport } from "@/services/body/bodyMeasurementReport";

export type BodyCheckInField = { mode: "single" | "sides"; value: string; left: string; right: string };
export type BodyCheckInRecordingInput = {
  requestId: string; id?: number; expected?: BodyMeasurementLog; loggedDate: string;
  weight: string; measurements: BodyMeasurementValues; notes: string; inputUnits: BodyUnitPreferences;
};
/** Input/recovery state only. Observed facts continue to belong to bodyMeasurementLogs. */
export type BodyCheckInDraft = {
  version: 1; loggedDate: string; weight: string; fields: Record<BodyMeasurementKey, BodyCheckInField>;
  notes: string; inputUnits: BodyUnitPreferences; expected: BodyMeasurementLog | null;
  tapeExpanded: boolean; pending: BodyCheckInRecordingInput | null;
};

export function createBodyCheckInDraft(loggedDate: string, inputUnits: BodyUnitPreferences): BodyCheckInDraft {
  return {
    version: 1, loggedDate, weight: "", notes: "", inputUnits: { ...inputUnits }, expected: null,
    fields: Object.fromEntries(bodyMeasurementDefinitions.map(({ key }) => [key, { mode: "single", value: "", left: "", right: "" }])) as BodyCheckInDraft["fields"],
    tapeExpanded: false, pending: null
  };
}

export function editedBodyCheckInDraft(log: BodyMeasurementLog, inputUnits: BodyUnitPreferences): BodyCheckInDraft {
  const draft = createBodyCheckInDraft(log.logged_date, inputUnits);
  // Never use rounded display formatting as the editable value of historical facts.
  draft.weight = log.weight === null ? "" : String(bodyWeightFromStorageUnit(log.weight, inputUnits.weight));
  draft.notes = log.notes ?? "";
  draft.expected = JSON.parse(JSON.stringify(log)) as BodyMeasurementLog;
  const values = bodyMeasurementValuesFromStorage(log.measurements, inputUnits.circumference);
  for (const definition of bodyMeasurementDefinitions) {
    const value = values[definition.key];
    if (typeof value === "number") draft.fields[definition.key].value = String(value);
    else if (value?.mode === "single") draft.fields[definition.key].value = String(value.value);
    else if (value?.mode === "sides") draft.fields[definition.key] = {
      mode: "sides", value: "", left: value.left === undefined ? "" : String(value.left), right: value.right === undefined ? "" : String(value.right)
    };
  }
  return draft;
}

export function bodyCheckInMeasurements(fields: BodyCheckInDraft["fields"]): BodyMeasurementValues {
  const measurements: BodyMeasurementValues = {};
  for (const definition of bodyMeasurementDefinitions) {
    const field = fields[definition.key];
    if (definition.sided && field.mode === "sides") {
      const left = positiveInput(field.left, `${definition.label}, left`);
      const right = positiveInput(field.right, `${definition.label}, right`);
      if (left !== null || right !== null) Object.assign(measurements, { [definition.key]: {
        mode: "sides", ...(left === null ? {} : { left }), ...(right === null ? {} : { right })
      } });
    } else {
      const value = positiveInput(field.value, definition.label);
      if (value !== null) Object.assign(measurements, { [definition.key]: definition.sided ? { mode: "single", value } : value });
    }
  }
  return measurements;
}

export function createBodyCheckInRequest(draft: BodyCheckInDraft, requestId: string): BodyCheckInRecordingInput {
  const loggedDate = assertCalendarDate(draft.loggedDate);
  const weight = positiveInput(draft.weight, "Bodyweight");
  const measurements = bodyCheckInMeasurements(draft.fields);
  if (weight === null && !Object.keys(measurements).length) throw new Error("Enter bodyweight or at least one tape measurement.");
  return {
    requestId, ...(draft.expected ? { id: draft.expected.id, expected: draft.expected } : {}), loggedDate,
    weight: draft.weight, measurements, notes: draft.notes, inputUnits: { ...draft.inputUnits }
  };
}

export function hasBodyCheckInInput(draft: BodyCheckInDraft) {
  return Boolean(draft.expected || draft.pending || draft.weight.trim() || draft.notes.trim()
    || Object.values(draft.fields).some((field) => field.value.trim() || field.left.trim() || field.right.trim()));
}

export function tapeFieldCount(fields: BodyCheckInDraft["fields"]) {
  return Object.values(fields).filter((field) => field.mode === "sides" ? field.left.trim() || field.right.trim() : field.value.trim()).length;
}

/** Each tape metric has its own recency; daily weight rows never refresh tape dates. */
export function latestBodyObservations(logs: readonly BodyMeasurementLog[], asOfDate: string) {
  const sorted = logs.filter((log) => isCalendarDate(log.logged_date) && log.logged_date <= asOfDate)
    .sort((left, right) => right.logged_date.localeCompare(left.logged_date) || right.created_at.localeCompare(left.created_at) || right.id - left.id);
  const weight = sorted.find((log) => Number.isFinite(log.weight) && Number(log.weight) > 0) ?? null;
  const tapes = bodyMeasurementDefinitions.map((definition) => {
    const log = sorted.find((row) => row.measurements[definition.key] !== undefined);
    const observations = buildBodyMeasurementReport(sorted, definition.key, asOfDate).map((report) => ({ channel: report.channel, ...report.latest }));
    return { definition, date: log?.logged_date ?? null, value: log?.measurements[definition.key] as number | BodyLimbMeasurement | undefined, observations };
  });
  return { weight, tapes };
}

function positiveInput(input: string, label: string) {
  if (!input.trim()) return null;
  const value = Number(input.trim().replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a number greater than zero.`);
  return value;
}
