import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Search } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, SectionTitle } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { createThemedStyles } from "@/utils/themedStyles";
import { muscles, spacing } from "@/utils/theme";

export function ExerciseScreen() {
  const { palette, styles } = useStyles();
  const exercises = useFitnessStore((state) => state.exercises);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const groupedExercises = useMemo(() => {
    return muscles.map((muscle) => ({
      muscle,
      exercises: exercises
        .filter((exercise) => exercise.primary_muscle === muscle)
        .filter((exercise) => !normalizedQuery || `${exercise.name} ${exercise.primary_muscle} ${exercise.secondary_muscle ?? ""}`.toLowerCase().includes(normalizedQuery))
        .sort((a, b) => a.name.localeCompare(b.name))
    })).filter((group) => group.exercises.length > 0);
  }, [exercises, normalizedQuery]);

  return (
    <Screen>

      <Panel>
        <SectionTitle>Browse all exercises</SectionTitle>
        <View style={styles.searchBox}>
          <Search size={18} color={palette.muted} />
          <TextInput
            accessibilityLabel="Search exercises by name or muscle"
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </Panel>

      {!groupedExercises.length ? <Panel><Body>No matching exercises.</Body></Panel> : null}
      {groupedExercises.map((group) => (
        <Panel key={group.muscle}>
          <View style={styles.muscleHeading}>
            <SectionTitle>{group.muscle}</SectionTitle>
            <Body style={styles.groupCount}>{group.exercises.length}</Body>
          </View>
          {group.exercises.map((exercise) => (
            <View key={exercise.id} style={styles.exerciseRow}>
              <View style={styles.exerciseInfo}>
                <SectionTitle style={styles.exerciseName}>{exercise.name}</SectionTitle>
                {exercise.secondary_muscle ? <Body style={styles.muscleMeta}>Also: {exercise.secondary_muscle}</Body> : null}
              </View>
            </View>
          ))}
        </Panel>
      ))}
    </Screen>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  muscleHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  groupCount: {
    color: palette.muted,
    fontWeight: "800"
  },
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
    minHeight: 58,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  exerciseInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  exerciseName: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 20
  },
  muscleMeta: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16
  }
}));
