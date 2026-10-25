import { PermissionsAndroid, Platform } from "react-native";

import RestTimer from "../../../modules/rest-timer";
import type { RestAlert } from "./restAlerts";

export type { RestAlert } from "./restAlerts";

let askedForNotifications = false;

/** Shows the rest countdown in the notification shade, or updates it after the ring is wound. */
export function showRestAlert(alert: RestAlert) {
  if (!RestTimer) return;
  RestTimer.start(alert.endsAt, alert.seconds, "Resting", alert.detail, "Rest's over", alert.doneDetail);
  // Android 13 and later ask once, the first time a rest starts; the countdown appears as soon as it is allowed.
  if (!askedForNotifications && Number(Platform.Version) >= 33) {
    askedForNotifications = true;
    void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
}

export function clearRestAlert() {
  RestTimer?.stop();
}
