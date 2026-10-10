import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureDraftConflictError, captureDraftKey } from "./captureDrafts.shared";
import { readBodyCheckInDraft, writeBodyCheckInDraft } from "./captureDrafts.web";
let data: Map<string, string>;
beforeEach(() => {
  data = new Map(); let queue = Promise.resolve();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.stubGlobal("navigator", { locks: { request: (_key: string, operation: () => void) => { const next = queue.then(operation); queue = next.catch(() => undefined); return next; } } });
});
afterEach(() => vi.unstubAllGlobals());
describe("browser body capture recovery storage", () => {
  it("isolates account IDs, including differently typed IDs", async () => {
    await writeBodyCheckInDraft(1, null, "numeric"); await writeBodyCheckInDraft("1", null, "string"); await writeBodyCheckInDraft("user-b", null, "other");
    expect(await readBodyCheckInDraft(1)).toBe("numeric"); expect(await readBodyCheckInDraft("1")).toBe("string"); expect(await readBodyCheckInDraft("user-b")).toBe("other");
  });
  it("rejects two tabs replacing the same baseline and preserves the winner", async () => {
    const outcomes = await Promise.allSettled([writeBodyCheckInDraft("a", null, "first"), writeBodyCheckInDraft("a", null, "second")]);
    expect(outcomes[0].status).toBe("fulfilled"); expect(outcomes[1]).toMatchObject({ status: "rejected", reason: expect.any(CaptureDraftConflictError) });
    expect(await readBodyCheckInDraft("a")).toBe("first");
  });
  it("rejects stale cleanup without erasing the newer draft", async () => {
    data.set(captureDraftKey("a"), "new");
    await expect(writeBodyCheckInDraft("a", "old", null)).rejects.toBeInstanceOf(CaptureDraftConflictError);
    expect(await readBodyCheckInDraft("a")).toBe("new");
  });
  it("reports quota failure and retains the previous recoverable form", async () => {
    data.set(captureDraftKey("a"), "old");
    vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: () => { throw new Error("Quota exceeded"); } });
    await expect(writeBodyCheckInDraft("a", "old", "new")).rejects.toThrow("Quota exceeded");
    expect(await readBodyCheckInDraft("a")).toBe("old");
  });
  it("fails truthfully when cross-tab locking is unsupported", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeBodyCheckInDraft("a", null, "new")).rejects.toThrow(/cannot safely save/);
    expect(data.size).toBe(0);
  });
});
