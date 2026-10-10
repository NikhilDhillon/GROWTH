import { ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { LineGraph } from "@/components/LineGraph";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { BulkAnalyticsInput, calculateBulkAnalytics } from "@/services/analytics/bulkAnalyticsService";
import { useReportContext } from "@/hooks/useReportContext";
import { SearchableExercisePicker } from "@/components/SearchableExercisePicker";
import { exerciseGrowthReport, pointContextKey } from "@/services/analytics/growthReport";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BulkAnalyticsRange, BulkAnalyticsScope, MuscleGroup } from "@/types";
import { formatShortDate, todayIso } from "@/utils/date";
import { createThemedStyles } from "@/utils/themedStyles";
import { muscles, spacing } from "@/utils/theme";
import { bodyWeightFromStorageUnit } from "@/utils/units";

const ranges: BulkAnalyticsRange[] = ["7d", "14d", "30d", "60d", "90d", "all"];
const scopeKinds = ["overall", "muscle", "exercise"] as const;

type ReportContext = { range: BulkAnalyticsRange; scopeKind: (typeof scopeKinds)[number]; muscleGroup: MuscleGroup; exerciseId: number; comparisonKey: string };
export function BulkAnalyticsScreen({ progressTabs, initialContext, onContextChange }: { progressTabs?: ReactNode; initialContext?: Partial<Omit<ReportContext, "range">> & { range?: string }; onContextChange?: (context: ReportContext) => void }) {
  const { styles } = useStyles();
  const exercises = useFitnessStore((state) => state.exercises);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const bodyWeightUnit = useFitnessStore((state) => state.bodyUnitPreferences.weight);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const musclePoints = useFitnessStore((state) => state.musclePoints);
  const account = useFitnessStore((state) => state.currentUser?.id);
  const profiles = useFitnessStore((state) => state.machineProfiles);
  const [chartMetric, setChartMetric] = useState<"performance" | "bodyweight">("performance");
  const strengthExercises = exercises;
  const context = useReportContext(account, "comparison", { range: "30d" as BulkAnalyticsRange, scopeKind: "overall" as (typeof scopeKinds)[number], muscleGroup: "Chest" as MuscleGroup, exerciseId: 0, comparisonKey: "" }, validContext);
  const { range, scopeKind, muscleGroup, exerciseId, comparisonKey } = context.value;
  function update(next: ReportContext) { context.update(next); onContextChange?.(next); }
  useEffect(() => {
    if (!initialContext || !["range", "scopeKind", "muscleGroup", "exerciseId", "comparisonKey"].some((key) => (initialContext as Record<string, unknown>)[key] !== undefined)) return;
    const next = { ...context.value, ...initialContext,
      ...(initialContext.exerciseId !== undefined && initialContext.comparisonKey === undefined ? { comparisonKey: "" } : {}),
      range: ranges.includes(initialContext.range as BulkAnalyticsRange) ? initialContext.range as BulkAnalyticsRange : context.value.range };
    if (validContext(next)) context.update(next);
  }, [initialContext?.range, initialContext?.scopeKind, initialContext?.muscleGroup, initialContext?.exerciseId, initialContext?.comparisonKey]);
  const setRange = (range: BulkAnalyticsRange) => update({ ...context.value, range });
  const setScopeKind = (scopeKind: (typeof scopeKinds)[number]) => update({ ...context.value, scopeKind });
  const setMuscleGroup = (muscleGroup: MuscleGroup) => update({ ...context.value, muscleGroup });
  const setExerciseId = (exerciseId: number) => update({ ...context.value, exerciseId, comparisonKey: exerciseGrowthReport(exercisePoints, exerciseId, undefined, todayIso()).comparisonKey ?? "" });
  const selectedExercise = strengthExercises.find((exercise) => exercise.id === exerciseId) ?? strengthExercises[0];
  const scopeTitle = scopeKind === "muscle" ? `Scope · ${muscleGroup}` : scopeKind === "exercise" ? `Scope · ${selectedExercise?.name ?? "Exercise"}` : "Scope · Overall";
  const selectedContextKey = comparisonKey || (selectedExercise && exerciseGrowthReport(exercisePoints, selectedExercise.id, undefined, todayIso()).comparisonKey) || "";
  const scope = buildScope(scopeKind, muscleGroup, selectedExercise?.id, selectedContextKey);
  const contexts = [...new Map(exercisePoints.filter((point) => point.exerciseId === selectedExercise?.id && point.comparability !== "self_context" && point.date <= todayIso()).map((point) => [pointContextKey(point), point])).entries()];
  const analytics = useMemo(() => {
    if (!scope) return null;
    return calculateBulkAnalytics({ ...scope, range, bodyWeightLogs, exercisePoints, musclePoints });
  }, [bodyWeightLogs, exercisePoints, musclePoints, range, scope]);

  const bodyweightDelta = analytics && analytics.previousBodyweight !== null && analytics.currentBodyweight !== null
    ? bodyWeightFromStorageUnit(analytics.currentBodyweight - analytics.previousBodyweight, bodyWeightUnit)
    : null;
  const absoluteTrend = analytics?.trend
    .filter((point) => point.absoluteStrength !== null)
    .map((point) => ({ date: point.date, label: formatShortDate(point.date), value: point.absoluteStrength ?? 0, details: [`Coverage ${point.coverage.availableCount}/${point.coverage.memberCount}`] })) ?? [];
  const bodyweightTrend = analytics?.trend
    .filter((point) => point.bodyweight !== null)
    .map((point) => ({ date: point.date, label: formatShortDate(point.date), value: bodyWeightFromStorageUnit(point.bodyweight ?? 0, bodyWeightUnit), details: [`Weight observed ${point.bodyweightObservationDate}; carried forward ${point.bodyweightAgeCalendarDays} calendar days`] })) ?? [];
  const relativeTrend = analytics?.trend
    .filter((point) => point.relativeStrength !== null)
    .map((point) => ({ date: point.date, label: formatShortDate(point.date), value: point.relativeStrength ?? 0 })) ?? [];
  return (
    <Screen>
      <View>
        <Label>Compare over time</Label>
        <Title>Performance & weight</Title>
      </View>
      {progressTabs}

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
        <DetailsDisclosure title={scopeTitle}>
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
          <View style={{ gap: spacing.sm }}>
            <SearchableExercisePicker exercises={strengthExercises} selectedId={selectedExercise?.id} onSelect={setExerciseId} />
            <Label>Comparable equipment context</Label>
            {contexts.map(([key, point]) => <Pressable key={key} accessibilityRole="button" style={styles.chip}
              accessibilityState={{ selected: selectedContextKey === key }} onPress={() => update({ ...context.value, comparisonKey: key })}>
              <Body>{point.machineProfileId ? profiles.find((profile) => profile.id === point.machineProfileId)?.label ?? point.machineProfileId : "External / bodyweight context"}</Body>
            </Pressable>)}
            {!contexts.length ? <Body>No comparable equipment history is available.</Body> : null}
          </View>
        ) : null}
        </DetailsDisclosure>
      </Panel>

      <Panel><View style={styles.coverageRow}><SectionTitle>Coverage</SectionTitle><SectionTitle>{analytics?.coverage.availableCount ?? 0}/{analytics?.coverage.memberCount ?? 0}</SectionTitle></View>
        <Body>{analytics?.coverage.complete ? "All fixed members are current." : "Aggregate withheld until all fixed members are current."}</Body>
        {analytics?.coverage.missing.length ? <Body>Missing: {analytics.coverage.missing.join(", ")}</Body> : null}
        {analytics?.coverage.stale.length ? <Body style={styles.notice}>Stale: {analytics.coverage.stale.join(", ")}</Body> : null}
        {analytics?.coverage.excludedCount ? <Body>{analytics.coverage.excludedCount} observations outside this cohort.</Body> : null}
        {analytics ? <DetailsDisclosure title="Comparison details">
          <Body>Current {analytics.periodStart}–{analytics.periodEnd}; previous {analytics.previousPeriodStart}–{analytics.previousPeriodEnd}. Each observed training day uses its latest eligible entry in the same fixed equipment or exercise cohort.</Body>
          <Body>Version {analytics.metricVersion}; each eligible exercise starts at 100. Relative strength is estimated 1RM divided by bodyweight for one exercise only.</Body>
          <Body>Relative strength uses a same-day or prior bodyweight observation no older than 14 calendar days. Training becomes stale after 30 days; missing or stale fixed members withhold an aggregate.</Body>
        </DetailsDisclosure> : null}
        {context.error ? <Body>{context.error}</Body> : null}
      </Panel>
      <View style={styles.cardGrid}>
        <MetricCard title="Average bodyweight" value={analytics?.currentBodyweight === null || analytics?.currentBodyweight === undefined ? "—" : `${bodyWeightFromStorageUnit(analytics.currentBodyweight, bodyWeightUnit).toFixed(1)} ${bodyWeightUnit}`} detail={bodyweightDelta === null ? "Need both periods" : `${bodyweightDelta >= 0 ? "+" : ""}${bodyweightDelta.toFixed(1)} ${bodyWeightUnit} · ${formatPercent(analytics?.bodyweightChangePercent)}`} />
        <MetricCard title="Performance" value={formatPercent(analytics?.strengthChangePercent)} detail={analytics?.currentStrength === null || analytics?.currentStrength === undefined ? "Current data unavailable" : `${analytics.currentStrength.toFixed(1)} pts · current average`} />
        <MetricCard title="Relative 1RM / weight" value={formatPercent(analytics?.relativeStrengthChangePercent)} detail={analytics?.relativeStrength === null || analytics?.relativeStrength === undefined ? analytics?.relativeStrengthAvailable ? "No fresh paired weigh-in" : "Choose one exercise" : `${analytics.relativeStrength.toFixed(3)} current ratio`} />
      </View>

      <Panel>
        <SectionTitle>{analytics?.status ?? "Comparison"}</SectionTitle>
        <Body>{analytics?.insight ?? "Bodyweight and performance data required."}</Body>
      </Panel>

      <Panel>
        <SectionTitle>Trend</SectionTitle>
        <View style={styles.segmentRow}>
          {(["performance", "bodyweight"] as const).map((metric) => <Pressable key={metric} accessibilityRole="button" accessibilityState={{ selected: chartMetric === metric }} onPress={() => setChartMetric(metric)} style={[styles.segmentButton, chartMetric === metric && styles.segmentButtonActive]}>
            <Body style={[styles.segmentText, chartMetric === metric && styles.segmentTextActive]}>{metric === "performance" ? "Performance" : "Average bodyweight"}</Body>
          </Pressable>)}
        </View>
        <Label>{chartMetric === "performance" ? "Performance points" : "Average bodyweight"}</Label>
        <LineGraph points={chartMetric === "performance" ? absoluteTrend : bodyweightTrend} suffix={chartMetric === "performance" ? " pts" : ` ${bodyWeightUnit}`} height={170}
          emptyMessage={chartMetric === "performance" ? "Performance data unavailable for this cohort." : "No bodyweight observation in this range."} />
        <DetailsDisclosure title="Relative strength">
          <Label>Estimated 1RM ÷ bodyweight · one exercise</Label>
          <LineGraph points={relativeTrend} height={150} emptyMessage="Need a fresh bodyweight pair." />
        </DetailsDisclosure>
      </Panel>
    </Screen>
  );
}

