import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Check, ChevronDown, ChevronUp } from "lucide-react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { Button } from "@/components/Button";
import { Body, Label } from "@/components/Text";
import { cloneTrainingSplitDays, sameTrainingSplitDays, setSplitDayMuscles, splitMuscles, toggleSplitDayMuscle } from "@/constants/trainingSplit";
import { workoutTemplates } from "@/constants/workoutTemplates";
import type { TrainingSplitDay } from "@/types";
import { dayName, sameMuscles } from "@/utils/schedule";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

/**
 * Edits a draft of the weekly split. Nothing is written until Save, which also
 * updates every friend with an accepted split sync (the server picks recipients).
 */
export function SplitEditorSheet({ days, todayKey, syncedFriendNames, onSave, onClose }: {
  days: TrainingSplitDay[];
  todayKey?: string;
  syncedFriendNames: string[];
  onSave: (days: TrainingSplitDay[]) => Promise<void>;
  onClose: () => void;
}) {
  const { palette, styles } = useStyles();
  const [draft, setDraft] = useState(() => cloneTrainingSplitDays(days));
  const [openDayKey, setOpenDayKey] = useState<string | null>(todayKey ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hasChanges = !sameTrainingSplitDays(draft, days);

  async function save() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "Could not save the split. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <BottomSheet eyebrow="Weekly split" title="Edit your split" closeLabel="Close split editor" disabled={isSaving} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.dayList} style={styles.scroll}>
        {draft.map((day) => {
          const isOpen = openDayKey === day.key;
          const saved = days.find((item) => item.key === day.key);
          const isEdited = !saved || !sameMuscles(saved.muscles, day.muscles);
          const summary = day.muscles.length ? day.muscles.join(" / ") : "Rest";
          return (
            <View key={day.key} style={[styles.day, isOpen && styles.dayOpen]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${dayName(day.key)}, ${summary}`}
                accessibilityState={{ expanded: isOpen }}
                disabled={isSaving}
                onPress={() => setOpenDayKey(isOpen ? null : day.key)}
                style={pressableFeedback(styles.dayHeader)}
              >
                <View style={styles.dayCopy}>
                  <Body style={styles.dayName}>{dayName(day.key)}{day.key === todayKey ? " · Today" : ""}</Body>
                  <Body numberOfLines={1}>{summary}</Body>
                </View>
                {isEdited ? <View style={styles.editedTag}><Body style={styles.editedText}>Edited</Body></View> : null}
                {isOpen ? <ChevronUp size={18} color={palette.muted} /> : <ChevronDown size={18} color={palette.muted} />}
              </Pressable>
              {isOpen ? (
                <View style={styles.dayBody}>
                  <Label>Workout</Label>
                  <View style={styles.chips}>
                    {workoutTemplates.map((template) => (
                      <Chip
                        key={template.id}
                        label={template.label}
                        role="radio"
                        selected={sameMuscles(template.muscles, day.muscles)}
                        disabled={isSaving}
                        onPress={() => setDraft((current) => setSplitDayMuscles(current, day.key, template.muscles))}
                      />
                    ))}
                    <Chip
                      label="Rest"
                      role="radio"
                      selected={!day.muscles.length}
                      disabled={isSaving}
                      onPress={() => setDraft((current) => setSplitDayMuscles(current, day.key, []))}
                    />
                  </View>
                  <Label>Muscles</Label>
                  <View style={styles.chips}>
                    {splitMuscles.map((muscle) => (
                      <Chip
                        key={muscle}
                        label={muscle}
                        role="checkbox"
                        selected={day.muscles.includes(muscle)}
                        disabled={isSaving}
                        onPress={() => setDraft((current) => toggleSplitDayMuscle(current, day.key, muscle))}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Body>
          {syncedFriendNames.length
            ? `Saving also updates the split for ${joinNames(syncedFriendNames)}.`
            : "Only your split changes. To share it, request a split sync with a friend in Social."}
        </Body>
        {saveError ? <Body accessibilityRole="alert" style={styles.errorText}>{saveError}</Body> : null}
        <View style={styles.actions}>
          <Button label="Cancel" disabled={isSaving} onPress={onClose} style={styles.action} />
          <Button label={isSaving ? "Saving" : "Save split"} variant="primary" icon={Check} loading={isSaving} disabled={!hasChanges} onPress={() => void save()} style={styles.action} />
        </View>
      </View>
    </BottomSheet>
  );
}

function Chip({ label, role, selected, disabled, onPress }: {
  label: string;
  role: "radio" | "checkbox";
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { palette, styles } = useStyles();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === "radio" ? { selected } : { checked: selected }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={pressableFeedback([styles.chip, selected && styles.chipSelected])}
    >
      {selected ? <Check size={14} color={palette.surface} /> : null}
      <Body style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Body>
    </Pressable>
  );
}

function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  scroll: { flexShrink: 1 },
  dayList: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  day: { borderRadius: 14, backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: "transparent" },
  dayOpen: { borderColor: palette.border },
  dayHeader: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  dayCopy: { flex: 1, minWidth: 0, gap: 2 },
  dayName: { color: palette.ink, fontWeight: "900" },
  editedTag: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.accentSoft },
  editedText: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  dayBody: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipSelected: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  chipTextSelected: { color: palette.surface },
  footer: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.border },
  errorText: { color: palette.danger, fontWeight: "800" },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, alignSelf: "stretch" }
}));
