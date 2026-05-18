import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Plus } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { MuscleGroup } from "@/types";
import { muscles, palette, spacing } from "@/utils/theme";

export function ExerciseScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const addExercise = useFitnessStore((state) => state.addExercise);
  const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? 1);
  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup>("Chest");
  const [isStrengthExercise, setIsStrengthExercise] = useState(false);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const selected = strengthExercises.find((exercise) => exercise.id === selectedId) ?? strengthExercises[0];

  async function handleAddExercise() {
    if (!name.trim()) return;
    await addExercise({ name, primaryMuscle: muscle, strength: isStrengthExercise });
    setName("");
    setIsStrengthExercise(false);
  }

  return (
    <Screen>
      <View>
        <Label>Exercise-level progression</Label>
        <Title>Exercises</Title>
      </View>

      <Panel>
        <SectionTitle>Create exercise</SectionTitle>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Exercise name" />
        <View style={styles.chipRow}>
          {muscles.map((item) => (
            <Pressable key={item} onPress={() => setMuscle(item)} style={[styles.chip, muscle === item && styles.chipActive]}>
              <Body style={[styles.chipText, muscle === item && styles.chipTextActive]}>{item}</Body>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.toggleRow} onPress={() => setIsStrengthExercise((current) => !current)}>
          <View style={[styles.checkbox, isStrengthExercise && styles.checkboxActive]}>
            {isStrengthExercise ? <Check size={15} color={palette.surface} /> : null}
          </View>
          <View style={styles.toggleText}>
            <Body style={{ color: palette.ink, fontWeight: "800" }}>Strength exercise</Body>
            <Body>Include this exercise in progress graphs and PR tracking.</Body>
          </View>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={handleAddExercise}>
          <Plus size={18} color={palette.surface} />
          <Body style={styles.primaryButtonText}>Add exercise</Body>
        </Pressable>
      </Panel>

      <Panel>
        <SectionTitle>Exercise graphs</SectionTitle>
        <View style={styles.chipRow}>
          {strengthExercises.map((exercise) => (
            <Pressable key={exercise.id} onPress={() => setSelectedId(exercise.id)} style={[styles.chip, selected?.id === exercise.id && styles.chipActive]}>
              <Body style={[styles.chipText, selected?.id === exercise.id && styles.chipTextActive]}>{exercise.name}</Body>
            </Pressable>
          ))}
        </View>
        {!strengthExercises.length ? <Body>No strength exercises marked yet.</Body> : null}
      </Panel>

    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    backgroundColor: palette.surface,
    fontWeight: "800"
  },
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
  toggleRow: {
    minHeight: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center"
  },
  checkboxActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  toggleText: {
    flex: 1,
    gap: 2
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
