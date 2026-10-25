import { requireOptionalNativeModule } from "expo";

/**
 * Android's rest countdown: an ongoing notification the system ticks by itself, and
 * an alert when the rest is over. Times are epoch milliseconds.
 */
export type RestTimerModule = {
  start(endsAt: number, totalSeconds: number, title: string, detail: string, doneTitle: string, doneDetail: string): void;
  stop(): void;
};

export default requireOptionalNativeModule<RestTimerModule>("RestTimer");
