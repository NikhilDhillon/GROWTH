import type { LoggedSetDraft, MuscleGroup, UnitSystem } from "@/types";
import { sameStoredJson } from "@/database/workoutWrite";
import { muscles } from "@/utils/theme";
import { createEmptyPlateCounts } from "@/utils/workout";

export type QuickWorkoutAttempt = {
  origin: "manual"; requestId: string; unitSystem: UnitSystem; exerciseId: number;
  workoutDate: string; notes: string; machineProfileId: string | null; sets: LoggedSetDraft[];
};
/** Account/unit-bound input evidence. Reports never consume this draft. */
export type QuickWorkoutDraft = {
  version: 1; accountId: string; unitSystem: UnitSystem; selectedMuscle: MuscleGroup;
  exerciseId: number | null; seededHistoryKey: string | null; sets: LoggedSetDraft[];
  barWeight: string; plateCounts: Record<string, number>; workoutDate: string; notes: string;
  machineProfileId: string | null; pending: QuickWorkoutAttempt | null;
};

export function createQuickWorkoutDraft(accountId: string, unitSystem: UnitSystem, workoutDate: string, exerciseId: number | null = null, selectedMuscle: MuscleGroup = "Chest"): QuickWorkoutDraft {
  return { version: 1, accountId, unitSystem, workoutDate, selectedMuscle, exerciseId,
    seededHistoryKey: null, sets: [{ reps: "", weight: "" }, { reps: "", weight: "" }, { reps: "", weight: "" }],
    notes: "", barWeight: "45", plateCounts: createEmptyPlateCounts(), machineProfileId: null, pending: null };
}

export function quickWorkoutAttempt(draft: QuickWorkoutDraft, requestId: string): QuickWorkoutAttempt {
  if (draft.exerciseId === null) throw new Error("Choose an exercise before recording.");
  return { origin: "manual", requestId, unitSystem: draft.unitSystem, exerciseId: draft.exerciseId,
    workoutDate: draft.workoutDate, notes: draft.notes, machineProfileId: draft.machineProfileId,
    sets: draft.sets.map((set) => ({ ...set })) };
}

export function isQuickWorkoutDraft(value: unknown, accountId: string): value is QuickWorkoutDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as QuickWorkoutDraft;
  if (draft.version !== 1 || draft.accountId !== accountId || !["lb", "kg"].includes(draft.unitSystem) || !muscles.includes(draft.selectedMuscle)
    || draft.exerciseId !== null && (!Number.isSafeInteger(draft.exerciseId) || draft.exerciseId <= 0)
    || draft.seededHistoryKey !== null && typeof draft.seededHistoryKey !== "string"
    || typeof draft.workoutDate !== "string" || typeof draft.notes !== "string" || typeof draft.barWeight !== "string"
    || draft.machineProfileId !== null && typeof draft.machineProfileId !== "string"
    || !Array.isArray(draft.sets) || !draft.sets.length
    || draft.sets.some((set) => !set || typeof set.reps !== "string" || typeof set.weight !== "string" || set.isWarmup !== undefined && typeof set.isWarmup !== "boolean")
    || !draft.plateCounts || typeof draft.plateCounts !== "object" || Array.isArray(draft.plateCounts)
    || Object.values(draft.plateCounts).some((count) => !Number.isSafeInteger(count) || count < 0)) return false;
  if (draft.pending === null) return true;
  try { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.pending.requestId)
    && sameStoredJson(draft.pending, quickWorkoutAttempt(draft, draft.pending.requestId)); }
  catch { return false; }
}

export class QuickWorkoutDraftController {
  private baseline: string | null | undefined;
  private queue: Promise<void> = Promise.resolve();
  constructor(private accountId: string, private storage: { read(): Promise<string | null>; write(expected: string | null, next: string | null): Promise<void> }) {}
  async load(): Promise<QuickWorkoutDraft | null> {
    await this.queue;
    const raw = await this.storage.read();
    if (raw === null) { this.baseline = null; return null; }
    let draft: unknown;
    try { draft = JSON.parse(raw); } catch { throw new Error("Your Quick workout draft could not be read. It has been preserved for recovery."); }
    if (!isQuickWorkoutDraft(draft, this.accountId)) throw new Error("Your Quick workout draft uses an unsupported or inconsistent format. It has been preserved for recovery.");
    this.baseline = raw;
    return draft;
  }
  save(draft: QuickWorkoutDraft | null) {
    if (draft !== null && !isQuickWorkoutDraft(draft, this.accountId)) return Promise.reject(new Error("The Quick workout draft has an unsupported or inconsistent format. Its saved values are preserved."));
    const next = draft === null ? null : JSON.stringify(draft);
    const action = this.queue.then(async () => {
      if (this.baseline === undefined) throw new Error("Wait for the saved Quick workout draft to load. Its existing values are preserved.");
      await this.storage.write(this.baseline, next);
      this.baseline = next;
    });
    this.queue = action.catch(() => undefined);
    return action;
  }
}
