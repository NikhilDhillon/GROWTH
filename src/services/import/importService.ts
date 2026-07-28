import { BodyLimbMeasurement, BodyMeasurementValues, Exercise, UnitSystem } from "@/types";
import { bodyMeasurementDefinitions, circumferenceToStorageUnit } from "@/utils/bodyMeasurements";
import { bodyWeightDisplayUnit, weightToStorageUnit } from "@/utils/units";

export type ImportBodyWeightLog = {
  loggedDate: string;
  weight: number;
  unit: UnitSystem;
};

export type ImportWorkoutLog = {
  workoutDate: string;
  notes: string;
  exerciseId: number;
  exerciseName: string;
  fingerprint: string;
  sets: Array<{
    reps: number;
    weight: number;
  }>;
};

export type ImportBodyMeasurementLog = {
  loggedDate: string;
  weight: number | null;
  measurements: BodyMeasurementValues;
  notes: string | null;
};

export type ParsedImportData = {
  bodyWeightLogs: ImportBodyWeightLog[];
  bodyMeasurementLogs: ImportBodyMeasurementLog[];
  workouts: ImportWorkoutLog[];
  exerciseIdsToEnable: number[];
  warnings: string[];
};

export type ImportPreview = ParsedImportData & {
  bodyWeightCount: number;
  bodyMeasurementCount: number;
  workoutCount: number;
  setCount: number;
};

