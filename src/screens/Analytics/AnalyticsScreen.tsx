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

export function AnalyticsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const sets = useFitnessStore((state) => state.sets);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const [selectedId, setSelectedId] = useState(strengthExercises[0]?.id ?? 0);
  const selected = strengthExercises.find((exercise) => exercise.id === selectedId) ?? strengthExercises[0];
  const selectedPoints = selected
    ? exercisePoints.filter((point) => point.exerciseId === selected.id)
    : [];
  const previousLogs = useMemo(() => buildPreviousLogs({ exerciseId: selected?.id, exercises, sessions, sets, points: selectedPoints, unitSystem }), [exercises, selected?.id, selectedPoints, sessions, sets, unitSystem]);
  const weeklyExercisePoints = weeklyScoreAverages(selectedPoints).map((point) => ({ label: formatShortDate(point.date), value: point.score }));
  const monthlyExercisePoints = monthlyScoreAverages(selectedPoints).map((point) => ({ label: point.date, value: point.score }));
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
        {!strengthExercises.length ? <Body>No exercises have been marked as strength exercises yet.</Body> : null}
      </Panel>

      {selected ? (
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

      {selected ? (
        <Panel>
          <SectionTitle>Exercise averages</SectionTitle>
          <Label>Weekly</Label>
          <LineGraph points={weeklyExercisePoints} suffix=" pts" height={150} />
          <Label>Monthly</Label>
          <LineGraph points={monthlyExercisePoints} suffix=" pts" height={150} />
        </Panel>
      ) : null}

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
