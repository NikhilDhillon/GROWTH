import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readQuickWorkoutDraft, writeQuickWorkoutDraft } from "./quickWorkoutDrafts.web";
import { quickWorkoutDraftKey } from "./quickWorkoutDrafts.shared";
let data: Map<string, string>;
beforeEach(() => {
  data = new Map(); let queue = Promise.resolve();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, next: string) => data.set(key, next), removeItem: (key: string) => data.delete(key) });
  vi.stubGlobal("navigator", { locks: { request: (_key: string, action: () => void) => { const result = queue.then(action); queue = result.catch(() => undefined); return result; } } });
});
afterEach(() => vi.unstubAllGlobals());
describe("browser Quick workout recovery", () => {
  it("isolates accounts and leaves body recovery evidence untouched", async () => {
    data.set("growth.body-capture.v1:string:a", "body evidence");
    await writeQuickWorkoutDraft("a", null, "first"); await writeQuickWorkoutDraft("b", null, "second");
    expect(await readQuickWorkoutDraft("a")).toBe("first"); expect(await readQuickWorkoutDraft("b")).toBe("second");
    expect(data.get("growth.body-capture.v1:string:a")).toBe("body evidence");
  });
  it("accepts only one of two tabs writing a different draft from the same baseline", async () => {
    const results = await Promise.allSettled([writeQuickWorkoutDraft("a", null, "first"), writeQuickWorkoutDraft("a", null, "second")]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("rejected");
    expect(await readQuickWorkoutDraft("a")).toBe("first");
  });
  it("preserves the last saved draft when local storage rejects a replacement", async () => {
    data.set(quickWorkoutDraftKey("a"), "saved");
    vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: () => { throw new Error("Quota exceeded"); } });
    await expect(writeQuickWorkoutDraft("a", "saved", "entered")).rejects.toThrow("Quota exceeded");
    expect(await readQuickWorkoutDraft("a")).toBe("saved");
  });
  it("refuses uncoordinated recording prerequisites when Web Locks are unsupported", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeQuickWorkoutDraft("a", null, "entered")).rejects.toThrow(/cannot safely preserve/i);
    expect(data.size).toBe(0);
  });
});
