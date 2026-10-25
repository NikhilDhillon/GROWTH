import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { Body, Label } from "@/components/Text";
import { ExerciseLoadType } from "@/constants/exercises";
import { cleanExerciseName, existingExerciseNamed } from "@/services/workouts/customExercises";
import type { CustomExerciseInput, Exercise, MuscleGroup } from "@/types";
import { createThemedStyles } from "@/utils/themedStyles";
import { muscles, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback } from "@/utils/touch";

const loadOptions: Array<{ value: ExerciseLoadType; label: string; hint: string }> = [
  { value: "external", label: "Weights", hint: "Log the barbell, dumbbell or plate weight." },
  { value: "machine_stack", label: "Machine or cable", hint: "Log the stack setting; machine profiles apply." },
  { value: "bodyweight_plus_load", label: "Bodyweight + added", hint: "Log only the weight you add; 0 is bodyweight alone." },
  { value: "bodyweight_minus_assistance", label: "Assisted", hint: "Log the assistance; less of it counts as harder." }
];

/** Adds an exercise the catalog lacks. A name already listed offers that exercise instead. */
export function NewExerciseForm({ initialName, defaultMuscle, exercises, disabled = false, onCreate, onCreated, onUseExisting, onCancel }: {
  initialName: string;
  defaultMuscle?: MuscleGroup | null;
  /** Everything visible: catalog, your own, and exercises friends share with you. */
  exercises: readonly Exercise[];
  disabled?: boolean;
  onCreate: (input: CustomExerciseInput) => Promise<Exercise>;
  onCreated: (exercise: Exercise) => void;
  onUseExisting: (exercise: Exercise) => void;
  onCancel: () => void;
}) {
  const { palette, styles } = useStyles();
  const [name, setName] = useState(() => {
    const typed = cleanExerciseName(initialName);
    // A quick lowercase search becomes a proper name; deliberate casing is kept.
    return typed === typed.toLowerCase() ? typed.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase()) : typed;
  });
  const [muscle, setMuscle] = useState<MuscleGroup | null>(defaultMuscle ?? null);
  const [loadType, setLoadType] = useState<ExerciseLoadType>("external");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = existingExerciseNamed(exercises, name);
  const cleanName = cleanExerciseName(name);
  const ready = cleanName.length >= 2 && cleanName.length <= 60 && Boolean(muscle) && !existing && !saving && !disabled;

  async function save() {
    if (!ready || !muscle) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(await onCreate({ name: cleanName, primaryMuscle: muscle, loadType }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The exercise could not be added. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <View style={styles.form}>
    <Label>New exercise</Label>
    <TextInput accessibilityLabel="New exercise name" value={name} onChangeText={(value) => { setName(value); setError(null); }} editable={!disabled && !saving}
      placeholder="Exercise name" placeholderTextColor={palette.muted} autoCapitalize="words" autoCorrect={false} maxLength={60} style={styles.input} />
    {existing ? <View style={styles.existing}>
      <Body style={styles.flex}>“{existing.name}” is already in your list.</Body>
      <Pressable accessibilityRole="button" accessibilityLabel={`Use ${existing.name}`} disabled={disabled} onPress={() => onUseExisting(existing)} style={pressableFeedback(styles.useButton)}>
        <Body style={styles.useText}>Use it</Body>
      </Pressable>
    </View> : null}
    <Body style={styles.question}>Main muscle</Body>
    <View accessibilityRole="radiogroup" style={styles.chips}>
      {muscles.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: muscle === value }} disabled={disabled || saving}
        onPress={() => setMuscle(value)} style={pressableFeedback([styles.chip, muscle === value && styles.chipActive])}>
        <Body style={[styles.chipText, muscle === value && styles.chipTextActive]}>{value}</Body>
      </Pressable>)}
    </View>
    <Body style={styles.question}>How is it loaded?</Body>
    <View accessibilityRole="radiogroup" style={styles.chips}>
      {loadOptions.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: loadType === option.value }} disabled={disabled || saving}
        onPress={() => setLoadType(option.value)} style={pressableFeedback([styles.chip, loadType === option.value && styles.chipActive])}>
        <Body style={[styles.chipText, loadType === option.value && styles.chipTextActive]}>{option.label}</Body>
      </Pressable>)}
    </View>
    <Body style={styles.hint}>{loadOptions.find((option) => option.value === loadType)?.hint} Friends you sync your split with can use it too.</Body>
    {error ? <Body accessibilityRole="alert" style={styles.error}>{error}</Body> : null}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={disabled || saving} onPress={onCancel} style={pressableFeedback(styles.cancel)}>
        <Body style={styles.cancelText}>Cancel</Body>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={() => void save()} style={pressableFeedback([styles.save, !ready && styles.saveDisabled])}>
        <Body style={styles.saveText}>{saving ? "Adding…" : "Add exercise"}</Body>
      </Pressable>
    </View>
  </View>;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  form: { gap: spacing.sm, padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: 10, backgroundColor: palette.surface, paddingHorizontal: spacing.md, color: palette.ink, fontSize: 16 },
  existing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  useButton: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: 999, backgroundColor: palette.ink, justifyContent: "center", ...fastTouchStyle },
  useText: { color: palette.surface, fontWeight: "800", fontSize: 13 },
  question: { color: palette.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: -2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: "center", ...fastTouchStyle },
  chipActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: palette.surface },
  hint: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  error: { color: palette.danger, fontSize: 13 },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  cancel: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center", ...fastTouchStyle },
  cancelText: { color: palette.ink, fontWeight: "700" },
  save: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 10, backgroundColor: palette.ink, justifyContent: "center", ...fastTouchStyle },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: palette.surface, fontWeight: "900" }
}));
