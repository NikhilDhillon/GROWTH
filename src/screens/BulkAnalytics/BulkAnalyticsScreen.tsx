import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { BulkAnalyticsInput, calculateBulkAnalytics } from "@/services/analytics/bulkAnalyticsService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BulkAnalyticsRange, BulkAnalyticsScope, MuscleGroup } from "@/types";
import { formatShortDate } from "@/utils/date";
import { muscles, palette, spacing } from "@/utils/theme";
import { weightFromStorageUnit } from "@/utils/units";

const ranges: BulkAnalyticsRange[] = ["7d", "14d", "30d", "60d", "90d", "all"];
const scopeKinds = ["overall", "muscle", "exercise"] as const;

export function BulkAnalyticsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const musclePoints = useFitnessStore((state) => state.musclePoints);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const [range, setRange] = useState<BulkAnalyticsRange>("30d");
  const [scopeKind, setScopeKind] = useState<(typeof scopeKinds)[number]>("overall");
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>("Chest");
  const [exerciseId, setExerciseId] = useState(strengthExercises[0]?.id ?? 0);
  const selectedExercise = strengthExercises.find((exercise) => exercise.id === exerciseId) ?? strengthExercises[0];
  const scope = buildScope(scopeKind, muscleGroup, selectedExercise?.id);
  const analytics = useMemo(() => {
    if (!scope) return null;
    return calculateBulkAnalytics({ ...scope, range, bodyWeightLogs, exercisePoints, musclePoints });
  }, [bodyWeightLogs, exercisePoints, musclePoints, range, scope]);

  const bodyweightDelta = analytics?.previousBodyweight !== null && analytics?.currentBodyweight !== null
    ? weightFromStorageUnit((analytics?.currentBodyweight ?? 0) - (analytics?.previousBodyweight ?? 0), unitSystem)
    : null;
  const absoluteTrend = analytics?.trend
    .filter((point) => point.absoluteStrength !== null)
    .map((point) => ({ label: formatShortDate(point.date), value: point.absoluteStrength ?? 0 })) ?? [];
  const bodyweightTrend = analytics?.trend
    .filter((point) => point.bodyweight !== null)
    .map((point) => ({ label: formatShortDate(point.date), value: weightFromStorageUnit(point.bodyweight ?? 0, unitSystem) })) ?? [];
  const relativeTrend = analytics?.trend
    .filter((point) => point.relativeStrength !== null)
    .map((point) => ({ label: formatShortDate(point.date), value: point.relativeStrength ?? 0 })) ?? [];
  const efficiencyTrend = analytics?.trend
    .filter((point) => point.bulkEfficiency !== null)
    .map((point) => ({ label: formatShortDate(point.date), value: point.bulkEfficiency ?? 0 })) ?? [];

  return (
    <Screen>
      <View>
        <Label>Was the weight gain useful?</Label>
        <Title>Bulk Analytics</Title>
      </View>

      <Panel>
        <SectionTitle>Range</SectionTitle>
        <View style={styles.chipRow}>
          {ranges.map((item) => (
            <Pressable key={item} onPress={() => setRange(item)} style={[styles.chip, range === item && styles.chipActive]}>
              <Body style={[styles.chipText, range === item && styles.chipTextActive]}>{item === "all" ? "All" : item}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>

      <Panel>
        <SectionTitle>Scope</SectionTitle>
        <View style={styles.segmentRow}>
          {scopeKinds.map((kind) => (
            <Pressable key={kind} onPress={() => setScopeKind(kind)} style={[styles.segmentButton, scopeKind === kind && styles.segmentButtonActive]}>
              <Body style={[styles.segmentText, scopeKind === kind && styles.segmentTextActive]}>{labelScope(kind)}</Body>
            </Pressable>
          ))}
        </View>
        {scopeKind === "muscle" ? (
          <View style={styles.chipRow}>
            {muscles.map((muscle) => (
              <Pressable key={muscle} onPress={() => setMuscleGroup(muscle)} style={[styles.chip, muscleGroup === muscle && styles.chipActive]}>
                <Body style={[styles.chipText, muscleGroup === muscle && styles.chipTextActive]}>{muscle}</Body>
              </Pressable>
            ))}
          </View>
        ) : null}
        {scopeKind === "exercise" ? (
          <View style={styles.chipRow}>
            {strengthExercises.map((exercise) => (
              <Pressable key={exercise.id} onPress={() => setExerciseId(exercise.id)} style={[styles.chip, selectedExercise?.id === exercise.id && styles.chipActive]}>
                <Body style={[styles.chipText, selectedExercise?.id === exercise.id && styles.chipTextActive]}>{exercise.name}</Body>
              </Pressable>
            ))}
            {!strengthExercises.length ? <Body>No strength exercises available.</Body> : null}
          </View>
        ) : null}
      </Panel>

      <View style={styles.cardGrid}>
        <MetricCard title="Bodyweight" value={bodyweightDelta === null ? "--" : `${bodyweightDelta >= 0 ? "+" : ""}${bodyweightDelta.toFixed(1)} ${unitSystem}`} detail={rangeLabel(range)} />
        <MetricCard title="Absolute Strength" value={formatPercent(analytics?.strengthChangePercent)} detail={analytics?.currentStrength ? `${analytics.currentStrength.toFixed(1)} pts avg` : "Strength data required"} />
        <MetricCard title="Relative Strength" value={formatPercent(analytics?.relativeStrengthChangePercent)} detail={analytics?.relativeStrength ? `${analytics.relativeStrength.toFixed(3)} current` : "Bodyweight data required"} />
        <MetricCard title="Bulk Efficiency" value={analytics?.bulkEfficiency === null || analytics?.bulkEfficiency === undefined ? "--" : analytics.bulkEfficiency.toFixed(2)} detail={`Status: ${analytics?.status ?? "Bodyweight data required"}`} />
      </View>

      <Panel>
        <SectionTitle>Insight</SectionTitle>
        <Body>{analytics?.insight ?? "Bodyweight and strength data required."}</Body>
      </Panel>

      <Panel>
        <SectionTitle>Trends</SectionTitle>
        <Label>Bodyweight</Label>
        <LineGraph points={bodyweightTrend} suffix={` ${unitSystem}`} height={150} emptyMessage="Bodyweight data required." />
        <Label>Absolute strength</Label>
        <LineGraph points={absoluteTrend} suffix=" pts" height={150} emptyMessage="Strength data required." />
        <Label>Relative strength</Label>
        <LineGraph points={relativeTrend} height={150} emptyMessage="Bodyweight data required." />
        <Label>Bulk efficiency</Label>
        <LineGraph points={efficiencyTrend} height={150} emptyMessage="Bodyweight change too small to calculate bulk efficiency." />
      </Panel>
    </Screen>
  );
}

function buildScope(kind: "overall" | "muscle" | "exercise", muscleGroup: MuscleGroup, exerciseId?: number): BulkAnalyticsScope | null {
  if (kind === "overall") return { scope: "overall" };
  if (kind === "muscle") return { scope: "muscle", muscleGroup };
  if (!exerciseId) return null;
  return { scope: "exercise", exerciseId };
}

function labelScope(kind: string) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function rangeLabel(range: BulkAnalyticsRange) {
  return range === "all" ? "all time" : `this ${range}`;
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "--";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Panel style={styles.metricCard}>
      <Label>{title}</Label>
      <SectionTitle style={styles.metricValue}>{value}</SectionTitle>
      <Body>{detail}</Body>
    </Panel>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: palette.surface
  },
  chipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  chipText: {
    color: palette.ink,
    fontWeight: "800"
  },
  chipTextActive: {
    color: palette.surface
  },
  segmentRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  segmentButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  segmentText: {
    color: palette.ink,
    fontWeight: "900",
    textAlign: "center"
  },
  segmentTextActive: {
    color: palette.surface
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 128
  },
  metricValue: {
    fontSize: 24
  }
});
