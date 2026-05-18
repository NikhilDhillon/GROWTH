import { StyleSheet, View } from "react-native";
import { CalendarDays } from "lucide-react-native";

import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatShortDate } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";

export function HomeScreen() {
  const sessions = useFitnessStore((state) => state.sessions);
  const exercises = useFitnessStore((state) => state.exercises);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const latestStrengthExercise = strengthExercises
    .map((exercise) => ({
      exercise,
      latestDate: exercisePoints.filter((point) => point.exerciseId === exercise.id).at(-1)?.date ?? ""
    }))
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))[0]?.exercise;
  const latestPoints = latestStrengthExercise
    ? exercisePoints
        .filter((point) => point.exerciseId === latestStrengthExercise.id)
        .map((point) => ({ label: formatShortDate(point.date), value: point.score }))
    : [];

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Label>Local exercise tracking</Label>
          <Title>GROWTH</Title>
        </View>
        <View style={styles.scorePill}>
          <SectionTitle>{strengthExercises.length}</SectionTitle>
          <Body>strength</Body>
        </View>
      </View>

      <Panel>
        <View style={styles.panelHeader}>
          <SectionTitle>{latestStrengthExercise ? latestStrengthExercise.name : "Strength graph"}</SectionTitle>
          <Body>{latestStrengthExercise ? "Latest strength exercise progression" : "Mark exercises as strength exercises to show graphs here"}</Body>
        </View>
        <LineGraph points={latestPoints} suffix=" pts" />
      </Panel>

      <Panel>
        <SectionTitle>Strength exercises</SectionTitle>
        {strengthExercises.length ? (
          strengthExercises.map((exercise) => (
            <View key={exercise.id} style={styles.workoutRow}>
              <Body style={{ color: palette.ink, fontWeight: "800" }}>{exercise.name}</Body>
              <Body>{exercise.primary_muscle}</Body>
            </View>
          ))
        ) : (
          <Body>No strength exercises yet.</Body>
        )}
      </Panel>

      <Panel>
        <View style={styles.panelHeader}>
          <SectionTitle>Recent workouts</SectionTitle>
          <CalendarDays size={19} color={palette.muted} />
        </View>
        {sessions.slice(0, 5).map((session) => (
          <View key={session.id} style={styles.workoutRow}>
            <Body style={{ color: palette.ink, fontWeight: "800" }}>{formatShortDate(session.workout_date)}</Body>
            <Body>{session.notes || "Workout logged"}</Body>
          </View>
        ))}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.lg
  },
  scorePill: {
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center"
  },
  panelHeader: {
    gap: 2
  },
  workoutRow: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    gap: 2
  }
});
