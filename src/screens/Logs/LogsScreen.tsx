import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatShortDate } from "@/utils/date";
import { buildPreviousLogs } from "@/utils/logs";
import { palette, spacing } from "@/utils/theme";

export function LogsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const points = useFitnessStore((state) => state.exercisePoints);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const deleteWorkoutLog = useFitnessStore((state) => state.deleteWorkoutLog);
  const logs = buildPreviousLogs({ exercises, sessions, sets, points, unitSystem });
  const groupedLogs = useMemo(() => groupLogsByExercise(logs), [logs]);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  return (
    <Screen>
      <View>
        <Label>Workout history</Label>
        <Title>Logs</Title>
      </View>

      <Panel>
        <SectionTitle>Previous logs</SectionTitle>
        {logs.length ? (
          groupedLogs.map((group) => {
            const isCollapsed = collapsed[group.exerciseId] ?? false;
            const Icon = isCollapsed ? ChevronRight : ChevronDown;
            return (
              <View key={group.exerciseId} style={styles.exerciseSection}>
                <Pressable
                  accessibilityLabel={`${isCollapsed ? "Expand" : "Collapse"} ${group.exerciseName} logs`}
                  onPress={() => setCollapsed((current) => ({ ...current, [group.exerciseId]: !isCollapsed }))}
                  style={styles.exerciseHeader}
                >
                  <View style={styles.exerciseHeaderTitle}>
                    <Icon size={20} color={palette.ink} />
                    <SectionTitle>{group.exerciseName}</SectionTitle>
                  </View>
                  <Body style={styles.countText}>{group.logs.length} logs</Body>
                </Pressable>

                {!isCollapsed ? group.logs.map((log) => (
                  <View key={log.sessionId} style={styles.historyRow}>
                    <View style={styles.historyHeader}>
                      <View style={styles.historyText}>
                        <Body style={styles.dateText}>{formatShortDate(log.date)} · {log.score ? `${log.score.toFixed(1)} pts` : "No score"}</Body>
                        <Body>{log.sets.join("  |  ")}</Body>
                      </View>
                      <Pressable accessibilityLabel={`Delete workout log from ${log.date}`} onPress={() => void deleteWorkoutLog(log.sessionId)} style={styles.deleteButton}>
                        <Trash2 size={16} color={palette.danger} />
                      </Pressable>
                    </View>
                  </View>
                )) : null}
              </View>
            );
          })
        ) : (
          <Body>No workout logs yet.</Body>
        )}
      </Panel>
    </Screen>
  );
}

function groupLogsByExercise(logs: ReturnType<typeof buildPreviousLogs>) {
  const groups = logs.reduce<Record<number, { exerciseId: number; exerciseName: string; logs: typeof logs }>>((output, log) => {
    const existing = output[log.exerciseId] ?? { exerciseId: log.exerciseId, exerciseName: log.exerciseName, logs: [] };
    return {
      ...output,
      [log.exerciseId]: {
        ...existing,
        logs: [...existing.logs, log]
      }
    };
  }, {});

  return Object.values(groups).sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

const styles = StyleSheet.create({
  exerciseSection: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    gap: spacing.sm
  },
  exerciseHeader: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  exerciseHeaderTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  countText: {
    fontWeight: "800"
  },
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
