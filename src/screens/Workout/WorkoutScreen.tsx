import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Copy, Plus, Save, Trash2 } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { calculateExerciseScore } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { LoggedSetDraft, MuscleGroup, UnitSystem } from "@/types";
import { todayIso } from "@/utils/date";
import { muscles, palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatWeightInput, weightToStorageUnit } from "@/utils/units";

const emptySet = (): LoggedSetDraft => ({ reps: "", weight: "" });

export function WorkoutScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sets = useFitnessStore((state) => state.sets);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const saveBodyWeightLog = useFitnessStore((state) => state.saveBodyWeightLog);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const [selectedKind, setSelectedKind] = useState<"exercise" | "weight">("exercise");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup>(exercises[0]?.primary_muscle ?? "Chest");
  const [exerciseId, setExerciseId] = useState<number | null>(exercises[0]?.id ?? null);
  const [draftSets, setDraftSets] = useState<LoggedSetDraft[]>([emptySet(), emptySet(), emptySet()]);
  const [weightDraft, setWeightDraft] = useState("");
  const [bodyWeightUnit, setBodyWeightUnit] = useState<UnitSystem>(unitSystem);
  const [workoutDate, setWorkoutDate] = useState(todayIso());
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setBodyWeightUnit(unitSystem);
  }, [unitSystem]);

  const exercisesByMuscle = useMemo(() => {
    return muscles.reduce((output, muscle) => {
      output[muscle] = exercises.filter((exercise) => exercise.primary_muscle === muscle);
      return output;
    }, {} as Record<MuscleGroup, typeof exercises>);
  }, [exercises]);
  const visibleExercises = exercisesByMuscle[selectedMuscle] ?? [];
  const selectedExercise = selectedKind === "exercise" ? visibleExercises.find((exercise) => exercise.id === exerciseId) ?? visibleExercises[0] ?? null : null;
  const previousSets = useMemo(() => {
    if (!selectedExercise) return [];
    const matching = sets.filter((set) => set.exercise_id === selectedExercise.id);
    const lastDate = matching.at(-1)?.created_at.slice(0, 10);
    return matching.filter((set) => set.created_at.slice(0, 10) === lastDate);
  }, [selectedExercise, sets]);

  const projectedScore = useMemo(() => {
    return calculateExerciseScore(
      draftSets
        .map((set, index) => ({ reps: Number(set.reps), weight: Number(set.weight), set_number: index + 1 }))
        .map((set) => ({ ...set, weight: weightToStorageUnit(set.weight, unitSystem) }))
        .filter((set) => set.reps > 0 && set.weight >= 0)
    );
  }, [draftSets, unitSystem]);

  async function handleSave() {
    if (!selectedExercise) return;
    await saveWorkout({ exerciseId: selectedExercise.id, workoutDate, notes, sets: draftSets });
    setDraftSets([emptySet(), emptySet(), emptySet()]);
    setNotes("");
  }

  async function handleSaveWeight() {
    await saveBodyWeightLog({ loggedDate: workoutDate, weight: weightDraft, unitSystem: bodyWeightUnit });
    setWeightDraft("");
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
          {!visibleExercises.length ? <Body>No exercises in {selectedMuscle} yet.</Body> : null}
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
              placeholder={bodyWeightUnit}
            />
            <View style={styles.unitToggle}>
              {(["lb", "kg"] as UnitSystem[]).map((unit) => (
                <Pressable
                  key={unit}
                  hitSlop={touchHitSlop}
                  onPress={() => setBodyWeightUnit(unit)}
                  style={pressableFeedback([styles.unitButton, bodyWeightUnit === unit && styles.unitButtonActive])}
                >
                  <Body style={[styles.unitButtonText, bodyWeightUnit === unit && styles.unitButtonTextActive]}>{unit}</Body>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable hitSlop={touchHitSlop} style={pressableFeedback(styles.primaryButton)} onPress={handleSaveWeight}>
            <Save size={19} color={palette.surface} />
            <Body style={styles.primaryButtonText}>Save weight</Body>
          </Pressable>
        </Panel>
      ) : (
      <Panel>
        <View style={styles.rowBetween}>
          <View>
            <SectionTitle>Working sets</SectionTitle>
            <Body>Projected score: {projectedScore ? projectedScore.toFixed(1) : "..."}</Body>
          </View>
          <Pressable accessibilityLabel="Duplicate previous workout" hitSlop={touchHitSlop} onPress={duplicatePrevious} style={pressableFeedback(styles.iconButton)}>
            <Copy size={18} color={palette.ink} />
          </Pressable>
        </View>

        {draftSets.map((set, index) => (
          <View key={index} style={styles.setRow}>
            <Label style={styles.setNumber}>{index + 1}</Label>
            <TextInput style={[styles.input, styles.setInput]} value={set.weight} onChangeText={(value) => updateSet(index, "weight", value)} keyboardType="decimal-pad" inputMode="decimal" placeholder={unitSystem} />
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

        <Pressable hitSlop={touchHitSlop} style={pressableFeedback(styles.primaryButton)} onPress={handleSave}>
          <Save size={19} color={palette.surface} />
          <Body style={styles.primaryButtonText}>Save workout</Body>
        </Pressable>
      </Panel>
      )}
    </Screen>
  );

  function updateSet(index: number, field: keyof LoggedSetDraft, value: string) {
    setDraftSets((current) => current.map((set, itemIndex) => (itemIndex === index ? { ...set, [field]: value } : set)));
  }
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
    fontWeight: "700"
  },
  bodyWeightRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm
  },
  unitToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: palette.surfaceAlt
  },
  unitButton: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  unitButtonActive: {
    backgroundColor: palette.ink
  },
  unitButtonText: {
    color: palette.muted,
    fontWeight: "900"
  },
  unitButtonTextActive: {
    color: palette.surface
  },
  setInput: {
    flexBasis: 0,
    paddingHorizontal: spacing.sm
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
  }
});
