import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Search } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { muscles, palette, spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";

export function ExerciseScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const setExerciseEnabled = useFitnessStore((state) => state.setExerciseEnabled);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const groupedExercises = useMemo(() => {
    return muscles.map((muscle) => ({
      muscle,
      exercises: exercises
        .filter((exercise) => exercise.primary_muscle === muscle)
        .filter((exercise) => !normalizedQuery || exercise.name.toLowerCase().includes(normalizedQuery))
        .sort((a, b) => a.name.localeCompare(b.name))
    }));
  }, [exercises, normalizedQuery]);

  const selectedCount = exercises.filter((exercise) => exercise.is_strength_exercise).length;

  return (
    <Screen>
      <View>
        <Label>Exercise library</Label>
        <Title>Exercises</Title>
      </View>

      <Panel>
        <SectionTitle>Logging selection</SectionTitle>
        <Body>{selectedCount} of {exercises.length} exercises selected for logging and scoring.</Body>
        <View style={styles.searchBox}>
          <Search size={18} color={palette.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </Panel>

      {groupedExercises.map((group) => (
        <Panel key={group.muscle}>
          <SectionTitle>{group.muscle}</SectionTitle>
          {group.exercises.length ? (
            group.exercises.map((exercise) => {
              const selected = Boolean(exercise.is_strength_exercise);
              return (
                <Pressable
                  key={exercise.id}
                  hitSlop={touchHitSlop}
                  onPress={() => void setExerciseEnabled(exercise.id, !selected)}
                  style={pressableFeedback(styles.exerciseRow)}
                >
                  <View style={[styles.checkbox, selected && styles.checkboxActive]}>
                    {selected ? <Check size={16} color={palette.surface} /> : null}
                  </View>
                  <View style={styles.exerciseInfo}>
                    <Body style={styles.exerciseName}>{exercise.name}</Body>
                    {exercise.secondary_muscle ? <Body>{exercise.primary_muscle} · {exercise.secondary_muscle}</Body> : <Body>{exercise.primary_muscle}</Body>}
                  </View>
                </Pressable>
              );
            })
          ) : (
            <Body>No matching exercises.</Body>
          )}
        </Panel>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: palette.surface
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800"
  },
  exerciseRow: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface
  },
  checkboxActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  exerciseInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  exerciseName: {
    color: palette.ink,
    fontWeight: "900"
  }
});
