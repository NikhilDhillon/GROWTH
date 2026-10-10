import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void> }));
const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/database/reportContext", () => ({ readReportContext: storage.read, writeReportContext: storage.write }));
vi.mock("react", () => ({
  useState(initial: unknown) { const i = harness.cursor++; if (!(i in harness.slots)) harness.slots[i] = initial; return [harness.slots[i], (next: unknown) => { harness.slots[i] = next; }]; },
  useRef(initial: unknown) { const i = harness.cursor++; return harness.slots[i] ??= { current: initial }; },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) { const i = harness.cursor++; const old = harness.slots[i]; if (!old || deps.some((v, n) => !Object.is(v, old.deps[n]))) harness.effects.push(() => { old?.cleanup?.(); harness.slots[i] = { deps, cleanup: effect() }; }); }
}));
import { useReportContext } from "./useReportContext";
const defaults = { exerciseId: 1 };
const valid = (v: unknown): v is typeof defaults => !!v && typeof v === "object" && Number.isSafeInteger((v as typeof defaults).exerciseId);
function render(account: string | number = "a") { harness.cursor = 0; harness.effects = []; const hook = useReportContext(account, "test", defaults, valid); harness.effects.forEach((e) => e()); return hook; }
beforeEach(() => { harness.slots = []; storage.read.mockReset().mockResolvedValue(null); storage.write.mockReset().mockResolvedValue(undefined); });
afterEach(() => harness.slots.forEach((v) => v?.cleanup?.()));
describe("report selections survive navigation without becoming observation state", () => {
  it("restores a validated selection without writing or submitting anything", async () => { storage.read.mockResolvedValue(JSON.stringify({ exerciseId: 9 })); render(); await vi.waitFor(() => expect(render().value.exerciseId).toBe(9)); expect(storage.write).not.toHaveBeenCalled(); });
  it("does not let a late restore replace a user's newer selection", async () => { let resolve!: (value: string) => void; storage.read.mockReturnValue(new Promise<string>((done) => resolve = done)); render().update({ exerciseId: 5 }); resolve(JSON.stringify({ exerciseId: 9 })); await Promise.resolve(); expect(render().value.exerciseId).toBe(5); });
  it("hides another account's selection and ignores its stale callbacks", async () => { storage.read.mockResolvedValue(JSON.stringify({ exerciseId: 9 })); render(); await vi.waitFor(() => expect(render().value.exerciseId).toBe(9)); const old = render(); storage.read.mockResolvedValue(null); expect(render("b").value.exerciseId).toBe(1); old.update({ exerciseId: 99 }); await Promise.resolve(); expect(render("b").value.exerciseId).toBe(1); expect(storage.write).not.toHaveBeenCalled(); });
  it("serializes rapid selections and writes account-separated keys", async () => { const hook = render(); hook.update({ exerciseId: 3 }); hook.update({ exerciseId: 4 }); await vi.waitFor(() => expect(storage.write).toHaveBeenCalledTimes(2)); expect(storage.write.mock.calls.map((call) => JSON.parse(call[1]).exerciseId)).toEqual([3, 4]); expect(storage.write.mock.calls[0][0]).toContain("string:a:test"); });
  it("keeps the interactive selection usable when preference storage fails", async () => { storage.write.mockRejectedValue(new Error("Quota")); render().update({ exerciseId: 7 }); await vi.waitFor(() => expect(render().error).toMatch(/could not be saved/)); expect(render().value.exerciseId).toBe(7); });
  it("does not restore malformed or unsupported selection values", async () => { storage.read.mockResolvedValue('{"exerciseId":"bad"}'); render(); await Promise.resolve(); expect(render().value).toEqual(defaults); expect(storage.write).not.toHaveBeenCalled(); });
});
