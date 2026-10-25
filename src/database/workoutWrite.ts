import { SetEvidence, UnitSystem, WorkoutSet } from "@/types";
import { assertCalendarDate } from "@/domain/calendar";

export const setEvidenceValues: readonly SetEvidence[] = ["typed", "flow", "planned", "recalled"];

export type WorkoutWriteSet = {
  reps: number;
  weight: number;
  isWarmup?: boolean;
  /** Capture metadata travels with the set but is never part of the observation or its retry payload. */
  performedAt?: string | null;
  evidence?: SetEvidence | null;
};

export type WorkoutWriteInput = {
  requestId?: string;
  exerciseId: number;
  workoutDate: string;
  notes: string;
  machineProfileId?: string | null;
  inputUnit?: UnitSystem | null;
  recordingOrigin?: "manual" | "guided" | "import" | null;
  sets: WorkoutWriteSet[];
};

/** A rejected entry before any persistence was attempted; safe to correct and retry. */
export class WorkoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkoutValidationError";
  }
}

/** Persistence validates observations, never whether they qualify for a calculated score. */
export function assertWorkoutWrite(input: WorkoutWriteInput) {
  try {
    assertCalendarDate(input.workoutDate);
    if (!Number.isSafeInteger(input.exerciseId) || input.exerciseId <= 0) throw new Error("Choose a valid exercise.");
    if (!input.sets.length) throw new Error("Record at least one observed set.");
    if (input.sets.some((set) => !Number.isInteger(set.reps) || set.reps <= 0 || !Number.isFinite(set.weight) || set.weight < 0)) {
      throw new Error("Observed sets require positive whole-number reps and a non-negative load.");
    }
    if (input.sets.some((set) => set.evidence != null && !setEvidenceValues.includes(set.evidence))) throw new Error("A set's capture method is invalid.");
    if (input.sets.some((set) => set.performedAt != null && (typeof set.performedAt !== "string" || !Number.isFinite(Date.parse(set.performedAt))))) {
      throw new Error("A set's capture time is invalid.");
    }
    if (input.inputUnit != null && input.inputUnit !== "lb" && input.inputUnit !== "kg") throw new Error("The recording unit must be lb or kg.");
    if (input.recordingOrigin != null && !["manual", "guided", "import"].includes(input.recordingOrigin)) throw new Error("The recording origin is invalid.");
  } catch (error) {
    throw new WorkoutValidationError(error instanceof Error ? error.message : "Check the recorded observations.");
  }
}

/** Retry metadata only. Reports always read the canonical session and sets. */
export function workoutWritePayload(input: WorkoutWriteInput, includeProvenance = true) {
  return JSON.stringify({
    exerciseId: input.exerciseId, workoutDate: input.workoutDate, notes: input.notes,
    machineProfileId: input.machineProfileId ?? null,
    sets: input.sets.map((set) => ({ reps: set.reps, weight: set.weight, isWarmup: Boolean(set.isWarmup) })),
    ...(includeProvenance && input.inputUnit ? { inputUnit: input.inputUnit } : {}),
    ...(includeProvenance && input.recordingOrigin ? { recordingOrigin: input.recordingOrigin } : {})
  });
}

/** Old ambiguous attempts may retry, but returning their ID does not manufacture provenance. */
export function matchesWorkoutWritePayload(storedPayload: string, input: WorkoutWriteInput) {
  return storedPayload === workoutWritePayload(input) || storedPayload === workoutWritePayload(input, false);
}

/** Capture columns for a newly recorded set; absent metadata stays unknown. */
export function setCaptureColumns(set: WorkoutWriteSet) {
  return { performed_at: set.performedAt ?? null, evidence: set.evidence ?? null };
}

/**
 * Capture columns for a set rewritten by a history edit. An unchanged set keeps its
 * original evidence; a changed one was corrected by hand. Timing stays with the position.
 */
export function editedSetCaptureColumns(previous: WorkoutSet | undefined, next: WorkoutWriteSet) {
  const unchanged = previous && previous.reps === next.reps && Number(previous.weight) === next.weight
    && Boolean(previous.is_warmup) === Boolean(next.isWarmup);
  return {
    performed_at: next.performedAt ?? previous?.performed_at ?? null,
    evidence: unchanged ? previous.evidence ?? null : next.evidence ?? "typed"
  };
}

/** JSON snapshots compare values, not object key insertion order. */
export function sameStoredJson(left: unknown, right: unknown) {
  const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
  return serialize(left) === serialize(right);
}
