import { ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";

import { Body } from "@/components/Text";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatElapsedWorkoutTime } from "@/utils/workout";

/**
 * Flow mode's whole screen: no app header or navigation, only a close button,
 * the workout clock and progress. Content fades in whenever its step changes.
 */
export function FocusShell({ startedAt, now, position, closeLabel = "Workout options", onClose, stepKey, children }: {
  startedAt: string;
  now: number;
  /** "2 / 4" exercises, when there is a plan. */
  position?: string | null;
  closeLabel?: string;
  onClose: () => void;
  /** Changing it fades the content in again, e.g. on a new exercise. */
  stepKey: string;
  children: ReactNode;
}) {
  const { palette, styles } = useStyles();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  }, [opacity, stepKey]);
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={touchHitSlop} onPress={onClose} style={pressableFeedback(styles.close)}>
          <X size={18} color={palette.ink} />
        </Pressable>
        <Body style={styles.clock}>{formatElapsedWorkoutTime(startedAt, now)}</Body>
        <Body style={styles.position}>{position ?? ""}</Body>
      </View>
      <Animated.View style={[styles.content, { opacity }]}>{children}</Animated.View>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, minHeight: 52 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt },
  clock: { color: palette.muted, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  position: { minWidth: 36, textAlign: "right", color: palette.muted, fontSize: 14, fontWeight: "700" },
  content: { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md }
}));
