import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Body, Label } from "@/components/Text";
import { createThemedStyles } from "@/utils/themedStyles";
import { DisplaySet, groupSetsForDisplay, SessionProgress } from "@/utils/sessionDisplay";
import { spacing } from "@/utils/theme";

/**
 * One recorded exercise session: grouped sets on the left ("160 lb × 7 · 6 · 5"),
 * a rep-height bar per set for drop-off at a glance, and e1RM with its change
 * against the previous comparable session on the right. Children render as
 * trailing actions.
 */
export function SessionRow({
  title,
  caption,
  sets,
  formatLoad,
  estimated1RM,
  progress,
  formatMetric,
  metricPlacement = "side",
  children
}: {
  title: string;
  caption?: string | null;
  sets: DisplaySet[];
  formatLoad: (weight: number) => string;
  estimated1RM?: number | null;
  progress?: SessionProgress | null;
  formatMetric: (value: number) => string;
  /** "inline" keeps e1RM under the sets so narrow rows leave room for actions. */
  metricPlacement?: "side" | "inline";
  children?: ReactNode;
}) {
  const { styles } = useStyles();
  const groups = groupSetsForDisplay(sets, formatLoad);
  const maxReps = Math.max(1, ...sets.map((set) => set.reps));
  const delta = progress?.e1RMDelta ?? null;
  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Body numberOfLines={1} style={styles.title}>{title}</Body>
          {progress?.isPR ? <View style={styles.prBadge}><Body style={styles.prText}>PR</Body></View> : null}
        </View>
        {caption ? <Label numberOfLines={1}>{caption}</Label> : null}
        {groups.map((group, index) => (
          <Body key={index} style={[styles.setLine, group.warmup && styles.warmupLine]}>
            {group.warmup ? <Body style={styles.warmupTag}>Warm-up  </Body> : null}
            <Body style={[styles.load, group.warmup && styles.warmupLine]}>{group.load}</Body>
            <Body style={styles.reps}>{`  × ${group.reps.join(" · ")}`}</Body>
          </Body>
        ))}
        <View style={styles.footer}>
          <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {sets.map((set, index) => (
              <View key={index} style={[styles.bar, set.isWarmup && styles.barWarmup, { height: 4 + (set.reps / maxReps) * 10 }]} />
            ))}
          </View>
          {metricPlacement === "inline" && estimated1RM ? <Body style={styles.inlineMetric}>
            {`e1RM ${formatMetric(estimated1RM)}`}
            {delta !== null && Math.abs(delta) >= 0.05 ? <Body style={[styles.inlineDelta, delta > 0 ? styles.up : styles.down]}>{`  ${delta > 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta))}`}</Body> : null}
          </Body> : null}
        </View>
      </View>
      {metricPlacement === "side" && estimated1RM ? (
        <View style={styles.metric}>
          <Body style={styles.metricValue}>{formatMetric(estimated1RM)}</Body>
          <Label style={styles.metricLabel}>e1RM</Label>
          {delta !== null && Math.abs(delta) >= 0.05 ? (
            <Body style={[styles.delta, delta > 0 ? styles.up : styles.down]}>{`${delta > 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta))}`}</Body>
          ) : delta !== null ? <Body style={styles.flat}>= last</Body> : null}
        </View>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  title: {
    color: palette.ink,
    fontWeight: "700",
    fontSize: 15,
    flexShrink: 1
  },
  prBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: palette.success
  },
  prText: {
    color: palette.surface,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.6
  },
  setLine: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 19
  },
  warmupLine: {
    color: palette.muted
  },
  warmupTag: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  load: {
    color: palette.ink,
    fontWeight: "700",
    fontVariant: ["tabular-nums"]
  },
  reps: {
    color: palette.muted,
    fontVariant: ["tabular-nums"]
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2
  },
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    height: 14
  },
  bar: {
    width: 5,
    borderRadius: 1.5,
    backgroundColor: palette.ink,
    opacity: 0.75
  },
  barWarmup: {
    backgroundColor: palette.muted,
    opacity: 0.35
  },
  metric: {
    alignItems: "flex-end",
    gap: 1,
    minWidth: 64
  },
  metricValue: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  metricLabel: {
    fontSize: 9,
    letterSpacing: 0.8
  },
  delta: {
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"]
  },
  inlineMetric: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
    flexShrink: 1
  },
  inlineDelta: {
    fontSize: 12,
    fontWeight: "700"
  },
  up: { color: palette.success },
  down: { color: palette.danger },
  flat: {
    color: palette.muted,
    fontSize: 12
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  }
}));
