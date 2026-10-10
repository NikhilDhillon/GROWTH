import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Plus, Trash2, X } from "lucide-react-native";

import { Body, Label } from "@/components/Text";
import { MachineProfileDraft } from "@/constants/machineProfiles";
import { MachineProfile, UnitSystem } from "@/types";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";

type ApplyMode = "blank" | "all";

type Props = {
  profiles: MachineProfile[];
  selectedProfileId?: string | null;
  exerciseId?: number | null;
  exerciseName?: string;
  unitSystem: UnitSystem;
  lastLoad?: number | null;
  onSelectProfile: (profileId: string | null) => void;
  onSaveProfile: (profile: MachineProfileDraft) => Promise<MachineProfile>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onApplyLoad?: (load: string, mode: ApplyMode) => void;
};

export function MachineProfilePanel({
  profiles,
  selectedProfileId,
  exerciseId,
  exerciseName,
  unitSystem,
  lastLoad,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile
}: Props) {
  const { palette, styles } = useStyles();
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((left, right) => {
      const leftLinked = exerciseId && left.exerciseIds.includes(exerciseId) ? 1 : 0;
      const rightLinked = exerciseId && right.exerciseIds.includes(exerciseId) ? 1 : 0;
      return rightLinked - leftLinked || (right.lastUsedAt ?? right.updatedAt).localeCompare(left.lastUsedAt ?? left.updatedAt);
    });
  }, [exerciseId, profiles]);

  async function saveTag() {
    const label = tag.trim();
    if (!label) {
      setError("Enter a machine tag.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await onSaveProfile({
        label,
        machineType: "selectorized",
        stackUnit: unitSystem,
        increment: unitSystem === "kg" ? 2.5 : 5,
        minLoad: 0,
        maxLoad: unitSystem === "kg" ? 100 : 200,
        pulleyRatio: "unknown",
        exerciseIds: exerciseId ? [exerciseId] : []
      });
      onSelectProfile(saved.id);
      setTag("");
      setShowForm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save machine tag.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTag(profileId: string) {
    setDeletingId(profileId);
    setError(null);
    try {
      await onDeleteProfile(profileId);
      if (selectedProfileId === profileId) onSelectProfile(null);
      setConfirmDeleteId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete machine tag.");
    } finally {
      setDeletingId(null);
    }
  }

  // Tags are optional: untagged entries share one history, so this stays a single row until opened.
  const open = expanded || showForm;
  return (
    <View style={styles.machinePanel}>
      <Pressable accessibilityRole="button" accessibilityLabel={open ? "Close machine tags" : "Choose machine tag"} accessibilityState={{ expanded: open }}
        onPress={() => { setError(null); setExpanded(!open); setShowForm(false); }} style={pressableFeedback(styles.headerRow)}>
        <View style={styles.flex}>
          <Label>Machine</Label>
          <Body numberOfLines={1} style={styles.selectedText}>{selectedProfile?.label ?? "No tag"}</Body>
          {selectedProfile && lastLoad !== null && lastLoad !== undefined ? (
            <Body style={styles.hintText}>Last load {formatMachineLoad(lastLoad, selectedProfile, unitSystem)}</Body>
          ) : !selectedProfile ? <Body style={styles.hintText}>Optional. Tag a machine to give it its own trend.</Body> : null}
        </View>
        <View style={styles.togglePill}><Body style={styles.togglePillText}>{open ? "Done" : sortedProfiles.length ? "Change" : "Add tag"}</Body></View>
      </Pressable>

      {open ? <>
        <View style={styles.profileChips}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !selectedProfile }} onPress={() => onSelectProfile(null)}
            style={pressableFeedback([styles.profileRow, !selectedProfile && styles.profileRowActive])}>
            <Body style={[styles.profileChipText, styles.profileSelect, !selectedProfile && styles.profileChipTextActive]}>No tag</Body>
          </Pressable>
          {sortedProfiles.map((profile) => {
            const active = profile.id === selectedProfile?.id;
            const confirmingDelete = confirmDeleteId === profile.id;
            return (
              <View key={profile.id} style={[styles.profileRow, active && styles.profileRowActive]}>
                <Pressable hitSlop={touchHitSlop} onPress={() => onSelectProfile(profile.id)} style={pressableFeedback(styles.profileSelect)}>
                  <Body style={[styles.profileChipText, active && styles.profileChipTextActive]}>{profile.label}</Body>
                </Pressable>
                {confirmingDelete ? (
                  <>
                    <Pressable disabled={deletingId === profile.id} onPress={() => void deleteTag(profile.id)} style={pressableFeedback(styles.confirmDeleteButton)}>
                      <Body style={styles.confirmDeleteText}>{deletingId === profile.id ? "Deleting" : "Delete"}</Body>
                    </Pressable>
                    <Pressable accessibilityLabel={`Cancel deleting ${profile.label}`} onPress={() => setConfirmDeleteId(null)} style={pressableFeedback(styles.tagIconButton)}>
                      <X size={15} color={active ? palette.surface : palette.ink} />
                    </Pressable>
                  </>
                ) : (
                  <Pressable accessibilityLabel={`Delete ${profile.label}`} onPress={() => setConfirmDeleteId(profile.id)} style={pressableFeedback(styles.tagIconButton)}>
                    <Trash2 size={14} color={active ? palette.surface : palette.muted} />
                  </Pressable>
                )}
              </View>
            );
          })}
          {!showForm ? <Pressable accessibilityRole="button" accessibilityLabel="Add machine tag" onPress={() => { setError(null); setShowForm(true); }} style={pressableFeedback([styles.profileRow, styles.addChip])}>
            <Plus size={15} color={palette.ink} />
            <Body style={styles.profileChipText}>New tag</Body>
          </Pressable> : null}
        </View>
        {showForm ? (
          <View style={styles.tagRow}>
            <TextInput autoFocus style={styles.input} value={tag} onChangeText={setTag} onSubmitEditing={() => void saveTag()}
              placeholder={`e.g. Gym cable A`} placeholderTextColor={palette.muted} returnKeyType="done" accessibilityLabel={`New machine tag for ${exerciseName ?? "this exercise"}`} />
            <Pressable disabled={saving} hitSlop={touchHitSlop} onPress={() => void saveTag()} style={pressableFeedback(styles.primaryButton)}>
              <Check size={17} color={palette.surface} />
              <Body style={styles.primaryButtonText}>{saving ? "Saving" : "Add"}</Body>
            </Pressable>
          </View>
        ) : null}
        {error ? <Body style={styles.errorText}>{error}</Body> : null}
      </> : null}
    </View>
  );
}

