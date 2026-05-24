import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { Exercise, MuscleGroup } from "@/types";
import { formatShortDate } from "@/utils/date";
import { buildPreviousLogs } from "@/utils/logs";
import { muscles, palette, spacing } from "@/utils/theme";
import { formatBodyWeight } from "@/utils/units";

export function LogsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const points = useFitnessStore((state) => state.exercisePoints);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const deleteWorkoutLog = useFitnessStore((state) => state.deleteWorkoutLog);
  const deleteBodyWeightLog = useFitnessStore((state) => state.deleteBodyWeightLog);
  const logs = buildPreviousLogs({ exercises, sessions, sets, points, unitSystem });
  const groupedLogs = useMemo(() => groupLogsByMuscle(logs, exercises), [exercises, logs]);
  const [bodyWeightCollapsed, setBodyWeightCollapsed] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedMuscles, setCollapsedMuscles] = useState<Record<string, boolean>>({});

  return (
    <Screen>
      <View>
        <Label>Workout history</Label>
        <Title>Logs</Title>
      </View>

      <Panel>
        <Pressable
          accessibilityLabel={`${bodyWeightCollapsed ? "Expand" : "Collapse"} body weight logs`}
          onPress={() => setBodyWeightCollapsed((current) => !current)}
          style={styles.muscleHeader}
        >
          <View style={styles.exerciseHeaderTitle}>
            {bodyWeightCollapsed ? <ChevronRight size={20} color={palette.ink} /> : <ChevronDown size={20} color={palette.ink} />}
            <SectionTitle style={styles.muscleTitle}>Body weight</SectionTitle>
          </View>
          <Body style={styles.countText}>{bodyWeightLogs.length} logs</Body>
        </Pressable>
        {!bodyWeightCollapsed && bodyWeightLogs.length ? (
          bodyWeightLogs.map((log) => (
            <View key={log.id} style={styles.historyRow}>
              <View style={styles.historyHeader}>
                <View style={styles.historyText}>
                  <Body style={styles.dateText}>{formatShortDate(log.logged_at.slice(0, 10))}</Body>
                  <Body>{formatBodyWeight(log.weight)}</Body>
                </View>
                <Pressable accessibilityLabel={`Delete body weight log from ${log.logged_at.slice(0, 10)}`} onPress={() => void deleteBodyWeightLog(log.id)} style={styles.deleteButton}>
                  <Trash2 size={16} color={palette.danger} />
                </Pressable>
              </View>
            </View>
          ))
        ) : !bodyWeightCollapsed ? (
          <Body>No body weight logs yet.</Body>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle>Previous logs</SectionTitle>
        {logs.length ? (
          groupedLogs.map((muscleGroup) => (
            <View key={muscleGroup.muscle} style={styles.muscleSection}>
              <Pressable
                accessibilityLabel={`${collapsedMuscles[muscleGroup.muscle] ? "Expand" : "Collapse"} ${muscleGroup.muscle} logs`}
                onPress={() => setCollapsedMuscles((current) => ({ ...current, [muscleGroup.muscle]: !(current[muscleGroup.muscle] ?? false) }))}
                style={styles.muscleHeader}
              >
                <View style={styles.exerciseHeaderTitle}>
                  {collapsedMuscles[muscleGroup.muscle] ? <ChevronRight size={20} color={palette.ink} /> : <ChevronDown size={20} color={palette.ink} />}
                  <SectionTitle style={styles.muscleTitle}>{muscleGroup.muscle}</SectionTitle>
                </View>
                <Body style={styles.countText}>{muscleGroup.logCount} logs</Body>
              </Pressable>

              {!collapsedMuscles[muscleGroup.muscle] ? muscleGroup.exercises.map((group) => {
                const collapseKey = `${muscleGroup.muscle}:${group.exerciseId}`;
                const isCollapsed = collapsed[collapseKey] ?? false;
                const Icon = isCollapsed ? ChevronRight : ChevronDown;
                return (
                  <View key={group.exerciseId} style={styles.exerciseSection}>
                    <Pressable
                      accessibilityLabel={`${isCollapsed ? "Expand" : "Collapse"} ${group.exerciseName} logs`}
                      onPress={() => setCollapsed((current) => ({ ...current, [collapseKey]: !isCollapsed }))}
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
              }) : null}
            </View>
          ))
        ) : (
          <Body>No workout logs yet.</Body>
        )}
      </Panel>
    </Screen>
  );
}

function groupLogsByMuscle(logs: ReturnType<typeof buildPreviousLogs>, exercises: Exercise[]) {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const groups = logs.reduce<Record<string, { muscle: MuscleGroup; exercises: Record<number, { exerciseId: number; exerciseName: string; logs: typeof logs }> }>>((output, log) => {
    const muscle = exerciseById.get(log.exerciseId)?.primary_muscle ?? "Chest";
    const muscleGroup = output[muscle] ?? { muscle, exercises: {} };
    const existingExercise = muscleGroup.exercises[log.exerciseId] ?? { exerciseId: log.exerciseId, exerciseName: log.exerciseName, logs: [] };

    return {
      ...output,
      [muscle]: {
        ...muscleGroup,
        exercises: {
          ...muscleGroup.exercises,
          [log.exerciseId]: {
            ...existingExercise,
            logs: [...existingExercise.logs, log]
          }
        }
      }
    };
  }, {});

  return Object.values(groups)
    .map((group) => {
      const exerciseGroups = Object.values(group.exercises).sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
      return {
        muscle: group.muscle,
        exercises: exerciseGroups,
        logCount: exerciseGroups.reduce((total, exercise) => total + exercise.logs.length, 0)
      };
    })
    .sort((a, b) => muscles.indexOf(a.muscle) - muscles.indexOf(b.muscle));
}

const styles = StyleSheet.create({
  muscleSection: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.lg,
    gap: spacing.md
  },
  muscleHeader: {
    minHeight: 52,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  muscleTitle: {
    fontSize: 25,
    lineHeight: 30
  },
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
