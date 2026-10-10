import { useNavigation } from "@react-navigation/native";
import { ReactNode, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Pencil, Plus, Trash2 } from "lucide-react-native";

import { Button } from "@/components/Button";
import { LineGraph } from "@/components/LineGraph";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Body, Label, SectionTitle } from "@/components/Text";
import { useReportContext } from "@/hooks/useReportContext";
import { addCalendarDays } from "@/domain/calendar";
import { normalizeBodyWeightLogs } from "@/services/body/bodyWeightService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BodyWeightLog } from "@/types";
import { formatCompactDate, formatShortDate, todayIso } from "@/utils/date";
import { deleteWithConfirmation } from "@/utils/deletion";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { bodyWeightFromStorageUnit, formatBodyWeight } from "@/utils/units";

type BodyweightRange = "week" | "month" | "year" | "all";

const ranges: Array<{ key: BodyweightRange; label: string; accessibilityLabel: string }> = [
  { key: "week", label: "1W", accessibilityLabel: "Week" },
  { key: "month", label: "1M", accessibilityLabel: "Month" },
  { key: "year", label: "1Y", accessibilityLabel: "Year" },
  { key: "all", label: "All", accessibilityLabel: "All time" }
];

export function BodyweightScreen({ progressTabs }: { progressTabs?: ReactNode } = {}) {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (route: string, params: { checkInId?: number }) => void }>();
  const logs = useFitnessStore((state) => state.bodyWeightLogs);
  const unit = useFitnessStore((state) => state.bodyUnitPreferences.weight);
  const deleteBodyWeightLog = useFitnessStore((state) => state.deleteBodyWeightLog);
  const account = useFitnessStore((state) => state.currentUser?.id);
  const reportContext = useReportContext(account, "bodyweight", { range: "month" as BodyweightRange, trend: false, averages: false }, validWeightContext);
  const range = reportContext.value.range;
  const showTrendLine = reportContext.value.trend;
  const setRange = (range: BodyweightRange) => reportContext.update({ ...reportContext.value, range });
  const setShowTrendLine = (fn: (current: boolean) => boolean) => reportContext.update({ ...reportContext.value, trend: fn(showTrendLine) });
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletionPending = useRef(false);
  const sortedLogs = useMemo(
    () => normalizeBodyWeightLogs(logs).filter((log) => log.logged_date! <= todayIso()),
    [logs]
  );
  const filteredLogs = filterLogsByRange(sortedLogs, range);
  const rangeAverage = averageBodyWeight(filteredLogs);
  const firstInRange = filteredLogs[0] ?? null;
  const latestInRange = filteredLogs.at(-1) ?? null;
  const rangeChange = firstInRange && latestInRange ? latestInRange.weight - firstInRange.weight : null;
  const graphPoints = reportContext.value.averages
    ? buildMonthlyAveragePoints(filteredLogs, unit)
    : filteredLogs.map((log) => ({
        key: `weight:${log.id}`, date: bodyweightDate(log),
        label: formatCompactDate(bodyweightDate(log)),
        value: bodyWeightFromStorageUnit(log.weight, unit),
        details: [formatBodyWeight(log.weight, unit)]
      }));

  async function confirmDelete(log: BodyWeightLog) {
    if (deletionPending.current) return;
    deletionPending.current = true;
    setDeletingId(log.id);
    setDeleteError(null);
    try {
      const result = await deleteWithConfirmation({
        title: "Delete bodyweight entry?",
        message: "Strength scores that use this bodyweight may change. Tape measurements saved on the same date will be preserved.",
        deleteRecord: () => deleteBodyWeightLog(log.id),
        fallbackError: "Could not delete this bodyweight entry. Please retry."
      });
      if (result.status === "failed") setDeleteError(result.error);
    } finally {
      deletionPending.current = false;
      setDeletingId(null);
    }
  }

  return (
    <Screen>
      {progressTabs}
      <Panel>
        <View style={styles.panelHeader}>
          <SectionTitle style={styles.flex}>Bodyweight</SectionTitle>
          <Pressable accessibilityRole="button" accessibilityLabel="Record body check-in" onPress={() => navigation.navigate("BodyCheckIn", { checkInId: undefined })} style={pressableFeedback(styles.checkInButton)}>
            <Plus size={16} color={palette.surface} />
            <Body style={styles.checkInText}>Check-in</Body>
          </Pressable>
        </View>
        <LineGraph
          points={graphPoints}
          suffix={` ${unit}`}
          tone="neutral"
          height={190}
          emptyMessage={`Add a bodyweight entry to draw this ${rangeLabel(range)} trend.`}
          showTrendLine={showTrendLine}
        />
        <SegmentedControl variant="pills" accessibilityLabel="Bodyweight range" value={range} onChange={setRange} options={ranges} />
        <View style={styles.statGrid}>
          <View style={styles.stat}>
            <Label numberOfLines={1}>Average</Label>
            <Body numberOfLines={1} style={styles.statValue}>{rangeAverage === null ? "—" : formatBodyWeight(rangeAverage, unit)}</Body>
          </View>
          <View style={styles.stat}>
            <Label numberOfLines={1}>Change</Label>
            <Body numberOfLines={1} style={styles.statValue}>{rangeChange === null ? "—" : `${rangeChange >= 0 ? "+" : ""}${formatBodyWeight(rangeChange, unit)}`}</Body>
          </View>
          <View style={styles.stat}>
            <Label numberOfLines={1}>Weigh-ins</Label>
            <Body numberOfLines={1} style={styles.statValue}>{filteredLogs.length}</Body>
          </View>
        </View>
        <View style={styles.toggleRow}>
          <Pressable accessibilityRole="switch" accessibilityLabel="Toggle bodyweight trendline" accessibilityState={{ checked: showTrendLine }} onPress={() => setShowTrendLine((value) => !value)} style={pressableFeedback([styles.toggle, showTrendLine && styles.toggleActive])}>
            <View style={[styles.toggleDot, showTrendLine && styles.toggleDotActive]} />
            <Body style={[styles.toggleText, showTrendLine && styles.toggleTextActive]}>Trendline</Body>
          </Pressable>
          <Pressable accessibilityRole="switch" accessibilityLabel="Toggle monthly averages" accessibilityState={{ checked: reportContext.value.averages }} onPress={() => reportContext.update({ ...reportContext.value, averages: !reportContext.value.averages })} style={pressableFeedback([styles.toggle, reportContext.value.averages && styles.toggleActive])}>
            <View style={[styles.toggleDot, reportContext.value.averages && styles.toggleDotActive]} />
            <Body style={[styles.toggleText, reportContext.value.averages && styles.toggleTextActive]}>Monthly averages</Body>
          </Pressable>
        </View>
        <DetailsDisclosure title="About these points">
          <Body>Recorded weigh-ins keep their actual dates. Monthly averages combine entries within each month and are labeled as averages. Daily weight entries are independent; tape measurements are optional and keep their own observation dates.</Body>
        </DetailsDisclosure>
        {reportContext.error ? <Body>{reportContext.error}</Body> : null}
      </Panel>

      <Panel>
        <SectionTitle>History</SectionTitle>
        {deleteError ? <Body accessibilityRole="alert" style={styles.errorText}>{deleteError}</Body> : null}
        {sortedLogs.length ? [...sortedLogs].reverse().slice(0, showAllHistory ? undefined : 8).map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.logText}>
              <Body style={styles.logDate}>{formatShortDate(bodyweightDate(log))}</Body>
              <SectionTitle>{formatBodyWeight(log.weight, unit)}</SectionTitle>
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityLabel={`Edit bodyweight from ${bodyweightDate(log)}`} hitSlop={touchHitSlop} onPress={() => navigation.navigate("BodyCheckIn", { checkInId: log.id })} style={pressableFeedback(styles.iconButton)}>
                <Pencil size={17} color={palette.ink} />
              </Pressable>
              <Pressable disabled={deletingId !== null} accessibilityLabel={`Delete bodyweight from ${bodyweightDate(log)}`} hitSlop={touchHitSlop} onPress={() => void confirmDelete(log)} style={pressableFeedback(styles.iconButton)}>
                {deletingId === log.id ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={17} color={palette.danger} />}
              </Pressable>
            </View>
          </View>
        )) : <Body>No bodyweight entries yet.</Body>}
        {sortedLogs.length > 8 ? <Button variant="ghost" label={showAllHistory ? "Show fewer entries" : `Show all ${sortedLogs.length} entries`} onPress={() => setShowAllHistory((value) => !value)} style={styles.centered} /> : null}
      </Panel>
    </Screen>
  );
}

