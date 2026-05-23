import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { detectPersonalRecords, monthlyScoreAverages, weeklyScoreAverages, weeklyVolume } from "@/services/analytics/analyticsService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatShortDate } from "@/utils/date";
import { buildPreviousLogs } from "@/utils/logs";
import { palette, spacing } from "@/utils/theme";
import { formatWeight, weightFromStorageUnit } from "@/utils/units";

export function AnalyticsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const sets = useFitnessStore((state) => state.sets);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const [selectedId, setSelectedId] = useState(strengthExercises[0]?.id ?? 0);
  const [viewMode, setViewMode] = useState<"progress" | "comparison">("progress");
  const selected = strengthExercises.find((exercise) => exercise.id === selectedId) ?? strengthExercises[0];
  const selectedPoints = selected
    ? exercisePoints.filter((point) => point.exerciseId === selected.id)
    : [];
  const previousLogs = useMemo(() => buildPreviousLogs({ exerciseId: selected?.id, exercises, sessions, sets, points: selectedPoints, unitSystem }), [exercises, selected?.id, selectedPoints, sessions, sets, unitSystem]);
  const weeklyExercisePoints = weeklyScoreAverages(selectedPoints).map((point) => ({ label: formatShortDate(point.date), value: point.score }));
  const monthlyExercisePoints = monthlyScoreAverages(selectedPoints).map((point) => ({ label: point.date, value: point.score }));
  const bodyWeightByDate = new Map(bodyWeightLogs.map((log) => [log.logged_at.slice(0, 10), log]));
  const strengthPointByDate = new Map(selectedPoints.map((point) => [point.date, point]));
  const logByDate = new Map(previousLogs.map((log) => [log.date, log]));
  const comparisonDates = [...new Set([...bodyWeightLogs.map((log) => log.logged_at.slice(0, 10)), ...selectedPoints.map((point) => point.date)])].sort();
  const weightPoints = [...bodyWeightLogs]
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at))
    .map((log) => {
      const loggedDate = log.logged_at.slice(0, 10);
      const strengthPoint = strengthPointByDate.get(loggedDate);
      const workoutLog = logByDate.get(loggedDate);
      return {
        key: loggedDate,
        label: formatShortDate(loggedDate),
        value: weightFromStorageUnit(log.weight, unitSystem),
        details: [
          strengthPoint ? `Score ${strengthPoint.score.toFixed(1)} pts` : "No lift logged",
          ...(workoutLog?.sets ?? [])
        ]
      };
    });
  const comparisonStrengthPoints = selectedPoints.map((point) => {
    const weightLog = bodyWeightByDate.get(point.date);
    const workoutLog = previousLogs.find((item) => item.sessionId === point.sessionId);
    return {
      key: point.date,
      label: formatShortDate(point.date),
      value: point.score,
      details: [
        weightLog ? `Body weight ${formatWeight(weightLog.weight, unitSystem)}` : "No body weight logged",
        ...(workoutLog?.sets ?? [])
      ]
    };
  });
  const prs = useMemo(() => detectPersonalRecords(selectedPoints), [selectedPoints]);
  const volume = weeklyVolume(sets, unitSystem).slice(-6);

  return (
    <Screen>
      <View>
        <Label>Individual strength exercise graphs</Label>
        <Title>Progress</Title>
      </View>

      <Panel>
        <SectionTitle>Strength exercise</SectionTitle>
        <View style={styles.chipRow}>
          {strengthExercises.map((exercise) => (
            <Pressable key={exercise.id} onPress={() => setSelectedId(exercise.id)} style={[styles.chip, selected?.id === exercise.id && styles.chipActive]}>
              <Body style={[styles.chipText, selected?.id === exercise.id && styles.chipTextActive]}>{exercise.name}</Body>
            </Pressable>
          ))}
        </View>
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

      {selected && viewMode === "comparison" ? (
        <Panel>
          <SectionTitle>{selected.name} vs body weight</SectionTitle>
          <Label>Body weight</Label>
          <LineGraph points={weightPoints} suffix={` ${unitSystem}`} height={150} emptyMessage="Log body weight to draw a trend." xLabels={comparisonDates} />
          <Label>Strength score</Label>
          <LineGraph points={comparisonStrengthPoints} suffix=" pts" height={150} xLabels={comparisonDates} />
        </Panel>
      ) : null}

      {selected && viewMode === "progress" ? (
        <Panel>
          <View style={styles.summaryRow}>
            <View>
              <Label>{selected.primary_muscle}</Label>
              <SectionTitle>{selected.name}</SectionTitle>
            </View>
            <View style={styles.bigScore}>
              <SectionTitle>{prs.bestStrength ? Math.round(prs.bestStrength.score) : "--"}</SectionTitle>
            </View>
          </View>
          <LineGraph
            points={selectedPoints.map((point) => {
              const log = previousLogs.find((item) => item.sessionId === point.sessionId);
              return {
                label: formatShortDate(point.date),
                value: point.score,
                details: log?.sets ?? []
              };
            })}
            suffix=" pts"
          />
          <Body>Best strength score rewards top-end load, repeatability, and sustainable set quality with diminishing returns.</Body>
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

      {viewMode === "progress" ? (
      <Panel>
        <SectionTitle>Weekly volume ({unitSystem})</SectionTitle>
        <View style={styles.bars}>
          {volume.map((item) => {
            const max = Math.max(...volume.map((entry) => entry.volume), 1);
            return (
              <View key={item.date} style={styles.barColumn}>
                <View style={[styles.bar, { height: 28 + (item.volume / max) * 92 }]} />
                <Body style={styles.barLabel}>{formatShortDate(item.date)}</Body>
              </View>
            );
          })}
        </View>
      </Panel>
      ) : null}
    </Screen>
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
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.lg
  },
  bigScore: {
    width: 68,
    height: 68,
    borderRadius: 8,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  bars: {
    minHeight: 160,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm
  },
  bar: {
    width: "100%",
    borderRadius: 6,
    backgroundColor: palette.blue
  },
  barLabel: {
    fontSize: 11,
    textAlign: "center"
  },
});
