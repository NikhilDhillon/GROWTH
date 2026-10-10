import { ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";

import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";

/**
 * Render inside a transparent Modal. The backdrop dims while the opaque sheet
 * slides up from the bottom edge; tapping anywhere outside the sheet closes it.
 */
export function BottomSheet({ title, eyebrow, closeLabel, onClose, disabled = false, children }: {
  title: string;
  eyebrow?: string;
  closeLabel?: string;
  onClose: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { palette, styles } = useStyles();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  }, [progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [480, 0] });
  const label = closeLabel ?? `Close ${title}`;
  return (
    <View style={styles.layer}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md), transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text style={styles.title}>{title}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} hitSlop={touchHitSlop} onPress={onClose} style={pressableFeedback(styles.close)}>
            <X size={20} color={palette.ink} />
          </Pressable>
        </View>
        <View style={styles.content}>{children}</View>
      </Animated.View>
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: "flex-end"
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.overlay
  },
  sheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "88%",
    alignSelf: "center",
    backgroundColor: palette.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: palette.border,
    paddingTop: spacing.sm
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.border,
    marginBottom: spacing.xs
  },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  eyebrow: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 2,
    flexShrink: 1
  }
}));
