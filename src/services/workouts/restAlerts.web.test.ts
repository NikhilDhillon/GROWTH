import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptics", () => ({ confirmHaptic: vi.fn() }));

const start = Date.parse("2026-10-25T10:30:00.000Z");
const alert = { endsAt: start + 90_000, seconds: 90, detail: "Next: Bench press set 2 · 100 lb × 8", doneDetail: "Bench press set 2 · 100 lb × 8" };

let page: { visibilityState: string; listeners: (() => void)[] };
let shown: { title: string; options: NotificationOptions }[];
let closed: number;
let tones: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  shown = [];
  closed = 0;
  tones = 0;
  page = { visibilityState: "visible", listeners: [] };
  vi.stubGlobal("document", {
    get visibilityState() { return page.visibilityState; },
    addEventListener: (_event: string, listener: () => void) => page.listeners.push(listener)
  });
  const registration = {
    showNotification: async (title: string, options: NotificationOptions) => { shown.push({ title, options }); },
    getNotifications: async () => shown.map(() => ({ close: () => { closed += 1; } }))
  };
  vi.stubGlobal("navigator", { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } });
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
  class FakeAudio {
    state = "running";
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createOscillator() { tones += 1; return { type: "", frequency: {}, connect: (node: unknown) => node, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node: unknown) => node }; }
  }
  vi.stubGlobal("AudioContext", FakeAudio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load() {
  const alerts = await import("./restAlerts.web");
  alerts.primeRestAlerts();
  return alerts;
}

function setVisibility(state: string) {
  page.visibilityState = state;
  page.listeners.forEach((listener) => listener());
}

describe("browser rest alerts", () => {
  it("chimes when the rest ends with GROWTH on screen, and posts nothing", async () => {
    const { showRestAlert } = await load();
    showRestAlert(alert);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(tones).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tones).toBe(2);
    expect(shown).toEqual([]);
  });

  it("leaves a quiet resting notice when GROWTH leaves the screen, then replaces it when the rest ends", async () => {
    const { showRestAlert } = await load();
    showRestAlert(alert);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(shown[0]).toMatchObject({ title: expect.stringMatching(/^Resting until /), options: { body: alert.detail, tag: "growth-rest", silent: true } });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(shown[1]).toMatchObject({ title: "Rest's over", options: { body: alert.doneDetail, tag: "growth-rest", silent: false } });
    expect(tones).toBe(0);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBeGreaterThan(0);
  });

  it("stays quiet when the page was frozen past the end", async () => {
    const { showRestAlert } = await load();
    showRestAlert(alert);
    vi.setSystemTime(alert.endsAt + 60_000);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tones).toBe(0);
    expect(shown).toEqual([]);
  });

  it("forgets a skipped rest", async () => {
    const { clearRestAlert, showRestAlert } = await load();
    showRestAlert(alert);
    clearRestAlert();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tones).toBe(0);
    expect(shown).toEqual([]);
  });

  it("only uses notifications once they are allowed", async () => {
    vi.stubGlobal("Notification", { permission: "denied", requestPermission: vi.fn() });
    const { showRestAlert } = await load();
    showRestAlert(alert);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(shown).toEqual([]);
  });
});
