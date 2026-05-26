import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Copy, Plus, Save, Trash2 } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { ExerciseLoadType, getExerciseLoadType } from "@/constants/exercises";
import { getClosestBodyweightForDate } from "@/services/analytics/bulkAnalyticsService";
import { calculateSessionPerformance, findStrengthReference } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { LoggedSetDraft, MuscleGroup } from "@/types";
import { todayIso } from "@/utils/date";
import { muscles, palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { bodyWeightDisplayUnit, formatBodyWeight, formatWeightInput, weightToStorageUnit } from "@/utils/units";

const emptySet = (): LoggedSetDraft => ({ reps: "", weight: "" });
type SaveState = "idle" | "saving" | "saved";

export function WorkoutScreen() {
  const allExercises = useFitnessStore((state) => state.exercises);
  const sets = useFitnessStore((state) => state.sets);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const saveBodyWeightLog = useFitnessStore((state) => state.saveBodyWeightLog);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const exercises = useMemo(() => allExercises.filter((exercise) => exercise.is_strength_exercise), [allExercises]);
  const [selectedKind, setSelectedKind] = useState<"exercise" | "weight">("exercise");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup>(exercises[0]?.primary_muscle ?? "Chest");
  const [exerciseId, setExerciseId] = useState<number | null>(exercises[0]?.id ?? null);
  const [draftSets, setDraftSets] = useState<LoggedSetDraft[]>([emptySet(), emptySet(), emptySet()]);
  const [weightDraft, setWeightDraft] = useState("");
  const [workoutDate, setWorkoutDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [workoutSaveState, setWorkoutSaveState] = useState<SaveState>("idle");
  const [weightSaveState, setWeightSaveState] = useState<SaveState>("idle");
  const [workoutError, setWorkoutError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedKind !== "exercise") return;
    const selectedExists = exercises.some((exercise) => exercise.id === exerciseId);
    if (selectedExists) return;
    const nextExercise = exercises[0] ?? null;
    setSelectedMuscle(nextExercise?.primary_muscle ?? "Chest");
    setExerciseId(nextExercise?.id ?? null);
  }, [exerciseId, exercises, selectedKind]);

  const exercisesByMuscle = useMemo(() => {
    return muscles.reduce((output, muscle) => {
      output[muscle] = exercises.filter((exercise) => exercise.primary_muscle === muscle);
      return output;
    }, {} as Record<MuscleGroup, typeof exercises>);
  }, [exercises]);
  const visibleExercises = exercisesByMuscle[selectedMuscle] ?? [];
  const selectedExercise = selectedKind === "exercise" ? visibleExercises.find((exercise) => exercise.id === exerciseId) ?? visibleExercises[0] ?? null : null;
  const selectedLoadType = getExerciseLoadType(selectedExercise?.name ?? "");
  const selectedBodyWeight = selectedLoadType === "external" ? null : getClosestBodyweightForDate(workoutDate, bodyWeightLogs);
  const previousSets = useMemo(() => {
    if (!selectedExercise) return [];
    const matching = sets.filter((set) => set.exercise_id === selectedExercise.id);
    const lastDate = matching.at(-1)?.created_at.slice(0, 10);
    return matching.filter((set) => set.created_at.slice(0, 10) === lastDate);
  }, [selectedExercise, sets]);

  const projectedPerformance = useMemo(() => {
    const reference = selectedExercise
      ? findStrengthReference(exercisePoints.filter((point) => point.exerciseId === selectedExercise.id && point.date <= workoutDate))
      : undefined;
    return calculateSessionPerformance(
      draftSets
        .map((set, index) => ({ reps: Number(set.reps), weight: Number(set.weight), set_number: index + 1 }))
        .map((set) => ({ ...set, weight: weightToStorageUnit(set.weight, unitSystem) }))
        .filter((set) => set.reps > 0 || set.weight > 0),
      reference,
      { loadType: selectedLoadType, bodyWeight: selectedBodyWeight?.weight }
    );
  }, [draftSets, exercisePoints, selectedBodyWeight?.weight, selectedExercise, selectedLoadType, unitSystem, workoutDate]);

  async function handleSave() {
    if (!selectedExercise || workoutSaveState === "saving") return;
    setWorkoutSaveState("saving");
    setWorkoutError(null);
    try {
      await saveWorkout({ exerciseId: selectedExercise.id, workoutDate, notes, sets: draftSets });
      setDraftSets([emptySet(), emptySet(), emptySet()]);
      setNotes("");
      showSaved(setWorkoutSaveState);
    } catch (error) {
      setWorkoutSaveState("idle");
      setWorkoutError(error instanceof Error ? error.message : "Could not save scored workout.");
    }
  }

  async function handleSaveWeight() {
    if (weightSaveState === "saving") return;
    setWeightSaveState("saving");
    try {
      await saveBodyWeightLog({ loggedDate: workoutDate, weight: weightDraft, unitSystem: bodyWeightDisplayUnit });
      setWeightDraft("");
      showSaved(setWeightSaveState);
    } catch (error) {
      setWeightSaveState("idle");
      throw error;
    }
  }

  function duplicatePrevious() {
    if (!previousSets.length) return;
    setDraftSets(previousSets.map((set) => ({ reps: String(set.reps), weight: formatWeightInput(set.weight, unitSystem) })));
  }

  return (
    <Screen>
      <View>
        <Label>Fast workout capture</Label>
        <Title>{selectedKind === "weight" ? "Log weight" : "Log sets"}</Title>
      </View>

      <Panel>
        <SectionTitle>Log type</SectionTitle>
        <View style={styles.exerciseGrid}>
          <Pressable hitSlop={touchHitSlop} onPress={() => setSelectedKind("weight")} style={pressableFeedback([styles.exerciseButton, selectedKind === "weight" && styles.exerciseButtonActive])}>
            <Body style={[styles.exerciseText, selectedKind === "weight" && styles.exerciseTextActive]}>Weight</Body>
          </Pressable>
        </View>
        <View style={styles.muscleTabs}>
          {muscles.map((muscle) => (
            <Pressable
              key={muscle}
              hitSlop={touchHitSlop}
              onPress={() => {
                setSelectedKind("exercise");
                setSelectedMuscle(muscle);
                setExerciseId(exercisesByMuscle[muscle]?.[0]?.id ?? null);
              }}
              style={pressableFeedback([styles.muscleTab, selectedKind === "exercise" && selectedMuscle === muscle && styles.muscleTabActive])}
            >
              <Body style={[styles.muscleTabText, selectedKind === "exercise" && selectedMuscle === muscle && styles.muscleTabTextActive]}>{muscle}</Body>
            </Pressable>
          ))}
        </View>
        <View style={styles.exerciseGrid}>
          {visibleExercises.map((exercise) => (
            <Pressable
              key={exercise.id}
              hitSlop={touchHitSlop}
              onPress={() => {
                setSelectedKind("exercise");
                setSelectedMuscle(exercise.primary_muscle);
                setExerciseId(exercise.id);
              }}
              style={pressableFeedback([styles.exerciseButton, selectedKind === "exercise" && exercise.id === selectedExercise?.id && styles.exerciseButtonActive])}
            >
              <Body style={[styles.exerciseText, selectedKind === "exercise" && exercise.id === selectedExercise?.id && styles.exerciseTextActive]}>{exercise.name}</Body>
            </Pressable>
          ))}
          {!visibleExercises.length ? <Body>No selected exercises in {selectedMuscle} yet.</Body> : null}
        </View>
      </Panel>

      <Panel>
        <SectionTitle>Date</SectionTitle>
        <DatePickerField value={workoutDate} onChange={setWorkoutDate} />
      </Panel>

      {selectedKind === "weight" ? (
        <Panel>
          <SectionTitle>Body weight</SectionTitle>
          <View style={styles.bodyWeightRow}>
            <TextInput
              style={styles.input}
              value={weightDraft}
              onChangeText={setWeightDraft}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={bodyWeightDisplayUnit}
            />
            <View style={styles.unitBadge}>
              <Body style={styles.unitBadgeText}>{bodyWeightDisplayUnit}</Body>
            </View>
          </View>
          <Pressable disabled={weightSaveState === "saving"} hitSlop={touchHitSlop} style={pressableFeedback(styles.primaryButton)} onPress={handleSaveWeight}>
            {weightSaveState === "saving" ? <ActivityIndicator color={palette.surface} /> : weightSaveState === "saved" ? <Check size={19} color={palette.surface} /> : <Save size={19} color={palette.surface} />}
            <Body style={styles.primaryButtonText}>{weightSaveState === "saving" ? "Saving" : weightSaveState === "saved" ? "Added" : "Save weight"}</Body>
          </Pressable>
        </Panel>
      ) : !exercises.length ? (
        <Panel>
          <SectionTitle>No exercises selected</SectionTitle>
          <Body>Select exercises on the Exercises page to make them available for logging.</Body>
        </Panel>
      ) : (
      <Panel>
        <View style={styles.rowBetween}>
          <View>
            <SectionTitle>Working sets</SectionTitle>
            <Body>Projected Performance Points: {projectedPerformance ? projectedPerformance.performancePoints.toFixed(1) : selectedLoadType !== "external" && !selectedBodyWeight ? "Log body weight first" : "..."}</Body>
          </View>
          <Pressable accessibilityLabel="Duplicate previous workout" hitSlop={touchHitSlop} onPress={duplicatePrevious} style={pressableFeedback(styles.iconButton)}>
            <Copy size={18} color={palette.ink} />
          </Pressable>
        </View>

        {selectedLoadType !== "external" ? <Body style={styles.loadHint}>{loadInstruction(selectedLoadType, selectedBodyWeight?.weight)}</Body> : null}

        {draftSets.map((set, index) => (
          <View key={index} style={styles.setRow}>
            <Label style={styles.setNumber}>{index + 1}</Label>
            <TextInput style={[styles.input, styles.setInput]} value={set.weight} onChangeText={(value) => updateSet(index, "weight", value)} keyboardType="decimal-pad" inputMode="decimal" placeholder={loadPlaceholder(selectedLoadType, unitSystem)} />
            <TextInput style={[styles.input, styles.setInput]} value={set.reps} onChangeText={(value) => updateSet(index, "reps", value)} keyboardType="number-pad" inputMode="numeric" placeholder="reps" />
            <Pressable accessibilityLabel="Remove set" hitSlop={touchHitSlop} onPress={() => setDraftSets((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={pressableFeedback([styles.iconButton, styles.removeButton])}>
              <Trash2 size={16} color={palette.danger} />
            </Pressable>
          </View>
        ))}

        <Pressable hitSlop={touchHitSlop} style={pressableFeedback(styles.secondaryButton)} onPress={() => setDraftSets((current) => [...current, emptySet()])}>
          <Plus size={18} color={palette.ink} />
          <Body style={styles.buttonText}>Add set</Body>
        </Pressable>

        <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline placeholder="Notes" />
        {projectedPerformance ? (
          <Body>
            e1RM {projectedPerformance.estimated1RM.toFixed(1)} | Volume {projectedPerformance.failureVolume.toFixed(1)} | Resistance {(projectedPerformance.fatigueResistance * 100).toFixed(0)}%
          </Body>
        ) : null}
        {workoutError ? <Body style={styles.errorText}>{workoutError}</Body> : null}

        <Pressable disabled={workoutSaveState === "saving"} hitSlop={touchHitSlop} style={pressableFeedback(styles.primaryButton)} onPress={handleSave}>
          {workoutSaveState === "saving" ? <ActivityIndicator color={palette.surface} /> : workoutSaveState === "saved" ? <Check size={19} color={palette.surface} /> : <Save size={19} color={palette.surface} />}
          <Body style={styles.primaryButtonText}>{workoutSaveState === "saving" ? "Saving" : workoutSaveState === "saved" ? "Added" : "Save workout"}</Body>
        </Pressable>
      </Panel>
      )}
    </Screen>
  );

  function updateSet(index: number, field: keyof LoggedSetDraft, value: string) {
    setDraftSets((current) => current.map((set, itemIndex) => (itemIndex === index ? { ...set, [field]: value } : set)));
  }
}

function showSaved(setState: (state: SaveState) => void) {
  setState("saved");
  setTimeout(() => setState("idle"), 900);
}

function loadPlaceholder(loadType: ExerciseLoadType, unitSystem: string) {
  if (loadType === "bodyweight_plus_load") return `added ${unitSystem}`;
  if (loadType === "bodyweight_minus_assistance") return `assist ${unitSystem}`;
  return unitSystem;
}

function loadInstruction(loadType: ExerciseLoadType, bodyWeight?: number) {
  const basis = bodyWeight ? `Body weight ${formatBodyWeight(bodyWeight)} is included.` : "Log body weight to calculate Performance Points.";
  if (loadType === "bodyweight_plus_load") return `Enter added weight only; use 0 for bodyweight reps. ${basis}`;
  return `Enter assistance weight; use 0 for unassisted reps. ${basis}`;
}

const styles = StyleSheet.create({
  exerciseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  muscleTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    paddingBottom: spacing.sm
  },
  muscleTab: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  muscleTabActive: {
    backgroundColor: palette.accentSoft
  },
  muscleTabText: {
    color: palette.muted,
    fontWeight: "900"
  },
  muscleTabTextActive: {
    color: palette.ink
  },
  exerciseButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  exerciseButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  exerciseText: {
    color: palette.ink,
    fontWeight: "800"
  },
  exerciseTextActive: {
    color: palette.surface
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0
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
  bodyWeightRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm
  },
  unitBadge: {
    minWidth: 48,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: palette.ink,
    ...fastTouchStyle
  },
  unitBadgeText: {
    color: palette.surface,
    fontWeight: "900"
  },
  setInput: {
    flexBasis: 0,
    paddingHorizontal: spacing.sm
  },
  loadHint: {
    color: palette.muted
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
  buttonText: {
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
  }
});
