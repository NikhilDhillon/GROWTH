import { ReactNode, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Pencil, Plus, Trash2 } from "lucide-react-native";

import { LineGraph } from "@/components/LineGraph";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Body, Label, SectionTitle } from "@/components/Text";
import { buildBodyMeasurementReport, filterBodyMeasurementLogs, type BodyMeasurementRange } from "@/services/body/bodyMeasurementReport";
import { useReportContext } from "@/hooks/useReportContext";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BodyMeasurementLog } from "@/types";
import { BodyMeasurementKey, bodyMeasurementDefinitions, circumferenceFromStorageUnit, formatCircumference } from "@/utils/bodyMeasurements";
import { formatCompactDate, formatShortDate } from "@/utils/date";
import { deleteWithConfirmation } from "@/utils/deletion";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback } from "@/utils/touch";

const ranges: Array<{ key: BodyMeasurementRange; label: string; accessibilityLabel: string }> = [
  { key: "week", label: "1W", accessibilityLabel: "Week" }, { key: "month", label: "1M", accessibilityLabel: "Month" },
  { key: "year", label: "1Y", accessibilityLabel: "Year" }, { key: "all", label: "All", accessibilityLabel: "All time" }
];

export function BodyMeasurementsScreen({ progressTabs }: { progressTabs?: ReactNode }) {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (route: "BodyCheckIn", params: { checkInId?: number }) => void }>();
  const allLogs = useFitnessStore((state) => state.bodyMeasurementLogs);
  const preferences = useFitnessStore((state) => state.bodyUnitPreferences);
  const deleteBodyMeasurementLog = useFitnessStore((state) => state.deleteBodyMeasurementLog);
  const account = useFitnessStore((state) => state.currentUser?.id);
  const context = useReportContext(account, "tape", { range: "year" as BodyMeasurementRange, metric: "waist" as BodyMeasurementKey, trend: false }, validTapeContext);
  const { range, metric, trend: showTrendLine } = context.value;
  const setRange = (range: BodyMeasurementRange) => context.update({ ...context.value, range });
  const setMetric = (metric: BodyMeasurementKey) => context.update({ ...context.value, metric });
  const setShowTrendLine = (fn: (current: boolean) => boolean) => context.update({ ...context.value, trend: fn(showTrendLine) });
  const [selectedChannel, setSelectedChannel] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletionPending = useRef(false);
  const logs = useMemo(() => allLogs.filter((log) => Object.keys(log.measurements).length > 0), [allLogs]);
  const sortedLogs = filterBodyMeasurementLogs(logs, "all");
  const rangedLogs = filterBodyMeasurementLogs(logs, range);
  const series = buildBodyMeasurementReport(sortedLogs, metric);
  const activeSeries = series.find((item) => item.channel === selectedChannel) ?? series[0];
  const rangedIds = new Set(rangedLogs.map((log) => log.id));

  async function confirmDelete(log: BodyMeasurementLog) {
    if (deletionPending.current) return;
    deletionPending.current = true;
    setDeletingId(log.id);
    setDeleteError(null);
    try {
      const result = await deleteWithConfirmation({
        title: "Delete tape measurements?",
        message: "This removes the tape measurements and tape notes saved for this date. Any bodyweight entry on the same date will be preserved.",
        deleteRecord: () => deleteBodyMeasurementLog(log.id),
        fallbackError: "Could not delete these measurements. Please retry."
      });
      if (result.status === "failed") setDeleteError(result.error);
    } finally {
      deletionPending.current = false;
      setDeletingId(null);
    }
  }

  const recordedKeys = new Set(logs.flatMap((log) => Object.keys(log.measurements)));
  const metricOptions = recordedKeys.size ? bodyMeasurementDefinitions.filter((item) => recordedKeys.has(item.key) || item.key === metric) : bodyMeasurementDefinitions;
  const metricLabel = bodyMeasurementDefinitions.find((item) => item.key === metric)?.label ?? "Measurement";
  const visibleHistory = [...sortedLogs].reverse();
  return (
    <Screen>
      {progressTabs}
      {context.error ? <Body>{context.error}</Body> : null}

      <Panel>
        <View style={styles.rowBetween}>
          <SectionTitle style={styles.flex}>Tape</SectionTitle>
          <Pressable accessibilityRole="button" accessibilityLabel="Record body check-in" onPress={() => navigation.navigate("BodyCheckIn", { checkInId: undefined })} style={pressableFeedback(styles.checkInButton)}>
            <Plus size={16} color={palette.surface} />
            <Body style={styles.checkInText}>Check-in</Body>
          </Pressable>
        </View>
        <View style={styles.chipRow}>
          {metricOptions.map((item) => (
            <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected: metric === item.key }} onPress={() => setMetric(item.key)} style={pressableFeedback([styles.chip, metric === item.key && styles.chipActive])}>
              <Body style={[styles.chipText, metric === item.key && styles.chipTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
        </View>
        {series.length > 1 ? <View style={styles.sideRow}>{series.map((item) => <Pressable key={item.channel} accessibilityRole="button" accessibilityState={{ selected: activeSeries?.channel === item.channel }} onPress={() => setSelectedChannel(item.channel)} style={pressableFeedback([styles.side, activeSeries?.channel === item.channel && styles.sideActive])}><Body numberOfLines={1} style={[styles.sideText, activeSeries?.channel === item.channel && styles.sideTextActive]}>{item.label}</Body></Pressable>)}</View> : null}
        {activeSeries ? [activeSeries].map((item) => (
          <LineGraph key={item.channel} points={item.points.filter((point) => rangedIds.has(point.checkInId)).map((point) => ({
            key: `check-in:${point.checkInId}:${item.channel}`, date: point.date, label: formatCompactDate(point.date),
            value: circumferenceFromStorageUnit(point.valueCm, preferences.circumference),
            details: [item.label, `Recorded ${point.date}`]
          }))} suffix={` ${preferences.circumference}`} tone="neutral" height={180} showTrendLine={showTrendLine}
            emptyMessage={`No ${metricLabel.toLowerCase()} entries in this range. Pick a longer range.`} />
        )) : <LineGraph points={[]} emptyMessage={`Record ${metricLabel.toLowerCase()} in a check-in to draw this trend.`} />}
        <SegmentedControl variant="pills" accessibilityLabel="Tape range" value={range} onChange={setRange} options={ranges} />
        {activeSeries ? <Body style={styles.hint}>All-time change {formatChange(activeSeries.changeFromStartCm, preferences.circumference)} since {formatCompactDate(activeSeries.start.date)}</Body> : null}
        <View style={styles.toggleRow}>
          <Pressable accessibilityRole="switch" accessibilityLabel="Toggle trendline" accessibilityState={{ checked: showTrendLine }} onPress={() => setShowTrendLine((value) => !value)} style={pressableFeedback([styles.toggle, showTrendLine && styles.toggleActive])}>
            <View style={[styles.toggleDot, showTrendLine && styles.toggleDotActive]} />
            <Body style={[styles.toggleText, showTrendLine && styles.toggleTextActive]}>Trendline</Body>
          </Pressable>
        </View>
        <DetailsDisclosure title="How measurements are compared">
          <Body>Trends use actual recording dates. Each measurement channel keeps its own history; left and right sides are never averaged together.</Body>
        </DetailsDisclosure>
      </Panel>

      <Panel>
        <View style={styles.rowBetween}>
          <SectionTitle style={styles.flex}>Tape history</SectionTitle>
          <Body style={styles.hint}>{sortedLogs.length} {sortedLogs.length === 1 ? "check-in" : "check-ins"}</Body>
        </View>
        {deleteError ? <Body accessibilityRole="alert" style={styles.error}>{deleteError}</Body> : null}
        {visibleHistory.slice(0, showAllHistory ? undefined : 6).map((log) => (
          <View key={log.id} style={styles.historyRow}>
            <View style={styles.historyCopy}>
              <Body style={styles.historyDate}>{formatShortDate(log.logged_date)}</Body>
              <Body style={styles.historyValues}>{summarizeLog(log, preferences.circumference)}</Body>
              {log.notes ? <Body style={styles.hint}>{log.notes}</Body> : null}
            </View>
            <View style={styles.actions}>
              <Pressable disabled={deletingId !== null} accessibilityLabel={`Edit body check-in from ${log.logged_date}`} onPress={() => navigation.navigate("BodyCheckIn", { checkInId: log.id })} style={pressableFeedback(styles.iconButton)}>
                <Pencil size={16} color={palette.muted} />
              </Pressable>
              <Pressable disabled={deletingId !== null} accessibilityLabel={`Delete body check-in from ${log.logged_date}`} onPress={() => void confirmDelete(log)} style={pressableFeedback(styles.iconButton)}>
                {deletingId === log.id ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={16} color={palette.danger} />}
              </Pressable>
            </View>
          </View>
        ))}
        {visibleHistory.length > 6 ? <Pressable accessibilityRole="button" onPress={() => setShowAllHistory((value) => !value)} style={pressableFeedback(styles.moreButton)}>
          <Body style={styles.moreText}>{showAllHistory ? "Show fewer" : `Show all ${visibleHistory.length}`}</Body>
        </Pressable> : null}
        {!sortedLogs.length ? <Body>No tape observations yet.</Body> : null}
        <Body style={styles.hint}>Editing opens the whole check-in. Deleting removes tape and notes for that date; bodyweight is kept.</Body>
      </Panel>
    </Screen>
  );
}

function validTapeContext(value: unknown): value is { range: BodyMeasurementRange; metric: BodyMeasurementKey; trend: boolean } {
  const p = value as { range: string; metric: BodyMeasurementKey; trend: boolean } | null;
  return !!p && ["week", "month", "year", "all"].includes(p.range) && bodyMeasurementDefinitions.some((definition) => definition.key === p.metric) && typeof p.trend === "boolean";
}

function formatChange(valueCm: number, unit: "in" | "cm") {
  const value = circumferenceFromStorageUnit(valueCm, unit);
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} ${unit}`;
}

function summarizeLog(log: BodyMeasurementLog, circumferenceUnit: "in" | "cm") {
  const values: string[] = [];
  for (const definition of bodyMeasurementDefinitions) {
    const value = log.measurements[definition.key];
    if (typeof value === "number") values.push(`${definition.label} ${formatCircumference(value, circumferenceUnit)}`);
    else if (value?.mode === "single") values.push(`${definition.label} ${formatCircumference(value.value, circumferenceUnit)}`);
    else if (value?.mode === "sides") {
      const sides = [value.left !== undefined ? `L ${formatCircumference(value.left, circumferenceUnit)}` : null,
        value.right !== undefined ? `R ${formatCircumference(value.right, circumferenceUnit)}` : null].filter(Boolean).join(" · ");
      values.push(`${definition.label} ${sides}`);
    }
  }
  return values.join(" · ") || "No recognized tape values";
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  checkInButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: 10, backgroundColor: palette.ink, ...fastTouchStyle },
  checkInText: { color: palette.surface, fontSize: 13, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt, ...fastTouchStyle },
  chipActive: { backgroundColor: palette.ink },
  chipText: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: palette.surface },
  sideRow: { flexDirection: "row", gap: spacing.xs, padding: 3, borderRadius: 12, backgroundColor: palette.surfaceAlt },
  side: { flex: 1, minWidth: 0, minHeight: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs, ...fastTouchStyle },
  sideActive: { backgroundColor: palette.surface },
  sideText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  sideTextActive: { color: palette.ink },
  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  toggle: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: palette.border, ...fastTouchStyle },
  toggleActive: { backgroundColor: palette.accentSoft, borderColor: palette.ink },
  toggleDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: palette.muted },
  toggleDotActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  toggleText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  toggleTextActive: { color: palette.ink },
  hint: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  error: { color: palette.danger, fontWeight: "800" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.md },
  historyCopy: { flex: 1, minWidth: 0, gap: 2 },
  historyDate: { color: palette.ink, fontWeight: "700" },
  historyValues: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.xs },
  iconButton: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", ...fastTouchStyle },
  moreButton: { alignSelf: "center", minHeight: 36, paddingHorizontal: spacing.md, borderRadius: 999, justifyContent: "center", backgroundColor: palette.surfaceAlt, ...fastTouchStyle },
  moreText: { color: palette.ink, fontWeight: "700", fontSize: 13 }
}));
