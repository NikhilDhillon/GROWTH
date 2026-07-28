import {
  BodyLimbMeasurement,
  BodyMeasurementLog,
  BodyMeasurementValues,
  BodyUnitPreferences,
  BodyWeightLog,
  CircumferenceUnit,
  UnitSystem
} from "@/types";
import { weightFromStorageUnit, weightToStorageUnit } from "@/utils/units";

export const defaultBodyUnitPreferences: BodyUnitPreferences = {
  weight: "kg",
  circumference: "in"
};

export const bodyMeasurementDefinitions = [
  { key: "arm_unflexed", label: "Arm (unflexed)", group: "Arms", sided: true },
  { key: "arm_flexed", label: "Arm (flexed)", group: "Arms", sided: true },
  { key: "calves", label: "Calves", group: "Legs", sided: true },
  { key: "chest", label: "Chest", group: "Torso", sided: false },
  { key: "forearm", label: "Forearm", group: "Arms", sided: true },
  { key: "abdomen", label: "Abdomen", group: "Torso", sided: false, hint: "Measure around the fullest part of the belly." },
  { key: "thinnest_waist", label: "Thinnest waist", group: "Torso", sided: false, hint: "Measure around the narrowest point of the torso." },
  { key: "thigh", label: "Thigh", group: "Legs", sided: true },
  { key: "waist", label: "Waist", group: "Torso", sided: false, hint: "Measure around the navel." }
] as const;

export type BodyMeasurementKey = (typeof bodyMeasurementDefinitions)[number]["key"];
export type LimbMeasurementKey = Extract<BodyMeasurementKey, "arm_unflexed" | "arm_flexed" | "calves" | "forearm" | "thigh">;
export type ScalarMeasurementKey = Exclude<BodyMeasurementKey, LimbMeasurementKey>;

const centimetresPerInch = 2.54;

export function circumferenceToStorageUnit(value: number, unit: CircumferenceUnit) {
  return unit === "in" ? value * centimetresPerInch : value;
}

export function circumferenceFromStorageUnit(value: number, unit: CircumferenceUnit) {
  return unit === "in" ? value / centimetresPerInch : value;
}

export function formatCircumference(value: number, unit: CircumferenceUnit) {
  const converted = circumferenceFromStorageUnit(value, unit);
  return `${converted.toFixed(1).replace(/\.0$/, "")} ${unit}`;
}

export function formatCircumferenceInput(value: number, unit: CircumferenceUnit) {
  return circumferenceFromStorageUnit(value, unit).toFixed(2).replace(/\.?0+$/, "");
}

export function bodyMeasurementValuesToStorage(values: BodyMeasurementValues, unit: CircumferenceUnit): BodyMeasurementValues {
  return mapMeasurementValues(values, (value) => circumferenceToStorageUnit(value, unit));
}

export function bodyMeasurementValuesFromStorage(values: BodyMeasurementValues, unit: CircumferenceUnit): BodyMeasurementValues {
  return mapMeasurementValues(values, (value) => circumferenceFromStorageUnit(value, unit));
}

export function bodyWeightLogsFromMeasurements(logs: BodyMeasurementLog[], unit: UnitSystem = "lb"): BodyWeightLog[] {
  return logs
    .filter((log): log is BodyMeasurementLog & { weight: number } => Number.isFinite(log.weight) && Number(log.weight) > 0)
    .map((log) => ({
      id: log.id,
      weight: Number(log.weight),
      unit,
      logged_at: log.logged_at,
      logged_date: log.logged_date,
      created_at: log.created_at
    }))
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at) || b.created_at.localeCompare(a.created_at));
}

export function bodyMeasurementsFromLegacyWeights(logs: BodyWeightLog[]) {
  const latestByDate = new Map<string, BodyWeightLog>();
  for (const log of logs) {
    const date = log.logged_date ?? log.logged_at?.slice(0, 10) ?? log.created_at.slice(0, 10);
    const current = latestByDate.get(date);
    if (!current || log.created_at.localeCompare(current.created_at) > 0 || (log.created_at === current.created_at && log.id > current.id)) {
      latestByDate.set(date, log);
    }
  }
  return [...latestByDate.entries()]
    .map(([loggedDate, log]) => normalizeBodyMeasurementLog({
      id: log.id,
      weight: log.weight,
      measurements: {},
      notes: null,
      logged_at: log.logged_at ?? `${loggedDate}T12:00:00.000Z`,
      logged_date: loggedDate,
      created_at: log.created_at,
      updated_at: log.created_at
    }))
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at) || b.created_at.localeCompare(a.created_at));
}

