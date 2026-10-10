import { Pressable, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

export type ProgressTab = "overview" | "strength" | "body" | "bulk";

const tabs: Array<{ key: ProgressTab; label: string }> = [
  { key: "strength", label: "Strength" },
  { key: "body", label: "Body" }
];

export function ProgressTabs({ value, onChange }: { value: ProgressTab; onChange: (tab: ProgressTab) => void }) {
  const { palette, styles } = useStyles();
  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {tabs.map((tab) => {
        const selected = value === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={pressableFeedback([styles.tab, selected && styles.tabActive])}
          >
            <Body style={[styles.text, selected && styles.textActive]}>{tab.label}</Body>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    backgroundColor: palette.surfaceAlt
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  tabActive: {
    backgroundColor: palette.ink
  },
  text: {
    color: palette.ink,
    fontWeight: "900"
  },
  textActive: {
    color: palette.surface
  }
}));