function validContext(value: unknown): value is { range: BulkAnalyticsRange; scopeKind: (typeof scopeKinds)[number]; muscleGroup: MuscleGroup; exerciseId: number; comparisonKey: string } {
  const p = value as { range: BulkAnalyticsRange; scopeKind: (typeof scopeKinds)[number]; muscleGroup: MuscleGroup; exerciseId: number; comparisonKey: string } | null;
  return !!p && ranges.includes(p.range) && scopeKinds.includes(p.scopeKind) && muscles.includes(p.muscleGroup) && Number.isSafeInteger(p.exerciseId) && typeof p.comparisonKey === "string";
}

function buildScope(kind: "overall" | "muscle" | "exercise", muscleGroup: MuscleGroup, exerciseId?: number, comparisonKey?: string): BulkAnalyticsScope | null {
  if (kind === "overall") return { scope: "overall" };
  if (kind === "muscle") return { scope: "muscle", muscleGroup };
  if (!exerciseId) return null;
  return { scope: "exercise", exerciseId, comparisonKey: comparisonKey || undefined };
}

function labelScope(kind: string) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "--";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  const { styles } = useStyles();
  return (
    <Panel style={styles.metricCard}>
      <Label>{title}</Label>
      <SectionTitle style={styles.metricValue}>{value}</SectionTitle>
      <Body>{detail}</Body>
    </Panel>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    minHeight: 44,
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
  coverageRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  notice: { color: palette.warning, fontWeight: "700" },
  metricCard: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 128
  },
  metricValue: {
    fontSize: 24
  }
}));
