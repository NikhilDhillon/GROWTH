import { Pressable, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { palette, spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

export type ProgressTab = "overview" | "strength" | "body";

const tabs: Array<{ key: ProgressTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "strength", label: "Strength" },
  { key: "body", label: "Body" }
];

export function ProgressTabs({ value, onChange }: { value: ProgressTab; onChange: (tab: ProgressTab) => void }) {
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

const styles = StyleSheet.create({
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
    minHeight: 42,
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
});
