import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

async function load() { return (await import("./webLocks")).webLocks; }

describe("web lock selection", () => {
  it("uses the browser's Web Locks whenever they exist", async () => {
    const locks = { request: vi.fn() };
    vi.stubGlobal("navigator", { locks });
    expect((await load())()).toBe(locks);
  });

  it("refuses to write without Web Locks outside development, even on an insecure page", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { isSecureContext: false });
    expect((await load())()).toBeNull();
  });

  it("queues saves within the page on an insecure development page", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("__DEV__", true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const locks = (await load())()!;
    const order: string[] = [];
    let release!: () => void;
    const first = locks.request("db", () => new Promise<void>((resolve) => { release = () => { order.push("first"); resolve(); }; }));
    const second = locks.request("db", () => { order.push("second"); });
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("queues within the phone app, which has a single page, even in a release build", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubEnv("EXPO_OS", "android");
    const locks = (await load())()!;
    const order: string[] = [];
    await Promise.all([locks.request("db", async () => { await Promise.resolve(); order.push("first"); }), locks.request("db", () => { order.push("second"); })]);
    expect(order).toEqual(["first", "second"]);
  });

  it("still refuses a secure page without Web Locks in development", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("__DEV__", true);
    expect((await load())()).toBeNull();
  });
});
