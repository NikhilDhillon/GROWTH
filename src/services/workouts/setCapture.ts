import type { LoggedSetDraft, SetEvidence } from "@/types";

/** The values a capture method vouches for. Editing any of them invalidates that evidence. */
export function setCaptureKey(set: Pick<LoggedSetDraft, "reps" | "weight" | "isWarmup">) {
  return JSON.stringify([set.reps.trim(), set.weight.trim(), Boolean(set.isWarmup)]);
}

function isComplete(set: LoggedSetDraft) {
  return Boolean(set.reps.trim() && set.weight.trim());
}

function withoutCapture({ performedAt: _performedAt, evidence: _evidence, capturedValues: _capturedValues, ...set }: LoggedSetDraft): LoggedSetDraft {
  return set;
}

/**
 * A row the app filled in from the plan. It is still waiting to be performed; saving
 * it untouched records it as done as planned, and editing it makes it typed.
 */
export function plannedSuggestion(set: LoggedSetDraft): LoggedSetDraft {
  const base = withoutCapture(set);
  return isComplete(base) ? { ...base, evidence: "planned", capturedValues: setCaptureKey(base) } : base;
}

export function isPlannedSuggestion(set: LoggedSetDraft) {
  return set.evidence === "planned" && !set.performedAt && set.capturedValues === setCaptureKey(set);
}

/** A row holding values the lifter entered or tapped, as opposed to an empty row or a suggestion. */
export function isLoggedSet(set: LoggedSetDraft) {
  return isComplete(set) && !isPlannedSuggestion(set);
}

/** A set confirmed in flow mode, at the moment of the tap. */
export function flowCapturedSet(set: LoggedSetDraft, values: { reps: string; weight: string }, at: string): LoggedSetDraft {
  const next = { ...withoutCapture(set), reps: values.reps, weight: values.weight };
  return { ...next, performedAt: at, evidence: "flow", capturedValues: setCaptureKey(next) };
}

/**
 * Stamps rows that just became complete with the time they were entered, and drops
 * capture metadata from rows that are no longer complete. Untouched suggestions and
 * already-stamped rows are unchanged.
 */
export function stampSetCapture(sets: LoggedSetDraft[], at: string): LoggedSetDraft[] {
  return sets.map((set) => {
    if (!isComplete(set)) return set.performedAt || set.evidence || set.capturedValues ? withoutCapture(set) : set;
    return set.performedAt || isPlannedSuggestion(set) ? set : { ...set, performedAt: at };
  });
}

/** Evidence that no longer matches the row's values means the row was corrected by hand. */
export function finalizeSetCapture(set: LoggedSetDraft): LoggedSetDraft {
  if (!isComplete(set)) return set;
  const key = setCaptureKey(set);
  const evidence: SetEvidence = set.evidence && set.capturedValues === key ? set.evidence : "typed";
  return set.evidence === evidence && set.capturedValues === key ? set : { ...set, evidence, capturedValues: key };
}
