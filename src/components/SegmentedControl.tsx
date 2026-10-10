import { Pressable, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

export type SegmentOption<T extends string> = { key: T; label: string; accessibilityLabel?: string };

/**
 * Equal-width segments on one track, so neighbouring selectors share edges and
 * never wrap into ragged rows. "pills" is the quieter chart-range variant.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "track",
  accessibilityLabel
}: {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  variant?: "track" | "pills";
  accessibilityLabel?: string;
}) {
  const { styles } = useStyles();
  const pills = variant === "pills";
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={pills ? styles.pillRow : styles.track}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={pressableFeedback([pills ? styles.pill : styles.segment, selected && (pills ? styles.pillActive : styles.segmentActive)])}
          >
            <Body numberOfLines={1} style={[pills ? styles.pillText : styles.segmentText, selected && (pills ? styles.pillTextActive : styles.segmentTextActive)]}>{option.label}</Body>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  track: {
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    borderWidth: 1,
    borderColor: palette.border
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs
  },
  segmentActive: {
    backgroundColor: palette.ink
  },
  segmentText: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: "700"
  },
  segmentTextActive: {
    color: palette.surface
  },
  pillRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs
  },
  pill: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs
  },
  pillActive: {
    backgroundColor: palette.accentSoft
  },
  pillText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  pillTextActive: {
    color: palette.ink
  }
}));
