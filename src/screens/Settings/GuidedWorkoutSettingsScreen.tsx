import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, ArrowRightLeft, Check, Plus, X } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { categoryForExercise, guidedCategoryLabels } from "@/constants/guidedWorkout";
import { useFitnessStore } from "@/store/useFitnessStore";
import { GuidedExerciseCategory, GuidedWorkoutPreferences } from "@/types";
import { palette, spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

const guidedCategories = Object.keys(guidedCategoryLabels) as GuidedExerciseCategory[];
type NumericPreference = keyof Omit<GuidedWorkoutPreferences, "exerciseCategories">;

export function GuidedWorkoutSettingsScreen() {
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const savedPreferences = useFitnessStore((state) => state.guidedWorkoutPreferences);
  const saveGuidedWorkoutPreferences = useFitnessStore((state) => state.saveGuidedWorkoutPreferences);
  const [draft, setDraft] = useState(savedPreferences);
  const [selectedCategory, setSelectedCategory] = useState<GuidedExerciseCategory>("hypertrophy");
  const [movingExerciseName, setMovingExerciseName] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(savedPreferences), [savedPreferences]);

  const groupedExercises = useMemo(() => guidedCategories.reduce<Record<GuidedExerciseCategory, typeof exercises>>((groups, category) => {
    groups[category] = exercises.filter((exercise) => categoryForExercise(exercise.name, draft) === category);
    return groups;
  }, { hypertrophy: [], strength: [], top_set: [], unguided: [] }), [draft, exercises]);
  const displayedExercises = groupedExercises[selectedCategory];
  const addableExercises = exercises.filter((exercise) => categoryForExercise(exercise.name, draft) !== selectedCategory);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedPreferences);

  function updateNumberPreference(key: NumericPreference, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setMessage(null);
    setDraft((current) => ({ ...current, [key]: parsed }));
  }

  function moveExercise(exerciseName: string, targetCategory: GuidedExerciseCategory) {
    setDraft((current) => ({
      ...current,
      exerciseCategories: { ...current.exerciseCategories, [exerciseName]: targetCategory }
    }));
    setMessage(null);
    setError(null);
    setMovingExerciseName(null);
    setShowAdd(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveGuidedWorkoutPreferences(draft);
      setMessage("Guided workout preferences saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save guided workout preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.titleRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to settings" onPress={() => navigation.navigate("Settings")} style={pressableFeedback(styles.backButton)}>
          <ArrowLeft size={19} color={palette.ink} />
        </Pressable>
        <View>
          <Label>Guided workout</Label>
          <Title>Preferences</Title>
        </View>
      </View>

      <Panel>
        <SectionTitle>Progression targets</SectionTitle>
        <Body>These targets apply to working sets. Changes are used only after you save.</Body>
        <View style={styles.preferenceGrid}>
          <PreferenceField label="Hypertrophy first set reps" value={draft.hypertrophyTargetReps} onChange={(value) => updateNumberPreference("hypertrophyTargetReps", value)} />
          <PreferenceField label="Pyramid decrement" value={draft.hypertrophyRepDecrement} onChange={(value) => updateNumberPreference("hypertrophyRepDecrement", value)} />
          <PreferenceField label="Strength reps" value={draft.strengthTargetReps} onChange={(value) => updateNumberPreference("strengthTargetReps", value)} />
          <PreferenceField label="Top-set reps" value={draft.topSetTargetReps} onChange={(value) => updateNumberPreference("topSetTargetReps", value)} />
          <PreferenceField label="Back-off starting %" value={draft.backoffPercentage} onChange={(value) => updateNumberPreference("backoffPercentage", value)} />
          <PreferenceField label="Pause increases after days" value={draft.inactivityDays} onChange={(value) => updateNumberPreference("inactivityDays", value)} />
        </View>
      </Panel>

      <Panel>
        <SectionTitle>Exercise groups</SectionTitle>
        <Body>Every exercise belongs to one group. Removing an exercise from this group means moving it to another one.</Body>
        <View style={styles.categoryTabs}>
          {guidedCategories.map((category) => {
            const selected = selectedCategory === category;
            return (
              <Pressable
                key={category}
                onPress={() => {
                  setSelectedCategory(category);
                  setMovingExerciseName(null);
                  setShowAdd(false);
                }}
                style={pressableFeedback([styles.categoryTab, selected && styles.categoryTabActive])}
              >
                <Body style={[styles.categoryTabText, selected && styles.categoryTabTextActive]}>{guidedCategoryLabels[category]}</Body>
                <Body style={[styles.categoryCount, selected && styles.categoryTabTextActive]}>{groupedExercises[category].length}</Body>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.groupHeader}>
          <Label>{guidedCategoryLabels[selectedCategory]} exercises</Label>
          <Pressable onPress={() => {
            setShowAdd((current) => !current);
            setMovingExerciseName(null);
          }} style={pressableFeedback(styles.secondaryButton)}>
            {showAdd ? <X size={16} color={palette.ink} /> : <Plus size={16} color={palette.ink} />}
            <Body style={styles.secondaryButtonText}>{showAdd ? "Cancel" : "Add"}</Body>
          </Pressable>
        </View>

        {showAdd ? (
          <View style={styles.addPanel}>
            <Body>Choose an exercise to move into {guidedCategoryLabels[selectedCategory]}.</Body>
            {addableExercises.map((exercise) => (
              <View key={exercise.id} style={styles.exerciseRow}>
                <View style={styles.exerciseIdentity}>
                  <Body style={styles.exerciseName}>{exercise.name}</Body>
                  <Body>{guidedCategoryLabels[categoryForExercise(exercise.name, draft)]}</Body>
                </View>
                <Pressable onPress={() => moveExercise(exercise.name, selectedCategory)} style={pressableFeedback(styles.secondaryButton)}>
                  <Body style={styles.secondaryButtonText}>Add</Body>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {!displayedExercises.length ? <Body>No exercises currently assigned to this group.</Body> : displayedExercises.map((exercise) => {
          const isMoving = movingExerciseName === exercise.name;
          return (
            <View key={exercise.id} style={styles.assignedExercise}>
              <View style={styles.exerciseRow}>
                <Body style={styles.exerciseName}>{exercise.name}</Body>
                <Pressable onPress={() => setMovingExerciseName(isMoving ? null : exercise.name)} style={pressableFeedback(styles.secondaryButton)}>
                  <ArrowRightLeft size={15} color={palette.ink} />
                  <Body style={styles.secondaryButtonText}>{isMoving ? "Cancel" : "Move"}</Body>
                </Pressable>
              </View>
              {isMoving ? (
                <View style={styles.moveTargets}>
                  <Body>Move to:</Body>
                  {guidedCategories.filter((category) => category !== selectedCategory).map((category) => (
                    <Pressable key={category} onPress={() => moveExercise(exercise.name, category)} style={pressableFeedback(styles.moveButton)}>
                      <Body style={styles.secondaryButtonText}>{guidedCategoryLabels[category]}</Body>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Panel>

      <View style={styles.saveArea}>
        {message ? <Body style={styles.saved}>{message}</Body> : null}
        {error ? <Body style={styles.error}>{error}</Body> : null}
        <Pressable disabled={!dirty || saving} onPress={() => void save()} style={pressableFeedback([styles.saveButton, (!dirty || saving) && styles.disabledButton])}>
          <Check size={18} color={palette.surface} />
          <Body style={styles.saveButtonText}>{saving ? "Saving" : "Save preferences"}</Body>
        </Pressable>
      </View>
    </Screen>
  );
}

function PreferenceField({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <View style={styles.preferenceField}>
      <Label>{label}</Label>
      <TextInput style={styles.preferenceInput} value={String(value)} onChangeText={onChange} inputMode="numeric" />
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8
  },
  preferenceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  preferenceField: {
    minWidth: 150,
    flex: 1,
    gap: spacing.xs
  },
  preferenceInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.sm,
    color: palette.ink,
    fontSize: 16
  },
  categoryTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  categoryTab: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border
  },
  categoryTabActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  categoryTabText: {
    color: palette.ink,
    fontWeight: "800"
  },
  categoryTabTextActive: {
    color: palette.surface
  },
  categoryCount: {
    fontWeight: "900"
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  addPanel: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surfaceAlt,
    padding: spacing.sm,
    gap: spacing.sm
  },
  assignedExercise: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.sm,
    gap: spacing.sm
  },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  exerciseIdentity: {
    flex: 1
  },
  exerciseName: {
    flex: 1,
    color: palette.ink,
    fontWeight: "800"
  },
  secondaryButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm
  },
  secondaryButtonText: {
    color: palette.ink,
    fontWeight: "800"
  },
  moveTargets: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs
  },
  moveButton: {
    minHeight: 36,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm
  },
  saveArea: {
    gap: spacing.sm
  },
  saveButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: 8,
    backgroundColor: palette.ink
  },
  disabledButton: {
    opacity: 0.45
  },
  saveButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  saved: {
    color: palette.accent,
    fontWeight: "800"
  },
  error: {
    color: palette.danger,
    fontWeight: "800"
  }
});
