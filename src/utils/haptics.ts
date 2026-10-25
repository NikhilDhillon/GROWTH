import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Light physical feedback for the flow mode dial. Native apps use the system
 * haptic engine. Browsers vibrate where they can (Android); iPhone Safari has no
 * vibration API, but iOS 18 plays a system tick when a switch control toggles,
 * so a hidden one is toggled instead. Every path fails silently.
 */
export function tickHaptic() {
  if (Platform.OS !== "web") {
    void Haptics.selectionAsync().catch(() => undefined);
    return;
  }
  webHaptic(6);
}

/** A firmer tap for logging a set. */
export function confirmHaptic() {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    return;
  }
  webHaptic(14);
}

function webHaptic(milliseconds: number) {
  if (typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(milliseconds);
      return;
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && typeof document !== "undefined") {
      const label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.display = "none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      label.remove();
    }
  } catch {
    // Haptics are a nicety; never let them interrupt logging.
  }
}