function validWeightContext(value: unknown): value is { range: BodyweightRange; trend: boolean; averages: boolean } {
  const p = value as { range: string; trend: boolean; averages: boolean } | null;
  return !!p && ["week", "month", "year", "all"].includes(p.range) && typeof p.trend === "boolean" && typeof p.averages === "boolean";
}
function filterLogsByRange(logs: BodyWeightLog[], range: BodyweightRange) {
  const asOf = todayIso();
  const cutoff = range === "all" ? "0001-01-01" : addCalendarDays(asOf, -rangeDays(range) + 1);
  return logs.filter((log) => bodyweightDate(log) >= cutoff && bodyweightDate(log) <= asOf);
}

function rangeDays(range: Exclude<BodyweightRange, "all">) {
  if (range === "week") return 7;
  if (range === "month") return 30;
  return 365;
}

function rangeLabel(range: BodyweightRange) {
  return range === "all" ? "all-time" : range;
}

function rangeAverageLabel(range: BodyweightRange) {
  return `${range === "all" ? "All-time" : range[0].toUpperCase() + range.slice(1)} average`;
}

function buildMonthlyAveragePoints(logs: BodyWeightLog[], unit: "lb" | "kg") {
  const buckets = logs.reduce<Map<string, BodyWeightLog[]>>((groups, log) => {
    const key = bodyweightDate(log).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), log]);
    return groups;
  }, new Map());

  return [...buckets.entries()].map(([month, monthLogs]) => {
    const average = averageBodyWeight(monthLogs) ?? 0;
    return {
      date: `${month}-01`,
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      value: bodyWeightFromStorageUnit(average, unit),
      details: [`${monthLogs.length} ${monthLogs.length === 1 ? "entry" : "entries"} averaged`]
    };
  });
}

function averageBodyWeight(logs: BodyWeightLog[]) {
  if (!logs.length) return null;
  return logs.reduce((total, log) => total + log.weight, 0) / logs.length;
}

function bodyweightDate(log: BodyWeightLog) {
  return log.logged_date ?? log.logged_at.slice(0, 10);
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  centered: {
    alignSelf: "center"
  },
  checkInButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: palette.ink,
    ...fastTouchStyle
  },
  checkInText: {
    color: palette.surface,
    fontSize: 13,
    fontWeight: "700"
  },
  statGrid: {
    flexDirection: "row",
    gap: spacing.sm
  },
  stat: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt
  },
  statValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  toggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  toggle: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    ...fastTouchStyle
  },
  toggleActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.ink
  },
  toggleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: palette.muted
  },
  toggleDotActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  toggleText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  toggleTextActive: {
    color: palette.ink
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  logRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md
  },
  logText: {
    flex: 1,
    minWidth: 0
  },
  logDate: {
    color: palette.muted
  },
  actions: {
    flexDirection: "row",
    gap: spacing.xs
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  }
}));
