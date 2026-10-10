import { describe, expect, it } from "vitest";
import { createQuickWorkoutDraft, QuickWorkoutDraftController, quickWorkoutAttempt } from "./quickWorkoutDraft";
import { assertQuickWorkoutDraftReplacement } from "@/database/quickWorkoutDrafts.shared";
const attemptId = "00000000-0000-4000-8000-000000000001";
const entered = () => ({ ...createQuickWorkoutDraft("a", "kg", "2026-10-04", 1, "Biceps"),
  sets: [{ reps: "8", weight: "50" }], notes: "Observed", machineProfileId: "machine-a" });
function storage(initial: string | null = null) {
  let raw = initial;
  return { read: async () => raw, write: async (expected: string | null, next: string | null) => {
    assertQuickWorkoutDraftReplacement(raw, expected, next); raw = next;
  } };
}
describe("recoverable Quick workout input", () => {
  it("recovers exact dates, units, equipment and a frozen attempt without submitting anything", async () => {
    const draft = entered(); const pending = { ...draft, pending: quickWorkoutAttempt(draft, attemptId) };
    const persisted = storage(JSON.stringify(pending));
    const controller = new QuickWorkoutDraftController("a", persisted);
    expect(await controller.load()).toEqual(pending);
    expect(await persisted.read()).toBe(JSON.stringify(pending));
  });
  it("rejects inconsistent recovered values instead of displaying one entry and retrying another", async () => {
    const draft = entered(); const raw = JSON.stringify({ ...draft, pending: { ...quickWorkoutAttempt(draft, attemptId), notes: "Different" } });
    const persisted = storage(raw); const controller = new QuickWorkoutDraftController("a", persisted);
    await expect(controller.load()).rejects.toThrow(/inconsistent.*preserved/i);
    await expect(controller.save(entered())).rejects.toThrow(/existing values are preserved/i);
    expect(await persisted.read()).toBe(raw);
  });
  it("does not adopt another account's copied recovery payload", async () => {
    const persisted = storage(JSON.stringify(entered()));
    await expect(new QuickWorkoutDraftController("b", persisted).load()).rejects.toThrow(/preserved/i);
    expect(await persisted.read()).toContain('"accountId":"a"');
  });
  it("preserves unreadable stored evidence and never overwrites it from an unloaded controller", async () => {
    const persisted = storage("{damaged"); const controller = new QuickWorkoutDraftController("a", persisted);
    await expect(controller.load()).rejects.toThrow(/preserved/i);
    await expect(controller.save(null)).rejects.toThrow(/existing values are preserved/i);
    expect(await persisted.read()).toBe("{damaged");
  });
  it("serializes fast input changes in order so suspension recovery uses the latest value", async () => {
    const persisted = storage(); const controller = new QuickWorkoutDraftController("a", persisted);
    await controller.load();
    await Promise.all([controller.save(entered()), controller.save({ ...entered(), notes: "Latest" })]);
    expect(await new QuickWorkoutDraftController("a", persisted).load()).toMatchObject({ notes: "Latest" });
  });
  it("rejects stale cross-tab cleanup and preserves the newer saved input", async () => {
    const persisted = storage(JSON.stringify(entered()));
    const old = new QuickWorkoutDraftController("a", persisted); const newer = new QuickWorkoutDraftController("a", persisted);
    await old.load(); await newer.load(); await newer.save({ ...entered(), notes: "Newer tab" });
    await expect(old.save(null)).rejects.toThrow(/newer Quick workout draft/i);
    expect(await new QuickWorkoutDraftController("a", persisted).load()).toMatchObject({ notes: "Newer tab" });
  });
  it("rejects inconsistent writes before replacing previously recoverable input", async () => {
    const persisted = storage(JSON.stringify(entered())); const controller = new QuickWorkoutDraftController("a", persisted);
    await controller.load();
    const invalid = { ...entered(), pending: { ...quickWorkoutAttempt(entered(), attemptId), notes: "Different" } };
    await expect(controller.save(invalid)).rejects.toThrow(/saved values are preserved/i);
    expect(await persisted.read()).toBe(JSON.stringify(entered()));
  });
});
