import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Save, Trash2, X } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { ExerciseLoadType, getExerciseLoadType } from "@/constants/exercises";
import { useFitnessStore } from "@/store/useFitnessStore";
import { Exercise, LoggedSetDraft, MuscleGroup, WorkoutSession } from "@/types";
import { formatShortDate } from "@/utils/date";
import { buildPreviousLogs } from "@/utils/logs";
import { muscles, palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatBodyWeight, formatWeightInput } from "@/utils/units";

type EditingWorkout = {
  sessionId: number;
  exerciseId: number;
  workoutDate: string;
  notes: string;
  machineProfileId?: string | null;
  sets: LoggedSetDraft[];
};

const emptySet = (): LoggedSetDraft => ({ reps: "", weight: "" });
type SaveState = "idle" | "saving" | "saved";

export function LogsScreen() {
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const machineProfiles = useFitnessStore((state) => state.machineProfiles);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const points = useFitnessStore((state) => state.exercisePoints);
  const completedGuidedWorkouts = useFitnessStore((state) => state.completedGuidedWorkouts);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const deleteWorkoutLog = useFitnessStore((state) => state.deleteWorkoutLog);
  const updateWorkoutLog = useFitnessStore((state) => state.updateWorkoutLog);
  const deleteBodyWeightLog = useFitnessStore((state) => state.deleteBodyWeightLog);
  const logs = buildPreviousLogs({ exercises, sessions, sets, points, unitSystem, machineProfiles });
  const groupedLogs = useMemo(() => groupLogsByMuscle(logs, exercises), [exercises, logs]);
  const [bodyWeightCollapsed, setBodyWeightCollapsed] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedMuscles, setCollapsedMuscles] = useState<Record<string, boolean>>({});
  const [editingWorkout, setEditingWorkout] = useState<EditingWorkout | null>(null);
  const [updateSaveState, setUpdateSaveState] = useState<SaveState>("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingWorkoutId, setDeletingWorkoutId] = useState<number | null>(null);
  const [deletingBodyWeightId, setDeletingBodyWeightId] = useState<number | null>(null);

  function startEditWorkout(log: ReturnType<typeof buildPreviousLogs>[number]) {
    const session = sessions.find((item) => item.id === log.sessionId);
    const sessionSets = sets
      .filter((set) => set.session_id === log.sessionId)
      .sort((a, b) => a.set_number - b.set_number)
      .map((set) => ({ reps: String(set.reps), weight: formatWeightInput(set.weight, unitSystem), isWarmup: Boolean(set.is_warmup) }));
    setUpdateSaveState("idle");
    setUpdateError(null);
    setEditingWorkout({
      sessionId: log.sessionId,
      exerciseId: log.exerciseId,
      workoutDate: session?.workout_date ?? log.date,
      notes: session?.notes ?? "",
      machineProfileId: session?.machine_profile_id ?? null,
      sets: sessionSets.length ? sessionSets : [emptySet()]
    });
  }

  function clearEditWorkout() {
    setEditingWorkout(null);
  }

  async function handleUpdateWorkout() {
    if (!editingWorkout || updateSaveState === "saving") return;
    setUpdateSaveState("saving");
    setUpdateError(null);
    try {
      await updateWorkoutLog(editingWorkout);
      setUpdateSaveState("saved");
      setTimeout(() => {
        clearEditWorkout();
        setUpdateSaveState("idle");
      }, 900);
    } catch (error) {
      setUpdateSaveState("idle");
      setUpdateError(error instanceof Error ? error.message : "Could not update scored workout.");
    }
  }

  async function handleDeleteWorkout(sessionId: number) {
    if (deletingWorkoutId !== null) return;
    setDeletingWorkoutId(sessionId);
    try {
      await deleteWorkoutLog(sessionId);
    } finally {
      setDeletingWorkoutId(null);
    }
  }

  async function handleDeleteBodyWeight(id: number) {
    if (deletingBodyWeightId !== null) return;
    setDeletingBodyWeightId(id);
    try {
      await deleteBodyWeightLog(id);
    } finally {
      setDeletingBodyWeightId(null);
    }
  }

  return (
    <Screen>
      <View>
        <Label>Workout history</Label>
        <Title>Logs</Title>
      </View>

      <Panel>
        <SectionTitle>Completed guided workouts</SectionTitle>
        {completedGuidedWorkouts.length ? completedGuidedWorkouts.map((workout) => {
          const achievements = workout.completedExercises.filter((exercise) => exercise.guidedOutcome?.celebrated).length;
          return (
            <View key={workout.id} style={styles.completedWorkoutRow}>
              <View style={styles.historyText}>
                <Body style={styles.dateText}>{formatShortDate(workout.workoutDate)} · {formatCompletedDuration(workout.startedAt, workout.finishedAt)}</Body>
                <Body>{workout.completedExercises.length} exercises{achievements ? ` · ${achievements} target${achievements === 1 ? "" : "s"} cleared` : " · work recorded"}</Body>
              </View>
              <Pressable
                accessibilityLabel={`View workout summary from ${workout.workoutDate}`}
                onPress={() => navigation.navigate("WorkoutSummary", { workout, finishedAt: workout.finishedAt })}
                style={pressableFeedback(styles.summaryButton)}
              >
                <Body style={styles.summaryButtonText}>Summary</Body>
                <ChevronRight size={16} color={palette.ink} />
              </Pressable>
            </View>
          );
        }) : <Body>Finish a guided workout to see its summary here.</Body>}
      </Panel>

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
                <Pressable disabled={deletingBodyWeightId === log.id} accessibilityLabel={`Delete body weight log from ${log.logged_at.slice(0, 10)}`} onPress={() => void handleDeleteBodyWeight(log.id)} style={styles.deleteButton}>
                  {deletingBodyWeightId === log.id ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={16} color={palette.danger} />}
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

                    {!isCollapsed ? group.logs.map((log) => {
                      const isEditing = editingWorkout?.sessionId === log.sessionId;
                      const loadType = getExerciseLoadType(log.exerciseName);
                      return (
                      <View key={log.sessionId} style={styles.historyRow}>
                        {isEditing && editingWorkout ? (
                          <View style={styles.editForm}>
                            <View style={styles.summaryRow}>
                              <SectionTitle>Edit log</SectionTitle>
                              <Pressable accessibilityLabel="Cancel workout edit" hitSlop={touchHitSlop} onPress={clearEditWorkout} style={pressableFeedback(styles.iconButton)}>
                                <X size={17} color={palette.ink} />
                              </Pressable>
                            </View>
                            <DatePickerField value={editingWorkout.workoutDate} onChange={(workoutDate) => setEditingWorkout((current) => current ? { ...current, workoutDate } : current)} />
                            {loadType !== "external" ? <Body style={styles.hintText}>{loadType === "machine_stack" ? "Enter the stack/load number shown on the machine." : loadType === "bodyweight_plus_load" ? "Enter added weight only; body weight is included in scoring." : "Enter assistance weight; it is subtracted from body weight for scoring."}</Body> : null}
                            {editingWorkout.sets.map((set, index) => (
                              <View key={index} style={styles.setRow}>
                                <Label style={styles.setNumber}>{index + 1}</Label>
                                <TextInput
                                  style={[styles.input, styles.setInput]}
                                  value={set.weight}
                                  onChangeText={(weight) => updateEditingSet(index, "weight", weight)}
                                  keyboardType="decimal-pad"
                                  inputMode="decimal"
                                  placeholder={loadPlaceholder(loadType, unitSystem)}
                                />
                                <TextInput
                                  style={[styles.input, styles.setInput]}
                                  value={set.reps}
                                  onChangeText={(reps) => updateEditingSet(index, "reps", reps)}
                                  keyboardType="number-pad"
                                  inputMode="numeric"
                                  placeholder="reps"
                                />
                                <Pressable onPress={() => setEditingWorkout((current) => current ? { ...current, sets: current.sets.map((item, itemIndex) => itemIndex === index ? { ...item, isWarmup: !item.isWarmup } : item) } : current)} style={pressableFeedback([styles.kindButton, set.isWarmup && styles.kindButtonActive])}>
                                  <Body style={[styles.kindText, set.isWarmup && styles.kindTextActive]}>{set.isWarmup ? "Warm-up" : "Working"}</Body>
                                </Pressable>
                                <Pressable
                                  accessibilityLabel="Remove set"
                                  hitSlop={touchHitSlop}
                                  onPress={() => setEditingWorkout((current) => current ? { ...current, sets: current.sets.filter((_, itemIndex) => itemIndex !== index) } : current)}
                                  style={pressableFeedback([styles.iconButton, styles.removeButton])}
                                >
                                  <Trash2 size={16} color={palette.danger} />
                                </Pressable>
                              </View>
                            ))}
                            <Pressable hitSlop={touchHitSlop} onPress={() => setEditingWorkout((current) => current ? { ...current, sets: [...current.sets, emptySet()] } : current)} style={pressableFeedback(styles.secondaryButton)}>
                              <Plus size={17} color={palette.ink} />
                              <Body style={styles.secondaryButtonText}>Add set</Body>
                            </Pressable>
                            <TextInput
                              style={[styles.input, styles.notes]}
                              value={editingWorkout.notes}
                              onChangeText={(notes) => setEditingWorkout((current) => current ? { ...current, notes } : current)}
                              multiline
                              placeholder="Notes"
                            />
                            {updateError ? <Body style={styles.errorText}>{updateError}</Body> : null}
                            <Pressable disabled={updateSaveState === "saving"} hitSlop={touchHitSlop} onPress={() => void handleUpdateWorkout()} style={pressableFeedback(styles.primaryButton)}>
                              {updateSaveState === "saving" ? <ActivityIndicator color={palette.surface} /> : updateSaveState === "saved" ? <Check size={18} color={palette.surface} /> : <Save size={18} color={palette.surface} />}
                              <Body style={styles.primaryButtonText}>{updateSaveState === "saving" ? "Saving" : updateSaveState === "saved" ? "Updated" : "Save changes"}</Body>
                            </Pressable>
                          </View>
                        ) : (
                          <View style={styles.historyHeader}>
                            <View style={styles.historyText}>
                              <Body style={styles.dateText}>{formatShortDate(log.date)} · {log.score ? `${log.score.toFixed(1)} Performance Points` : "Not eligible for points"}</Body>
                              {log.machineProfileLabel ? <Label>{log.machineProfileLabel}</Label> : null}
                              <Body>{log.sets.join("  |  ")}</Body>
                              {log.point ? <Body>e1RM {log.point.estimated1RM.toFixed(1)} | Volume {log.point.failureVolume.toFixed(1)} | Resistance {(log.point.fatigueResistance * 100).toFixed(0)}%</Body> : null}
                            </View>
                            <View style={styles.actions}>
                              <Pressable accessibilityLabel={`Edit workout log from ${log.date}`} onPress={() => startEditWorkout(log)} style={styles.deleteButton}>
                                <Pencil size={16} color={palette.ink} />
                              </Pressable>
                              <Pressable disabled={deletingWorkoutId === log.sessionId} accessibilityLabel={`Delete workout log from ${log.date}`} onPress={() => void handleDeleteWorkout(log.sessionId)} style={styles.deleteButton}>
                                {deletingWorkoutId === log.sessionId ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={16} color={palette.danger} />}
                              </Pressable>
                            </View>
                          </View>
                        )}
                      </View>
                      );
                    }) : null}
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

  function updateEditingSet(index: number, field: "weight" | "reps", value: string) {
    setEditingWorkout((current) =>
      current
        ? {
            ...current,
            sets: current.sets.map((set, itemIndex) => (itemIndex === index ? { ...set, [field]: value } : set))
          }
        : current
    );
  }
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

function loadPlaceholder(loadType: ExerciseLoadType, unitSystem: string) {
  if (loadType === "machine_stack") return "stack";
  if (loadType === "bodyweight_plus_load") return `added ${unitSystem}`;
  if (loadType === "bodyweight_minus_assistance") return `assist ${unitSystem}`;
  return unitSystem;
}

function formatCompletedDuration(startedAt: string, finishedAt: string) {
  const minutes = Math.max(1, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const styles = StyleSheet.create({
  completedWorkoutRow: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  summaryButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  summaryButtonText: {
    fontWeight: "800"
  },
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
  actions: {
    flexDirection: "row",
    gap: spacing.sm
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
  },
  editForm: {
    gap: spacing.md
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    width: "100%",
    minWidth: 0
  },
  setNumber: {
    width: 18,
    textAlign: "center",
    flexShrink: 0
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  setInput: {
    flexBasis: 0,
    paddingHorizontal: spacing.sm
  },
  kindButton: {
    minHeight: 40,
    flexShrink: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    justifyContent: "center",
    paddingHorizontal: spacing.xs
  },
  kindButtonActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent
  },
  kindText: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "800"
  },
  kindTextActive: {
    color: palette.accent
  },
  notes: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: spacing.md
  },
  iconButton: {
    width: 42,
    height: 42,
    flexShrink: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  removeButton: {
    width: 40,
    height: 40
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  secondaryButtonText: {
    color: palette.ink,
    fontWeight: "800"
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  hintText: {
    color: palette.muted
  }
});