export function bodyWeightToStorage(value: number, unit: UnitSystem) {
  return weightToStorageUnit(value, unit);
}

export function bodyWeightFromStorage(value: number, unit: UnitSystem) {
  return weightFromStorageUnit(value, unit);
}

export function normalizeBodyUnitPreferences(value: unknown): BodyUnitPreferences {
  if (!value || typeof value !== "object") return defaultBodyUnitPreferences;
  const candidate = value as Partial<BodyUnitPreferences>;
  return {
    weight: candidate.weight === "lb" ? "lb" : "kg",
    circumference: candidate.circumference === "cm" ? "cm" : "in"
  };
}

export function normalizeBodyMeasurementValues(value: unknown): BodyMeasurementValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: BodyMeasurementValues = {};

  for (const definition of bodyMeasurementDefinitions) {
    const raw = input[definition.key];
    if (definition.sided) {
      const limb = normalizeLimbMeasurement(raw);
      if (limb) Object.assign(output, { [definition.key]: limb });
    } else {
      const number = positiveNumber(raw);
      if (number !== null) Object.assign(output, { [definition.key]: number });
    }
  }

  return output;
}

export function normalizeBodyMeasurementLog(value: Partial<BodyMeasurementLog> & { id: number }): BodyMeasurementLog {
  const loggedDate = value.logged_date ?? value.logged_at?.slice(0, 10) ?? value.created_at?.slice(0, 10) ?? "";
  const createdAt = value.created_at ?? `${loggedDate}T12:00:00.000Z`;
  return {
    id: value.id,
    weight: positiveNumber(value.weight) ?? null,
    measurements: normalizeBodyMeasurementValues(value.measurements),
    notes: typeof value.notes === "string" ? value.notes : null,
    logged_at: value.logged_at ?? `${loggedDate}T12:00:00.000Z`,
    logged_date: loggedDate,
    created_at: createdAt,
    updated_at: value.updated_at ?? createdAt
  };
}

export function hasBodyMeasurementData(weight: number | null | undefined, measurements: BodyMeasurementValues) {
  return (Number.isFinite(weight) && Number(weight) > 0) || Object.keys(normalizeBodyMeasurementValues(measurements)).length > 0;
}

export function parseStoredMeasurements(value: unknown): BodyMeasurementValues {
  if (typeof value === "string") {
    try {
      return normalizeBodyMeasurementValues(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return normalizeBodyMeasurementValues(value);
}

function mapMeasurementValues(values: BodyMeasurementValues, convert: (value: number) => number): BodyMeasurementValues {
  const normalized = normalizeBodyMeasurementValues(values);
  const output: BodyMeasurementValues = {};

  for (const definition of bodyMeasurementDefinitions) {
    const value = normalized[definition.key];
    if (definition.sided) {
      const limb = value as BodyLimbMeasurement | undefined;
      if (!limb) continue;
      if (limb.mode === "single") {
        Object.assign(output, { [definition.key]: { mode: "single", value: convert(limb.value) } });
      } else {
        Object.assign(output, {
          [definition.key]: {
            mode: "sides",
            ...(limb.left !== undefined ? { left: convert(limb.left) } : {}),
            ...(limb.right !== undefined ? { right: convert(limb.right) } : {})
          }
        });
      }
    } else if (typeof value === "number") {
      Object.assign(output, { [definition.key]: convert(value) });
    }
  }

  return output;
}

function normalizeLimbMeasurement(value: unknown): BodyLimbMeasurement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { mode?: unknown; value?: unknown; left?: unknown; right?: unknown };
  if (candidate.mode === "single") {
    const single = positiveNumber(candidate.value);
    return single === null ? null : { mode: "single", value: single };
  }
  if (candidate.mode === "sides") {
    const left = positiveNumber(candidate.left);
    const right = positiveNumber(candidate.right);
    if (left === null && right === null) return null;
    return {
      mode: "sides",
      ...(left !== null ? { left } : {}),
      ...(right !== null ? { right } : {})
    };
  }
  return null;
}

function positiveNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}