function formatMachineLoad(load: number, profile: MachineProfile | null, unitSystem: UnitSystem) {
  const formatted = Number.isInteger(load) ? String(load) : load.toFixed(1);
  if (profile?.stackUnit === "kg") return `${formatted} kg`;
  if (profile?.stackUnit === "plate") return `${formatted} plates`;
  return `${formatted} ${unitSystem}`;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  machinePanel: { borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, backgroundColor: palette.surfaceAlt },
  headerRow: { minHeight: 48, flexDirection: "row", gap: spacing.md, alignItems: "center", ...fastTouchStyle },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  selectedText: { color: palette.ink, fontWeight: "700", fontSize: 15 },
  hintText: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  togglePill: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 999, justifyContent: "center", backgroundColor: palette.surface },
  togglePillText: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  profileChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingBottom: spacing.xs },
  profileRow: { minHeight: 36, flexDirection: "row", alignItems: "center", borderRadius: 999, backgroundColor: palette.surface, overflow: "hidden", ...fastTouchStyle },
  profileRowActive: { backgroundColor: palette.ink },
  addChip: { gap: spacing.xs, paddingHorizontal: spacing.md },
  profileSelect: { minHeight: 36, justifyContent: "center", paddingLeft: spacing.md, paddingRight: spacing.sm },
  profileChipText: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  profileChipTextActive: { color: palette.surface },
  tagIconButton: { width: 32, minHeight: 36, alignItems: "center", justifyContent: "center" },
  confirmDeleteButton: { minHeight: 28, borderRadius: 999, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  confirmDeleteText: { color: palette.surface, fontWeight: "800", fontSize: 12 },
  tagRow: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.xs },
  input: { minHeight: 44, flex: 1, minWidth: 0, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface, paddingHorizontal: spacing.md, color: palette.ink, fontSize: 16, fontWeight: "600" },
  primaryButton: { minHeight: 44, borderRadius: 12, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, ...fastTouchStyle },
  primaryButtonText: { color: palette.surface, fontWeight: "800" },
  errorText: { color: palette.danger, fontWeight: "700" }
}));
