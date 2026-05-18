import { Pressable, StyleSheet, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatShortDate } from "@/utils/date";
import { buildPreviousLogs } from "@/utils/logs";
import { palette, spacing } from "@/utils/theme";

export function LogsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sets = useFitnessStore((state) => state.sets);
  const points = useFitnessStore((state) => state.exercisePoints);
  const deleteWorkoutLog = useFitnessStore((state) => state.deleteWorkoutLog);
  const logs = buildPreviousLogs({ exercises, sets, points });

  return (
    <Screen>
      <View>
        <Label>Workout history</Label>
        <Title>Logs</Title>
      </View>

      <Panel>
        <SectionTitle>Previous logs</SectionTitle>
        {logs.length ? (
          logs.map((log) => (
            <View key={log.sessionId} style={styles.historyRow}>
              <View style={styles.historyHeader}>
                <View style={styles.historyText}>
                  <Body style={styles.exerciseName}>{log.exerciseName}</Body>
                  <Body style={styles.dateText}>{formatShortDate(log.date)} · {log.score ? `${log.score.toFixed(1)} pts` : "No score"}</Body>
                  <Body>{log.sets.join("  |  ")}</Body>
                </View>
                <Pressable accessibilityLabel={`Delete workout log from ${log.date}`} onPress={() => void deleteWorkoutLog(log.sessionId)} style={styles.deleteButton}>
                  <Trash2 size={16} color={palette.danger} />
                </Pressable>
              </View>
            </View>
          ))
        ) : (
          <Body>No workout logs yet.</Body>
        )}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  historyRow: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    gap: 2
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  historyText: {
    flex: 1,
    gap: 2
  },
  exerciseName: {
    color: palette.ink,
    fontWeight: "900"
  },
  dateText: {
    fontWeight: "800"
  },
  deleteButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center"
  }
});
