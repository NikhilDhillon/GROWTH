import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, Dumbbell, Pencil, Timer, X } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { createActiveWorkout, todaySplitDay } from "@/constants/activeWorkout";
import { cloneTrainingSplitDays } from "@/constants/trainingSplit";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatShortDate } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

type MuscleLocation = { dayIndex: number; muscleIndex: number };

export function HomeScreen() {
  const trainingSplit = useFitnessStore((state) => state.trainingSplit);
  const saveTrainingSplit = useFitnessStore((state) => state.saveTrainingSplit);
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const startActiveWorkout = useFitnessStore((state) => state.startActiveWorkout);
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const [isEditing, setIsEditing] = useState(false);
  const [draftDays, setDraftDays] = useState(() => cloneTrainingSplitDays(trainingSplit.days));
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleLocation | null>(null);
  const [draggedMuscle, setDraggedMuscle] = useState<MuscleLocation | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!isEditing) setDraftDays(cloneTrainingSplitDays(trainingSplit.days));
  }, [isEditing, trainingSplit.days]);

  useEffect(() => {
    if (!activeWorkout) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeWorkout]);

  const displayedDays = isEditing ? draftDays : trainingSplit.days;

  function beginEdit() {
    setDraftDays(cloneTrainingSplitDays(trainingSplit.days));
    setSelectedMuscle(null);
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setDraftDays(cloneTrainingSplitDays(trainingSplit.days));
    setSelectedMuscle(null);
    setSaveError(null);
    setIsEditing(false);
  }

  function chooseMuscle(location: MuscleLocation) {
    if (selectedMuscle?.dayIndex === location.dayIndex && selectedMuscle.muscleIndex === location.muscleIndex) {
      setSelectedMuscle(null);
      return;
    }
    setSelectedMuscle(location);
  }

  function moveMuscle(targetDayIndex: number, source = selectedMuscle) {
    if (!source || source.dayIndex === targetDayIndex) return;
    setDraftDays((days) => {
      const next = cloneTrainingSplitDays(days);
      const [muscle] = next[source.dayIndex].muscles.splice(source.muscleIndex, 1);
      if (muscle) next[targetDayIndex].muscles.push(muscle);
      return next;
    });
    setSelectedMuscle(null);
    setDraggedMuscle(null);
  }

  async function saveSplit() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveTrainingSplit(draftDays);
      setIsEditing(false);
      setSelectedMuscle(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the split.");
    } finally {
      setIsSaving(false);
    }
  }

  async function openWorkout() {
    if (!activeWorkout) {
      await startActiveWorkout(createActiveWorkout(todaySplitDay(trainingSplit.days)));
    }
    navigation.navigate("ActiveWorkout");
  }

  function dragProps(location: MuscleLocation) {
    if (Platform.OS !== "web") return {};
    return {
      draggable: true,
      onDragStart: () => setDraggedMuscle(location)
    } as object;
  }

  function dropProps(dayIndex: number) {
    if (Platform.OS !== "web") return {};
    return {
      onDragOver: (event: { preventDefault: () => void }) => event.preventDefault(),
      onDrop: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        moveMuscle(dayIndex, draggedMuscle);
      }
    } as object;
  }

  return (
    <Screen>
      <View>
        <Label>Weekly training plan</Label>
        <Title>Current split</Title>
      </View>

      <Panel>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <SectionTitle>Weekly split</SectionTitle>
            <Body>
              {trainingSplit.updated_at && trainingSplit.updated_by
                ? `Last updated ${formatShortDate(trainingSplit.updated_at.slice(0, 10))} by ${trainingSplit.updated_by}.`
                : "Default schedule. Save an edit to establish your plan."}
            </Body>
          </View>
          {!isEditing ? (
            <Pressable accessibilityLabel="Edit weekly split" onPress={beginEdit} style={pressableFeedback(styles.actionButton)}>
              <Pencil size={16} color={palette.ink} />
              <Body style={styles.actionText}>Edit</Body>
            </Pressable>
          ) : null}
        </View>

        {isEditing ? <Body>Drag muscle blocks between days on desktop, or select a muscle and tap its destination day.</Body> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.splitTable}>
            {displayedDays.map((day, dayIndex) => (
              <Pressable
                key={day.key}
                {...dropProps(dayIndex)}
                onPress={() => {
                  if (isEditing) moveMuscle(dayIndex);
                }}
                style={[styles.dayColumn, selectedMuscle && isEditing && styles.dayDropTarget]}
              >
                <Label style={styles.dayHeader}>{day.label}</Label>
                <View style={styles.dayMuscles}>
                  {day.muscles.length ? day.muscles.map((muscle, muscleIndex) => {
                    const isSelected = selectedMuscle?.dayIndex === dayIndex && selectedMuscle.muscleIndex === muscleIndex;
                    return isEditing ? (
                      <Pressable
                        key={`${muscle}-${muscleIndex}`}
                        {...dragProps({ dayIndex, muscleIndex })}
                        onPress={(event) => {
                          event.stopPropagation();
                          chooseMuscle({ dayIndex, muscleIndex });
                        }}
                        style={[styles.muscleChip, styles.editableChip, isSelected && styles.muscleChipSelected]}
                      >
                        <Body style={[styles.muscleText, isSelected && styles.muscleTextSelected]}>{muscle}</Body>
                      </Pressable>
                    ) : (
                      <View key={`${muscle}-${muscleIndex}`} style={styles.muscleChip}>
                        <Body style={styles.muscleText}>{muscle}</Body>
                      </View>
                    );
                  }) : <Body style={styles.restText}>Rest</Body>}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {isEditing ? (
          <>
            <Body>Saving updates this schedule for friends who accepted split synchronization.</Body>
            {saveError ? <Body style={styles.errorText}>{saveError}</Body> : null}
            <View style={styles.editActions}>
              <Pressable disabled={isSaving} onPress={cancelEdit} style={pressableFeedback(styles.actionButton)}>
                <X size={17} color={palette.ink} />
                <Body style={styles.actionText}>Cancel</Body>
              </Pressable>
              <Pressable disabled={isSaving} onPress={() => void saveSplit()} style={pressableFeedback(styles.saveButton)}>
                <Check size={17} color={palette.surface} />
                <Body style={styles.saveText}>{isSaving ? "Saving" : "Save split"}</Body>
              </Pressable>
            </View>
          </>
        ) : (
          <Body>Use Social to request split synchronization with specific friends.</Body>
        )}
      </Panel>

      <Panel>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Label>Guided training</Label>
            <SectionTitle>{activeWorkout ? "Workout in progress" : "Ready to train?"}</SectionTitle>
            <Body>
              {activeWorkout
                ? `Elapsed time ${formatElapsed(activeWorkout.startedAt, clock)}. Continue where you left off.`
                : "Follow today's split and build on your previous performance."}
            </Body>
          </View>
          {activeWorkout ? <Timer size={22} color={palette.accent} /> : <Dumbbell size={22} color={palette.accent} />}
        </View>
        <Pressable onPress={() => void openWorkout()} style={pressableFeedback(styles.startButton)}>
          <Body style={styles.startText}>{activeWorkout ? "Resume workout" : "Start workout"}</Body>
        </Pressable>
      </Panel>
    </Screen>
  );
}

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs
  },
  actionButton: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md
  },
  actionText: {
    color: palette.ink,
    fontWeight: "900"
  },
  splitTable: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    overflow: "hidden"
  },
  dayColumn: {
    width: 112,
    minHeight: 152,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    backgroundColor: palette.surfaceAlt,
    padding: spacing.sm,
    gap: spacing.sm
  },
  dayDropTarget: {
    backgroundColor: palette.accentSoft
  },
  dayHeader: {
    textAlign: "center"
  },
  dayMuscles: {
    gap: spacing.xs,
    alignItems: "stretch"
  },
  muscleChip: {
    borderRadius: 7,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  editableChip: {
    backgroundColor: palette.accentSoft
  },
  muscleChipSelected: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  muscleText: {
    color: palette.ink,
    fontWeight: "800",
    textAlign: "center"
  },
  muscleTextSelected: {
    color: palette.surface
  },
  restText: {
    color: palette.muted,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: spacing.sm
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm
  },
  saveButton: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md
  },
  saveText: {
    color: palette.surface,
    fontWeight: "900"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  startButton: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center"
  },
  startText: {
    color: palette.surface,
    fontWeight: "900",
    fontSize: 16
  }
});
