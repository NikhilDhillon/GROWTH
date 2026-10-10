import { createBodyCheckInRequest, type BodyCheckInDraft } from "@/screens/BodyCheckIn/bodyCheckInForm";
import { sameStoredJson } from "@/database/workoutWrite";
import { bodyMeasurementDefinitions } from "@/utils/bodyMeasurements";

export type BodyDraftStorage = { read: () => Promise<string | null>; write: (expected: string | null, next: string | null) => Promise<void> };

/** A draft is recoverable input, never an automatically submitted observation. */
export class BodyCheckInDraftController {
  private baseline: string | null | undefined;
  private queue: Promise<void> = Promise.resolve();
  constructor(private storage: BodyDraftStorage) {}

  async load(): Promise<BodyCheckInDraft | null> {
    await this.queue;
    const raw = await this.storage.read();
    if (raw === null) { this.baseline = null; return null; }
    let draft: unknown;
    try { draft = JSON.parse(raw); } catch { throw new Error("Your stored body-entry draft could not be read. It has been preserved for recovery."); }
    if (!isBodyCheckInDraft(draft)) throw new Error("Your stored body-entry draft uses an unsupported format. It has been preserved for recovery.");
    this.baseline = raw;
    return draft;
  }

  save(draft: BodyCheckInDraft | null): Promise<void> {
    const next = draft === null ? null : JSON.stringify(draft);
    const action = this.queue.then(async () => {
      if (this.baseline === undefined) throw new Error("The saved body-entry draft has not been loaded. Its existing values have been preserved.");
      await this.storage.write(this.baseline, next);
      this.baseline = next;
    });
    this.queue = action.catch(() => undefined);
    return action;
  }
}

export function isBodyCheckInDraft(value: unknown): value is BodyCheckInDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as BodyCheckInDraft;
  if (draft.version !== 1 || typeof draft.loggedDate !== "string" || typeof draft.weight !== "string" || typeof draft.notes !== "string"
    || typeof draft.tapeExpanded !== "boolean" || !draft.fields
    || !["lb", "kg"].includes(draft.inputUnits?.weight) || !["cm", "in"].includes(draft.inputUnits?.circumference)) return false;
  if (bodyMeasurementDefinitions.some(({ key }) => {
    const field = draft.fields[key];
    return !field || !["single", "sides"].includes(field.mode) || [field.value, field.left, field.right].some((input) => typeof input !== "string");
  })) return false;
  if (draft.expected !== null && (!draft.expected || !Number.isSafeInteger(draft.expected.id) || typeof draft.expected.updated_at !== "string")) return false;
  const pending = draft.pending;
  if (pending === null) return true;
  if (!Boolean(pending && typeof pending.requestId === "string" && typeof pending.loggedDate === "string"
    && typeof pending.weight === "string" && typeof pending.notes === "string" && pending.measurements && typeof pending.measurements === "object"
    && ["lb", "kg"].includes(pending.inputUnits?.weight) && ["cm", "in"].includes(pending.inputUnits?.circumference))) return false;
  // Recovery cannot display one set of values while retrying different facts.
  try { return sameStoredJson(pending, createBodyCheckInRequest(draft, pending.requestId)); }
  catch { return false; }
}
