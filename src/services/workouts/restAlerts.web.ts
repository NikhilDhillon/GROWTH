import { confirmHaptic } from "@/utils/haptics";
import type { RestAlert } from "./restAlerts";

export type { RestAlert } from "./restAlerts";

/**
 * The website's rest alerts. A browser stops running the page once the phone is
 * locked or the app is put away (an iPhone does so at once), so this does what a
 * page can: when GROWTH leaves the screen during a rest it leaves a "Resting until
 * 10:32" notice, and when the rest ends it plays a soft chime if GROWTH is on
 * screen, or replaces the notice with "Rest's over" if the page is still running
 * in the background. Notifications need permission, and on iPhone the home-screen app.
 */
const tag = "growth-rest";
/** A timer this late was frozen with the page; the moment for an alert has passed. */
const lateMs = 3000;

let current: { alert: RestAlert; timer: ReturnType<typeof setTimeout> } | null = null;
let audio: AudioContext | null = null;
let worker: Promise<ServiceWorkerRegistration | null> | null = null;
let listening = false;

/** Called from the tap that logs a set: browsers allow sound, and the notification prompt, only after a tap. */
export function primeRestAlerts() {
  try {
    const Context = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context) {
      audio ??= new Context();
      void audio.resume().catch(() => undefined);
    }
  } catch {
    // Without sound the rest view still shows the end.
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission().catch(() => undefined);
  }
  void registration();
}

export function showRestAlert(alert: RestAlert) {
  if (current) clearTimeout(current.timer);
  current = { alert, timer: setTimeout(() => restOver(alert), Math.max(0, alert.endsAt - Date.now())) };
  if (!listening && typeof document !== "undefined") {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") void closeNotices();
      else if (current) void notify(`Resting until ${clockTime(current.alert.endsAt)}`, current.alert.detail, true);
    });
  }
}

export function clearRestAlert() {
  if (current) clearTimeout(current.timer);
  current = null;
  void closeNotices();
}

function restOver(alert: RestAlert) {
  if (current?.alert !== alert) return;
  current = null;
  if (Date.now() - alert.endsAt > lateMs) return;
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    chime();
    confirmHaptic();
  } else {
    void notify("Rest's over", alert.doneDetail, false);
  }
}

/** Two soft rising notes, about half a second. */
function chime() {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime + 0.02;
  for (const [frequency, offset] of [[659.25, 0], [880, 0.16]]) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.5);
    tone.connect(gain).connect(audio.destination);
    tone.start(start + offset);
    tone.stop(start + offset + 0.55);
  }
}

async function notify(title: string, body: string, silent: boolean) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    // The same tag replaces the resting notice; renotify makes the replacement alert.
    await (await registration())?.showNotification(title, { body, tag, silent, renotify: !silent, icon: "/icon-192.png" } as NotificationOptions);
  } catch {
    // A missing notification never interrupts the workout.
  }
}

async function closeNotices() {
  try {
    for (const notice of await (await registration())?.getNotifications({ tag }) ?? []) notice.close();
  } catch {
    // Nothing to close.
  }
}

function registration() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return Promise.resolve(null);
  worker ??= navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).catch(() => null);
  return worker;
}

function clockTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
