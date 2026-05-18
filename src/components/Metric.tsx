import { StyleSheet, View } from "react-native";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react-native";

import { Body, Label, SectionTitle } from "@/components/Text";
import { MuscleSummary } from "@/types";
import { palette, spacing } from "@/utils/theme";

export function MuscleMetric({ summary }: { summary: MuscleSummary }) {
  const color = summary.trend === "Increasing" ? palette.success : summary.trend === "Decreasing" ? palette.danger : palette.warning;
  const Icon = summary.trend === "Increasing" ? ArrowUp : summary.trend === "Decreasing" ? ArrowDown : ArrowRight;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Label>{summary.muscle}</Label>
        <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
          <Icon size={15} color={color} />
          <Body style={{ color, fontWeight: "800" }}>{summary.percentChange >= 0 ? "+" : ""}{summary.percentChange.toFixed(1)}%</Body>
        </View>
      </View>
      <SectionTitle>{Math.round(summary.score * 100)} score</SectionTitle>
      <Body numberOfLines={1}>{summary.contributors.join(", ") || "No configured exercises"}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "48%",
    minWidth: 154,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  badge: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 3
  }
});
