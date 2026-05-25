import { Exercise, UnitSystem } from "@/types";
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

export type ParsedImportData = {
  bodyWeightLogs: ImportBodyWeightLog[];
  workouts: ImportWorkoutLog[];
  exerciseIdsToEnable: number[];
  warnings: string[];
};

export type ImportPreview = ParsedImportData & {
  bodyWeightCount: number;
  workoutCount: number;
  setCount: number;
};

type ImportFile = {
  schemaVersion?: unknown;
  unit?: unknown;
  bodyweightUnit?: unknown;
  bodyweight?: unknown;
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
  if (file.schemaVersion !== 1) {
    throw new Error("Import schemaVersion must be 1.");
  }

  const workoutUnit = parseUnit(file.unit, "unit", true) ?? "lb";
  const bodyweightUnit = parseUnit(file.bodyweightUnit, "bodyweightUnit", false) ?? bodyWeightDisplayUnit;
  const exerciseByName = new Map(exercises.map((exercise) => [normalizeExerciseName(exercise.name), exercise]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const bodyWeightByDate = new Map<string, ImportBodyWeightLog>();
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
            if (setEntry.rir !== undefined) {
              warnings.push(`${setPrefix}.rir was ignored. RIR is not imported in v1.`);
            }
            const reps = readPositiveInteger(setEntry.reps, `${setPrefix}.reps`, errors);
            const weight = readNonNegativeNumber(setEntry.weight, `${setPrefix}.weight`, errors);
            if (reps === null || weight === null) return [];
            return [{ reps, weight: weightToStorageUnit(weight, workoutUnit) }];
          });

          if (!date || !exercise || !sets.length) return;

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

  if (!bodyWeightByDate.size && !workouts.length && !errors.length) {
    errors.push("Import file must include at least one bodyweight entry or workout exercise log.");
  }

  if (errors.length) {
    throw new Error(errors.slice(0, 8).join("\n"));
  }

  const bodyWeightLogs = [...bodyWeightByDate.values()].sort((a, b) => a.loggedDate.localeCompare(b.loggedDate));
  const setCount = workouts.reduce((total, workout) => total + workout.sets.length, 0);

  return {
    bodyWeightLogs,
    workouts,
    exerciseIdsToEnable: [...exerciseIdsToEnable],
    warnings,
    bodyWeightCount: bodyWeightLogs.length,
    workoutCount: workouts.length,
    setCount
  };
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