type ImportFile = {
  schemaVersion?: unknown;
  unit?: unknown;
  bodyweightUnit?: unknown;
  bodyweight?: unknown;
  bodyMeasurementUnit?: unknown;
  bodyMeasurements?: unknown;
  workouts?: unknown;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseImportData(text: string, exercises: Exercise[]): ImportPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Import file must be valid JSON.");
  }

  if (!isObject(raw)) {
    throw new Error("Import file must be a JSON object.");
  }

  const file = raw as ImportFile;
  if (file.schemaVersion !== 1 && file.schemaVersion !== 2) {
    throw new Error("Import schemaVersion must be 1 or 2.");
  }

  const workoutUnit = parseUnit(file.unit, "unit", true) ?? "lb";
  const bodyweightUnit = parseUnit(file.bodyweightUnit, "bodyweightUnit", false) ?? bodyWeightDisplayUnit;
  const bodyMeasurementUnit = parseCircumferenceUnit(file.bodyMeasurementUnit) ?? "in";
  const exerciseByName = new Map(exercises.map((exercise) => [normalizeExerciseName(exercise.name), exercise]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const bodyWeightByDate = new Map<string, ImportBodyWeightLog>();
  const bodyMeasurementsByDate = new Map<string, ImportBodyMeasurementLog>();
  const workouts: ImportWorkoutLog[] = [];
  const exerciseIdsToEnable = new Set<number>();

  if (file.bodyweight !== undefined) {
    if (!Array.isArray(file.bodyweight)) {
      errors.push("bodyweight must be an array.");
    } else {
      file.bodyweight.forEach((entry, index) => {
        const prefix = `bodyweight[${index}]`;
        if (!isObject(entry)) {
          errors.push(`${prefix} must be an object.`);
          return;
        }
        const date = readDate(entry.date, `${prefix}.date`, errors);
        const weight = readPositiveNumber(entry.weight, `${prefix}.weight`, errors);
        if (!date || weight === null) return;
        bodyWeightByDate.set(date, {
          loggedDate: date,
          weight: weightToStorageUnit(weight, bodyweightUnit),
          unit: bodyweightUnit
        });
      });
    }
  }

  if (file.bodyMeasurements !== undefined) {
    if (!Array.isArray(file.bodyMeasurements)) {
      errors.push("bodyMeasurements must be an array.");
    } else {
      file.bodyMeasurements.forEach((entry, index) => {
        const prefix = `bodyMeasurements[${index}]`;
        if (!isObject(entry)) {
          errors.push(`${prefix} must be an object.`);
          return;
        }
        const date = readDate(entry.date, `${prefix}.date`, errors);
        const notes = typeof entry.notes === "string" ? entry.notes.trim() : null;
        const weight = entry.weight === undefined || entry.weight === null
          ? null
          : readPositiveNumber(entry.weight, `${prefix}.weight`, errors);
        const measurements = parseBodyMeasurements(entry.measurements, bodyMeasurementUnit, prefix, errors);
        if (!date || (weight === null && !Object.keys(measurements).length)) return;
        bodyMeasurementsByDate.set(date, {
          loggedDate: date,
          weight: weight === null ? null : weightToStorageUnit(weight, bodyweightUnit),
          measurements,
          notes
        });
      });
    }
  }

  if (file.workouts !== undefined) {
    if (!Array.isArray(file.workouts)) {
      errors.push("workouts must be an array.");
    } else {
      file.workouts.forEach((workout, workoutIndex) => {
        const workoutPrefix = `workouts[${workoutIndex}]`;
        if (!isObject(workout)) {
          errors.push(`${workoutPrefix} must be an object.`);
          return;
        }
        const date = readDate(workout.date, `${workoutPrefix}.date`, errors);
        const notes = typeof workout.notes === "string" ? workout.notes.trim() : "";
        const externalId = typeof workout.externalId === "string" ? workout.externalId.trim() : "";

        if (!Array.isArray(workout.exercises)) {
          errors.push(`${workoutPrefix}.exercises must be an array.`);
          return;
        }

        workout.exercises.forEach((exerciseEntry, exerciseIndex) => {
          const exercisePrefix = `${workoutPrefix}.exercises[${exerciseIndex}]`;
          if (!isObject(exerciseEntry)) {
            errors.push(`${exercisePrefix} must be an object.`);
            return;
          }

          const exerciseName = typeof exerciseEntry.name === "string" ? exerciseEntry.name.trim() : "";
          const exercise = exerciseByName.get(normalizeExerciseName(exerciseName));
          if (!exerciseName) {
            errors.push(`${exercisePrefix}.name is required.`);
          } else if (!exercise) {
            errors.push(`${exercisePrefix}.name "${exerciseName}" does not match an exercise in the app.`);
          }

          if (!Array.isArray(exerciseEntry.sets)) {
            errors.push(`${exercisePrefix}.sets must be an array.`);
            return;
          }

          const sets = exerciseEntry.sets.flatMap((setEntry, setIndex) => {
            const setPrefix = `${exercisePrefix}.sets[${setIndex}]`;
            if (!isObject(setEntry)) {
              errors.push(`${setPrefix} must be an object.`);
              return [];
            }
            const reps = readPositiveInteger(setEntry.reps, `${setPrefix}.reps`, errors);
            const weight = readNonNegativeNumber(setEntry.weight, `${setPrefix}.weight`, errors);
            if (reps === null || weight === null) return [];
            if (weight <= 0) {
              errors.push(`${setPrefix}.weight must include external load for Performance Points.`);
              return [];
            }
            return [{ reps, weight: weightToStorageUnit(weight, workoutUnit) }];
          });

          if (!date || !exercise || sets.length < 2) {
            if (date && exercise && sets.length === 1) {
              errors.push(`${exercisePrefix}.sets must include at least two loaded sets for Performance Points.`);
            }
            return;
          }

          exerciseIdsToEnable.add(exercise.id);
          workouts.push({
            workoutDate: date,
            notes,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            fingerprint: buildWorkoutFingerprint({
              externalId,
              workoutDate: date,
              exerciseName: exercise.name,
              notes,
              sets
            }),
            sets
          });
        });
      });
    }
  }

  if (!bodyWeightByDate.size && !bodyMeasurementsByDate.size && !workouts.length && !errors.length) {
    errors.push("Import file must include at least one body check-in or workout exercise log.");
  }

  if (errors.length) {
    throw new Error(errors.slice(0, 8).join("\n"));
  }

  const bodyWeightLogs = [...bodyWeightByDate.values()].sort((a, b) => a.loggedDate.localeCompare(b.loggedDate));
  const bodyMeasurementLogs = [...bodyMeasurementsByDate.values()].sort((a, b) => a.loggedDate.localeCompare(b.loggedDate));
  const setCount = workouts.reduce((total, workout) => total + workout.sets.length, 0);

  return {
    bodyWeightLogs,
    bodyMeasurementLogs,
    workouts,
    exerciseIdsToEnable: [...exerciseIdsToEnable],
    warnings,
    bodyWeightCount: bodyWeightLogs.length,
    bodyMeasurementCount: bodyMeasurementLogs.length,
    workoutCount: workouts.length,
    setCount
  };
}

function parseBodyMeasurements(value: unknown, unit: "in" | "cm", prefix: string, errors: string[]) {
  const output: BodyMeasurementValues = {};
  if (value === undefined || value === null) return output;
  if (!isObject(value)) {
    errors.push(`${prefix}.measurements must be an object.`);
    return output;
  }

  for (const definition of bodyMeasurementDefinitions) {
    const raw = value[definition.key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (!definition.sided) {
      const number = readPositiveNumber(raw, `${prefix}.measurements.${definition.key}`, errors);
      if (number !== null) Object.assign(output, { [definition.key]: circumferenceToStorageUnit(number, unit) });
      continue;
    }

    if (typeof raw === "number") {
      const number = readPositiveNumber(raw, `${prefix}.measurements.${definition.key}`, errors);
      if (number !== null) Object.assign(output, { [definition.key]: { mode: "single", value: circumferenceToStorageUnit(number, unit) } });
      continue;
    }
    if (!isObject(raw)) {
      errors.push(`${prefix}.measurements.${definition.key} must be a number or an object with left/right values.`);
      continue;
    }
    const left = raw.left === undefined ? null : readPositiveNumber(raw.left, `${prefix}.measurements.${definition.key}.left`, errors);
    const right = raw.right === undefined ? null : readPositiveNumber(raw.right, `${prefix}.measurements.${definition.key}.right`, errors);
    if (left === null && right === null) continue;
    const limb: BodyLimbMeasurement = {
      mode: "sides",
      ...(left !== null ? { left: circumferenceToStorageUnit(left, unit) } : {}),
      ...(right !== null ? { right: circumferenceToStorageUnit(right, unit) } : {})
    };
    Object.assign(output, { [definition.key]: limb });
  }

  return output;
}

export function buildWorkoutFingerprint(input: {
  externalId?: string;
  workoutDate: string;
  exerciseName: string;
  notes: string;
  sets: Array<{ reps: number; weight: number }>;
}) {
  const setText = input.sets.map((set) => `${set.reps}x${roundWeight(set.weight)}`).join("|");
  const stableId = input.externalId ? `external:${input.externalId.trim()}` : "content";
  return [stableId, input.workoutDate, normalizeExerciseName(input.exerciseName), normalizeNotes(input.notes), setText].join("::");
}

export function normalizeExerciseName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeNotes(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseUnit(value: unknown, field: string, required: boolean): UnitSystem | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} must be "lb" or "kg".`);
    return null;
  }
  if (value === "lb" || value === "kg") return value;
  throw new Error(`${field} must be "lb" or "kg".`);
}

function parseCircumferenceUnit(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (value === "in" || value === "cm") return value;
  throw new Error('bodyMeasurementUnit must be "in" or "cm".');
}

function readDate(value: unknown, field: string, errors: string[]) {
  if (typeof value !== "string" || !datePattern.test(value)) {
    errors.push(`${field} must be YYYY-MM-DD.`);
    return null;
  }
  return value;
}

function readPositiveNumber(value: unknown, field: string, errors: string[]) {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) {
    errors.push(`${field} must be a number greater than 0.`);
    return null;
  }
  return number;
}

function readNonNegativeNumber(value: unknown, field: string, errors: string[]) {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0) {
    errors.push(`${field} must be a number greater than or equal to 0.`);
    return null;
  }
  return number;
}

function readPositiveInteger(value: unknown, field: string, errors: string[]) {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push(`${field} must be an integer greater than 0.`);
    return null;
  }
  return number;
}

function roundWeight(value: number) {
  return Number(value.toFixed(4));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
