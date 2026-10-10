import { SplitMuscle, TrainingSplit, TrainingSplitDay } from "@/types";

const dayTemplate: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" }
];

const defaultMuscles: Record<string, SplitMuscle[]> = {
  sun: ["Chest", "Triceps"],
  mon: ["Back", "Biceps", "Traps"],
  tue: ["Legs", "Shoulders"],
  wed: ["Chest", "Triceps"],
  thu: ["Back", "Biceps", "Traps"],
  fri: ["Legs", "Shoulders"],
  sat: [],
};

/** The built-in split before the Saturday-rest schedule: Monday start, Thursday rest. */
const previousDefaultMuscles: Record<string, SplitMuscle[]> = {
  mon: ["Chest", "Triceps"],
  tue: ["Back", "Biceps", "Traps"],
  wed: ["Legs", "Shoulders"],
  thu: [],
  fri: ["Chest", "Triceps"],
  sat: ["Back", "Biceps", "Traps"],
  sun: ["Legs", "Shoulders"]
};

const validMuscles = new Set<SplitMuscle>(["Chest", "Triceps", "Back", "Biceps", "Legs", "Shoulders", "Traps", "Forearms", "Abs"]);

export function createDefaultTrainingSplit(): TrainingSplit {
  return {
    days: dayTemplate.map((day) => ({ ...day, muscles: [...defaultMuscles[day.key]] })),
    updated_at: null,
    updated_by: null
  };
}

export function cloneTrainingSplitDays(days: TrainingSplitDay[]) {
  return days.map((day) => ({ ...day, muscles: [...day.muscles] }));
}

export function normalizeTrainingSplit(value: unknown): TrainingSplit {
  const fallback = createDefaultTrainingSplit();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<TrainingSplit>;
  if (!Array.isArray(candidate.days)) return fallback;

  const supplied = new Map(candidate.days.map((day) => [day?.key, day]));
  const days = dayTemplate.map((day) => {
    const muscles = supplied.get(day.key)?.muscles;
    return {
      ...day,
      muscles: Array.isArray(muscles) ? muscles.filter((muscle): muscle is SplitMuscle => validMuscles.has(muscle as SplitMuscle)) : [...defaultMuscles[day.key]]
    };
  });

  return {
    days,
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : null,
    updated_by: typeof candidate.updated_by === "string" ? candidate.updated_by : null
  };
}

/**
 * A saved split identical to the previous built-in default was never customised,
 * so it follows the current default. Any edited split is returned unchanged.
 * Applied when loading only; explicit writes keep exactly what was saved.
 */
export function upgradeUncustomisedTrainingSplit(split: TrainingSplit): TrainingSplit {
  const untouched = split.days.length === dayTemplate.length && split.days.every((day) => {
    const previous = previousDefaultMuscles[day.key];
    return previous !== undefined && day.muscles.length === previous.length && day.muscles.every((muscle, index) => muscle === previous[index]);
  });
  return untouched ? { ...split, days: createDefaultTrainingSplit().days } : split;
}
