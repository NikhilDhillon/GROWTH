import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { detectPersonalRecords, monthlyScoreAverages, weeklyScoreAverages } from "@/services/analytics/analyticsService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BodyWeightLog, ExerciseScorePoint } from "@/types";
import { formatShortDate, todayIso } from "@/utils/date";
import { buildPreviousLogs } from "@/utils/logs";
import { muscles, palette, spacing } from "@/utils/theme";
import { bodyWeightDisplayUnit, bodyWeightFromStorageUnit, formatBodyWeight } from "@/utils/units";

type ProgressRange = "month" | "year" | "all";

const ranges: Array<{ key: ProgressRange; label: string }> = [
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All Time" }
];

export function AnalyticsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const sets = useFitnessStore((state) => state.sets);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const groupedStrengthExercises = useMemo(() => {
    return muscles
      .map((muscle) => ({
        muscle,
        exercises: strengthExercises
          .filter((exercise) => exercise.primary_muscle === muscle)
          .sort((a, b) => a.name.localeCompare(b.name))
      }))
      .filter((group) => group.exercises.length);
  }, [strengthExercises]);
  const [selectedId, setSelectedId] = useState(strengthExercises[0]?.id ?? 0);
  const [viewMode, setViewMode] = useState<"progress" | "comparison">("progress");
  const [range, setRange] = useState<ProgressRange>("month");
  const selected = strengthExercises.find((exercise) => exercise.id === selectedId) ?? strengthExercises[0];
  const selectedPoints = selected
    ? exercisePoints.filter((point) => point.exerciseId === selected.id)
    : [];
  const rangedSelectedPoints = filterPointsByRange(selectedPoints, range);
  const rangedBodyWeightLogs = filterBodyWeightLogsByRange(bodyWeightLogs, range);
  const previousLogs = useMemo(() => buildPreviousLogs({ exerciseId: selected?.id, exercises, sessions, sets, points: selectedPoints, unitSystem }), [exercises, selected?.id, selectedPoints, sessions, sets, unitSystem]);
  const rangedPreviousLogs = filterLogsByRange(previousLogs, range);
  const weeklyExercisePoints = weeklyScoreAverages(selectedPoints).map((point) => ({ date: point.date, label: formatShortDate(point.date), value: point.score }));
  const monthlyExercisePoints = monthlyScoreAverages(selectedPoints).map((point) => ({ date: point.date, label: formatMonthLabel(point.date), value: point.score }));
  const bodyWeightByDate = new Map(bodyWeightLogs.map((log) => [log.logged_at.slice(0, 10), log]));
  const strengthPointByDate = new Map(selectedPoints.map((point) => [point.date, point]));
  const logByDate = new Map(previousLogs.map((log) => [log.date, log]));
  const weightPoints = buildBodyWeightGraphPoints(rangedBodyWeightLogs, strengthPointByDate, logByDate);
  const comparisonStrengthPoints = buildStrengthGraphPoints(rangedSelectedPoints, bodyWeightByDate, previousLogs);
  const comparisonDates = [...new Set([...weightPoints.map((point) => point.date), ...comparisonStrengthPoints.map((point) => point.date)])].sort();
  const progressGraphPoints = buildStrengthGraphPoints(rangedSelectedPoints, bodyWeightByDate, previousLogs);
  const prs = useMemo(() => detectPersonalRecords(selectedPoints), [selectedPoints]);
  const sessionComparison = compareLatestSessions(rangedSelectedPoints);

  return (
    <Screen>
      <View>
        <Label>Individual exercise performance graphs</Label>
        <Title>Progress</Title>
      </View>

      <Panel>
        <SectionTitle>Strength exercise</SectionTitle>
        {groupedStrengthExercises.map((group) => (
          <View key={group.muscle} style={styles.exerciseGroup}>
            <Label>{group.muscle}</Label>
            <View style={styles.chipRow}>
              {group.exercises.map((exercise) => (
                <Pressable key={exercise.id} onPress={() => setSelectedId(exercise.id)} style={[styles.chip, selected?.id === exercise.id && styles.chipActive]}>
                  <Body style={[styles.chipText, selected?.id === exercise.id && styles.chipTextActive]}>{exercise.name}</Body>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {!strengthExercises.length ? <Body>Select exercises on the Exercises page to enable scoring.</Body> : null}
      </Panel>

      <Panel>
        <SectionTitle>View</SectionTitle>
        <View style={styles.segmentRow}>
          <Pressable onPress={() => setViewMode("progress")} style={[styles.segmentButton, viewMode === "progress" && styles.segmentButtonActive]}>
            <Body style={[styles.segmentText, viewMode === "progress" && styles.segmentTextActive]}>Progress</Body>
          </Pressable>
          <Pressable onPress={() => setViewMode("comparison")} style={[styles.segmentButton, viewMode === "comparison" && styles.segmentButtonActive]}>
            <Body style={[styles.segmentText, viewMode === "comparison" && styles.segmentTextActive]}>Weight comparison</Body>
          </Pressable>
        </View>
      </Panel>

      <Panel>
        <SectionTitle>Range</SectionTitle>
        <View style={styles.chipRow}>
          {ranges.map((item) => (
            <Pressable key={item.key} onPress={() => setRange(item.key)} style={[styles.chip, range === item.key && styles.chipActive]}>
              <Body style={[styles.chipText, range === item.key && styles.chipTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>

      {selected && viewMode === "comparison" ? (
        <Panel>
          <SectionTitle>{selected.name} vs body weight</SectionTitle>
          <Label>Body weight</Label>
          <LineGraph points={weightPoints} suffix={` ${bodyWeightDisplayUnit}`} height={150} emptyMessage="Log body weight to draw a trend." xLabels={comparisonDates} />
          <Label>Performance Points</Label>
          <LineGraph points={comparisonStrengthPoints} suffix=" pts" height={150} xLabels={comparisonDates} />
        </Panel>
      ) : null}

      {selected && viewMode === "progress" ? (
        <Panel>
          <View style={styles.summaryRow}>
            <View>
              <Label>{selected.primary_muscle}</Label>
              <SectionTitle>{selected.name}</SectionTitle>
              <Body>
                {sessionComparison
                  ? `${formatPoints(sessionComparison.current.score)} latest vs ${formatPoints(sessionComparison.previous?.score)} previous`
                  : `${formatPoints(prs.bestPerformance?.score ?? null)} all-time peak`}
              </Body>
            </View>
            <View style={styles.bigScore}>
              <SectionTitle>{sessionComparison?.changePercent !== null && sessionComparison?.changePercent !== undefined
                ? formatPercentChange(sessionComparison.changePercent)
                : formatPoints(sessionComparison?.current.score ?? prs.bestPerformance?.score ?? null)}</SectionTitle>
            </View>
          </View>
          <LineGraph
            points={progressGraphPoints}
            maxPoints={progressGraphPoints.length || 1}
            suffix=" pts"
            emptyMessage={`Performance Points data required for this ${rangeLabel(range)}.`}
            scrollable
          />
          <Body>Each point is an individual workout score. Scroll horizontally to review older sessions.</Body>
        </Panel>
      ) : null}

      {selected && viewMode === "progress" ? (
        <Panel>
          <SectionTitle>Exercise averages</SectionTitle>
          <Label>Weekly</Label>
          <LineGraph points={weeklyExercisePoints} suffix=" pts" height={150} />
          <Label>Monthly</Label>
          <LineGraph points={monthlyExercisePoints} suffix=" pts" height={150} />
        </Panel>
      ) : null}

      {selected && viewMode === "progress" ? (
        <Panel>
          <View style={styles.logsHeader}>
            <View>
              <SectionTitle>Workout logs</SectionTitle>
              <Body>{selected.name}</Body>
            </View>
            <Body style={styles.logCount}>{rangedPreviousLogs.length} logs</Body>
          </View>
          {rangedPreviousLogs.length ? rangedPreviousLogs.map((log) => (
            <View key={log.sessionId} style={styles.logRow}>
              <View style={styles.logHeading}>
                <Body style={styles.logDate}>{formatShortDate(log.date)}</Body>
                <Body style={styles.logScore}>{log.score ? `${log.score.toFixed(1)} pts` : "No score"}</Body>
              </View>
              <Body>{log.sets.join("  |  ")}</Body>
              {log.point ? (
                <Body style={styles.logDetails}>
                  e1RM {log.point.estimated1RM.toFixed(1)} · Volume {log.point.failureVolume.toFixed(1)} · Resistance {(log.point.fatigueResistance * 100).toFixed(0)}%
                </Body>
              ) : null}
            </View>
          )) : (
            <Body>No workout logs in this {rangeLabel(range)}.</Body>
          )}
        </Panel>
      ) : null}
    </Screen>
  );
}

function filterPointsByRange(points: ExerciseScorePoint[], range: ProgressRange) {
  if (range === "all") return points;
  const cutoff = cutoffDate(range);
  const today = todayDate();
  return points.filter((point) => {
    const date = toDate(point.date);
    return date >= cutoff && date <= today;
  });
}

function filterBodyWeightLogsByRange(logs: BodyWeightLog[], range: ProgressRange) {
  const sortedLogs = [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at));
  if (range === "all") return sortedLogs;
  const cutoff = cutoffDate(range);
  const today = todayDate();
  return sortedLogs.filter((log) => {
    const date = toDate(log.logged_at.slice(0, 10));
    return date >= cutoff && date <= today;
  });
}

function filterLogsByRange(logs: ReturnType<typeof buildPreviousLogs>, range: ProgressRange) {
  if (range === "all") return logs;
  const cutoff = cutoffDate(range);
  const today = todayDate();
  return logs.filter((log) => {
    const date = toDate(log.date);
    return date >= cutoff && date <= today;
  });
}

function buildStrengthGraphPoints(points: ExerciseScorePoint[], bodyWeightByDate: Map<string, BodyWeightLog>, previousLogs: ReturnType<typeof buildPreviousLogs>) {
  return points.map((point) => {
    const weightLog = bodyWeightByDate.get(point.date);
    const workoutLog = previousLogs.find((item) => item.sessionId === point.sessionId);
    return {
      date: point.date,
      key: String(point.sessionId),
      label: formatShortDate(point.date),
      value: point.score,
      details: [
        weightLog ? `Body weight ${formatBodyWeight(weightLog.weight)}` : "No body weight logged",
        ...(workoutLog?.sets ?? [])
      ]
    };
  });
}

function buildBodyWeightGraphPoints(logs: BodyWeightLog[], strengthPointByDate: Map<string, ExerciseScorePoint>, logByDate: Map<string, ReturnType<typeof buildPreviousLogs>[number]>) {
  return logs.map((log) => {
    const loggedDate = log.logged_at.slice(0, 10);
    const strengthPoint = strengthPointByDate.get(loggedDate);
    const workoutLog = logByDate.get(loggedDate);
    return {
      date: loggedDate,
      label: formatShortDate(loggedDate),
      value: bodyWeightFromStorageUnit(log.weight),
      details: [
        strengthPoint ? `Performance ${strengthPoint.performancePoints.toFixed(1)} pts | e1RM ${strengthPoint.estimated1RM.toFixed(1)}` : "No eligible lift logged",
        ...(workoutLog?.sets ?? [])
      ]
    };
  });
}

function cutoffDate(range: Exclude<ProgressRange, "all">) {
  const cutoff = todayDate();
  cutoff.setDate(cutoff.getDate() - rangeDays(range) + 1);
  return cutoff;
}

function todayDate() {
  return toDate(todayIso());
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function rangeDays(range: Exclude<ProgressRange, "all">) {
  if (range === "month") return 30;
  return 365;
}

function rangeLabel(range: ProgressRange) {
  if (range === "all") return "all-time range";
  return range;
}

function formatPoints(value: number | null | undefined) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} pts` : "--";
}

function compareLatestSessions(points: ExerciseScorePoint[]) {
  const ordered = [...points].sort((left, right) => left.date.localeCompare(right.date) || left.sessionId - right.sessionId);
  const current = ordered.at(-1);
  if (!current) return null;
  const previous = ordered.at(-2);
  const changePercent = previous?.score
    ? ((current.score - previous.score) / previous.score) * 100
    : null;
  return { current, previous, changePercent };
}

function formatPercentChange(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "--";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
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
  exerciseGroup: {
    gap: spacing.sm
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
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.lg
  },
  bigScore: {
    minWidth: 88,
    height: 68,
    borderRadius: 8,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  logsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  logCount: {
    fontWeight: "800"
  },
  logRow: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    gap: spacing.xs
  },
  logHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  logDate: {
    fontWeight: "900"
  },
  logScore: {
    fontWeight: "900",
    color: palette.accent
  },
  logDetails: {
    color: palette.muted
  },
});
