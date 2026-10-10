import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void> }));
const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/database/quickWorkoutDrafts", () => ({ readQuickWorkoutDraft: storage.read, writeQuickWorkoutDraft: storage.write }));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === "function" ? next(harness.slots[index]) : next; }];
  },
  useRef(initial: unknown) { const index = harness.cursor++; return harness.slots[index] ??= { current: initial }; },
  useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
    const index = harness.cursor++; const previous = harness.slots[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      harness.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); harness.slots[index] = { dependencies, cleanup }; });
    }
  }
}));
import { assertQuickWorkoutDraftReplacement } from "@/database/quickWorkoutDrafts.shared";
import { createQuickWorkoutDraft } from "@/services/workouts/quickWorkoutDraft";
import { quickWorkoutAttempt } from "@/services/workouts/quickWorkoutDraft";
import { useQuickWorkoutDraft } from "./useQuickWorkoutDraft";
const defaults = createQuickWorkoutDraft("a", "lb", "2026-10-09", 1, "Biceps");
let raw: Map<string | number, string>;
function render(account: string | number = "a") {
  harness.cursor = 0; harness.effects = [];
  const hook = useQuickWorkoutDraft(account, { ...defaults, accountId: String(account) });
  harness.effects.forEach((effect) => effect()); return hook;
}
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; raw = new Map();
  storage.read.mockReset().mockImplementation(async (account: string | number) => raw.get(account) ?? null);
  storage.write.mockReset().mockImplementation(async (account: string | number, expected: string | null, next: string | null) => {
    assertQuickWorkoutDraftReplacement(raw.get(account) ?? null, expected, next);
    if (next === null) raw.delete(account); else raw.set(account, next);
  });
});
afterEach(() => { harness.slots.forEach((slot) => slot?.cleanup?.()); });

describe("Quick workout draft account lifecycle", () => {
  it("gates recording until recovery loads and does not submit recovered pending input", async () => {
    const draft = { ...defaults, sets: [{ reps: "8", weight: "80" }], unitSystem: "kg" as const };
    const recovered = { ...draft, pending: quickWorkoutAttempt(draft, "00000000-0000-4000-8000-000000000001") };
    raw.set("a", JSON.stringify(recovered));
    expect(render().ready).toBe(false);
    await vi.waitFor(() => expect(render().ready).toBe(true));
    expect(render().draft).toEqual(recovered);
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("keeps pending receipt evidence after a failed clear and retries cleanup", async () => {
    render(); await vi.waitFor(() => expect(render().ready).toBe(true));
    const value = { ...defaults, sets: [{ reps: "8", weight: "175" }] };
    await render().flushDraft(value);
    storage.write.mockRejectedValueOnce(new Error("Quota"));
    await expect(render().clearDraft()).rejects.toThrow("Quota");
    expect(render().draft.sets[0].weight).toBe("175"); expect(raw.has("a")).toBe(true);
    await render().clearDraft(); expect(render().draft).toEqual(defaults); expect(raw.has("a")).toBe(false);
  });

  it("hides the previous account's input and rejects its stale callbacks during a switch", async () => {
    raw.set("a", JSON.stringify({ ...defaults, sets: [{ reps: "8", weight: "180" }] }));
    render(); await vi.waitFor(() => expect(render().ready).toBe(true));
    const old = render();
    let resolve!: (value: string | null) => void;
    storage.read.mockImplementationOnce(() => new Promise<string | null>((complete) => { resolve = complete; }));
    const switching = render("b");
    expect(switching.ready).toBe(false); expect(switching.draft.sets[0].weight).toBe("");
    old.setDraft({ ...defaults, sets: [{ reps: "8", weight: "999" }] });
    await expect(old.flushDraft()).rejects.toThrow(/Wait/);
    resolve(null); await vi.waitFor(() => expect(render("b").ready).toBe(true));
    expect(raw.get("a")).toContain('"weight":"180"'); expect(raw.has("b")).toBe(false);
    expect(render("b").draft.sets[0].weight).toBe("");
  });

  it("preserves malformed recovery data and exposes a truthful retry state", async () => {
    raw.set("a", "{damaged"); render();
    await vi.waitFor(() => expect(render().recoveryError).toMatch(/preserved/));
    expect(render().ready).toBe(false); expect(raw.get("a")).toBe("{damaged");
    await expect(render().flushDraft({ ...defaults, sets: [{ reps: "8", weight: "175" }] })).rejects.toThrow(/Wait/);
    expect(storage.write).not.toHaveBeenCalled();
  });
});
