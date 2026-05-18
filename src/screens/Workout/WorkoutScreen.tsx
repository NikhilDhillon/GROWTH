import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Copy, Plus, Save, Trash2 } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { calculateExerciseScore } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { LoggedSetDraft } from "@/types";
import { todayIso } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";

const emptySet = (): LoggedSetDraft => ({ reps: "", weight: "" });

export function WorkoutScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const sets = useFitnessStore((state) => state.sets);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const [exerciseId, setExerciseId] = useState<number | null>(exercises[0]?.id ?? null);
  const [draftSets, setDraftSets] = useState<LoggedSetDraft[]>([emptySet(), emptySet(), emptySet()]);
  const [workoutDate, setWorkoutDate] = useState(todayIso());
  const [notes, setNotes] = useState("");

  const selectedExercise = exercises.find((exercise) => exercise.id === exerciseId) ?? exercises[0];
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
        .filter((set) => set.reps > 0 && set.weight >= 0)
    );
  }, [draftSets]);

  async function handleSave() {
    if (!selectedExercise) return;
    await saveWorkout({ exerciseId: selectedExercise.id, workoutDate, notes, sets: draftSets });
    setDraftSets([emptySet(), emptySet(), emptySet()]);
    setNotes("");
  }

  function duplicatePrevious() {
    if (!previousSets.length) return;
    setDraftSets(previousSets.map((set) => ({ reps: String(set.reps), weight: String(set.weight) })));
  }

  return (
    <Screen>
      <View>
        <Label>Fast workout capture</Label>
        <Title>Log sets</Title>
      </View>

      <Panel>
        <SectionTitle>Exercise</SectionTitle>
        <View style={styles.exerciseGrid}>
          {exercises.map((exercise) => (
            <Pressable key={exercise.id} onPress={() => setExerciseId(exercise.id)} style={[styles.exerciseButton, exercise.id === selectedExercise?.id && styles.exerciseButtonActive]}>
              <Body style={[styles.exerciseText, exercise.id === selectedExercise?.id && styles.exerciseTextActive]}>{exercise.name}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>

      <Panel>
        <SectionTitle>Date</SectionTitle>
        <DatePickerField value={workoutDate} onChange={setWorkoutDate} />
      </Panel>

      <Panel>
        <View style={styles.rowBetween}>
          <View>
            <SectionTitle>Working sets</SectionTitle>
            <Body>Projected score: {projectedScore ? projectedScore.toFixed(1) : "..."}</Body>
          </View>
          <Pressable accessibilityLabel="Duplicate previous workout" onPress={duplicatePrevious} style={styles.iconButton}>
            <Copy size={18} color={palette.ink} />
          </Pressable>
        </View>

        {draftSets.map((set, index) => (
          <View key={index} style={styles.setRow}>
            <Label style={styles.setNumber}>{index + 1}</Label>
            <TextInput style={styles.input} value={set.weight} onChangeText={(value) => updateSet(index, "weight", value)} keyboardType="numeric" placeholder="lb" />
            <TextInput style={styles.input} value={set.reps} onChangeText={(value) => updateSet(index, "reps", value)} keyboardType="numeric" placeholder="reps" />
            <Pressable accessibilityLabel="Remove set" onPress={() => setDraftSets((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.iconButton}>
              <Trash2 size={16} color={palette.danger} />
            </Pressable>
          </View>
        ))}

        <Pressable style={styles.secondaryButton} onPress={() => setDraftSets((current) => [...current, emptySet()])}>
          <Plus size={18} color={palette.ink} />
          <Body style={styles.buttonText}>Add set</Body>
        </Pressable>

        <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline placeholder="Notes" />

        <Pressable style={styles.primaryButton} onPress={handleSave}>
          <Save size={19} color={palette.surface} />
          <Body style={styles.primaryButtonText}>Save workout</Body>
        </Pressable>
      </Panel>
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
  exerciseButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: palette.surface
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
    gap: spacing.md
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  setNumber: {
    width: 20,
    textAlign: "center"
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontWeight: "700"
  },
  notes: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: spacing.md
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
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
    gap: spacing.sm
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  }
});
