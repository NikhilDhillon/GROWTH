import { nativeApp } from "@/constants/site";

declare const __DEV__: boolean | undefined;

export type LockRequester = { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> };

const queues = new Map<string, Promise<unknown>>();

/** Serialises callbacks per name within this page only; it cannot coordinate other tabs. */
const inPageLocks: LockRequester = {
  request(name, callback) {
    const previous = queues.get(name) ?? Promise.resolve();
    const run = previous.then(() => callback());
    queues.set(name, run.then(() => undefined, () => undefined));
    return run;
  }
};

let warned = false;

/**
 * Browsers expose Web Locks only in secure contexts. A development server opened from a
 * phone over the local network (http://10.0.0.x) is not one, so development builds fall
 * back to an in-page queue there. Release builds and HTTPS always use real cross-tab
 * locks; without them callers refuse to write, exactly as before.
 */
export function webLocks(): LockRequester | null {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === "function") return locks as unknown as LockRequester;
  // The phone app has a single page, so queuing within it is all the locking it needs.
  if (nativeApp) return inPageLocks;
  const development = typeof __DEV__ !== "undefined" && Boolean(__DEV__);
  const insecurePage = typeof window !== "undefined" && window.isSecureContext === false;
  if (!development || !insecurePage) return null;
  if (!warned) {
    warned = true;
    console.warn("GROWTH: Web Locks are unavailable on this insecure development page. Local saves are queued within this tab only; avoid editing in two tabs at once.");
  }
  return inPageLocks;
}
