import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Plus, Search } from "lucide-react-native";
import { NewExerciseForm } from "@/components/NewExerciseForm";
import { Body, SectionTitle } from "@/components/Text";
import { existingExerciseNamed } from "@/services/workouts/customExercises";
import type { CustomExerciseInput, Exercise, MuscleGroup } from "@/types";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback } from "@/utils/touch";

/** Exercises whose name or primary muscle contains the query, alphabetically. */
export function matchingExercises(exercises: readonly Exercise[], query: string) {
  const text = query.trim().toLowerCase();
  return exercises.filter((exercise) => `${exercise.name} ${exercise.primary_muscle}`.toLowerCase().includes(text))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function SearchableExercisePicker({ exercises, selectedId, onSelect, label = "Exercise", caption, suggested, suggestedLabel = "Suggested", disabled = false, onCreate, defaultMuscle }: {
  exercises: Exercise[]; selectedId?: number | null; onSelect: (id: number) => void; label?: string;
  /** Visible heading in place of the label, e.g. "Exercise 2" in a guided workout. */
  caption?: string;
  /** Shown first, in order, before the full alphabetical list is expanded. */
  suggested?: Exercise[]; suggestedLabel?: string;
  disabled?: boolean;
  /** Offers to add an exercise the list lacks when a search names one. */
  onCreate?: (input: CustomExerciseInput) => Promise<Exercise>;
  defaultMuscle?: MuscleGroup | null;
}) {
  const { palette, styles } = useStyles();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const selected = exercises.find((exercise) => exercise.id === selectedId);
  const matches = matchingExercises(exercises, query);
  const showingSuggestions = !expanded && !query.trim() && Boolean(suggested?.length);
  const visible = expanded || query.trim() ? matches : showingSuggestions ? suggested!.slice(0, 6) : matches.slice(0, 6);
  const canCreate = Boolean(onCreate) && Boolean(query.trim()) && !existingExerciseNamed(exercises, query);
  function choose(exerciseId: number) {
    onSelect(exerciseId);
    setChoosing(false);
    setQuery("");
    setCreating(false);
  }
  return <View style={styles.container}>
    {selected ? <Pressable accessibilityRole="button" accessibilityLabel={`Change ${label.toLowerCase()}`} accessibilityState={{ expanded: choosing }}
      disabled={disabled} onPress={() => setChoosing((value) => !value)} style={pressableFeedback(styles.selection)}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Body style={styles.caption}>{caption ?? label}</Body><SectionTitle numberOfLines={1}>{selected.name}</SectionTitle></View>
      <View style={styles.changePill}><Body style={styles.change}>{choosing ? "Done" : "Change"}</Body></View>
    </Pressable> : <SectionTitle>{caption ?? label}</SectionTitle>}
    {(!selected || choosing) && creating && onCreate ? <NewExerciseForm initialName={query} defaultMuscle={defaultMuscle} exercises={exercises} disabled={disabled}
      onCreate={onCreate} onCreated={(exercise) => choose(exercise.id)} onUseExisting={(exercise) => choose(exercise.id)} onCancel={() => setCreating(false)} /> : null}
    {(!selected || choosing) && !creating ? <>
    <View style={styles.searchField}>
      <Search size={17} color={palette.muted} />
      <TextInput editable={!disabled} accessibilityLabel={`Search ${label.toLowerCase()}s`} value={query} onChangeText={setQuery}
        placeholder="Search by name or muscle" placeholderTextColor={palette.muted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
    </View>
    {showingSuggestions ? <Body style={styles.sectionLabel}>{suggestedLabel}</Body> : null}
    <View style={styles.list}>
      {visible.map((exercise, index) => {
        const active = selectedId === exercise.id;
        return <Pressable key={exercise.id} accessibilityRole="button"
          accessibilityLabel={`Select ${exercise.name}`} accessibilityState={{ selected: active }}
          disabled={disabled} onPress={() => choose(exercise.id)} style={pressableFeedback([styles.option, index > 0 && styles.optionDivided])}>
          <Body numberOfLines={1} style={[styles.optionName, active && styles.optionNameActive]}>{exercise.name}</Body>
          <Body style={styles.muscle}>{exercise.primary_muscle}</Body>
          <View style={styles.checkSlot}>{active ? <Check size={16} color={palette.ink} /> : null}</View>
        </Pressable>;
      })}
      {!matches.length ? <Body style={styles.empty}>No matching exercises.</Body> : null}
      {canCreate ? <Pressable accessibilityRole="button" accessibilityLabel={`Add ${query.trim()} as a new exercise`} disabled={disabled} onPress={() => setCreating(true)}
        style={pressableFeedback([styles.option, styles.optionDivided])}>
        <Plus size={16} color={palette.ink} />
        <Body numberOfLines={1} style={styles.optionName}>Add “{query.trim()}” as a new exercise</Body>
      </Pressable> : null}
    </View>
    {!query.trim() && matches.length > 6 ? <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={pressableFeedback(styles.more)}>
      {expanded ? <ChevronUp size={16} color={palette.ink} /> : <ChevronDown size={16} color={palette.ink} />}
      <Body style={styles.moreText}>{expanded ? "Show fewer exercises" : `Show all ${matches.length} exercises`}</Body>
    </Pressable> : null}
    </> : null}
  </View>;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  selection: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.md, ...fastTouchStyle },
  caption: { fontSize: 12 },
  changePill: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 999, backgroundColor: palette.surfaceAlt, justifyContent: "center" },
  change: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  container: { gap: spacing.sm },
  searchField: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface },
  input: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, color: palette.ink },
  list: { borderRadius: 12, backgroundColor: palette.surfaceAlt, overflow: "hidden" },
  option: { minHeight: 46, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, ...fastTouchStyle },
  optionDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  optionName: { flex: 1, minWidth: 0, color: palette.ink, fontWeight: "600" },
  optionNameActive: { fontWeight: "800" },
  muscle: { color: palette.muted, fontSize: 13 },
  checkSlot: { width: 18, alignItems: "flex-end" },
  empty: { padding: spacing.md },
  more: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: 999, alignSelf: "center", paddingHorizontal: spacing.md, ...fastTouchStyle },
  moreText: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  sectionLabel: { color: palette.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: -2 }
}));
