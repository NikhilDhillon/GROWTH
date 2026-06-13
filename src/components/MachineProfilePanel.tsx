import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Plus, Trash2, X } from "lucide-react-native";

import { Body, Label, SectionTitle } from "@/components/Text";
import { MachineProfileDraft } from "@/constants/machineProfiles";
import { MachineProfile, UnitSystem } from "@/types";
import { palette, spacing } from "@/utils/theme";
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
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile
}: Props) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const [showForm, setShowForm] = useState(false);
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

  return (
    <View style={styles.machinePanel}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Label>Machine tag</Label>
          <SectionTitle>{selectedProfile?.label ?? "Choose a machine"}</SectionTitle>
          <Body style={styles.hintText}>
            Previous logs and guided targets use only the selected machine tag.
          </Body>
        </View>
        <Pressable
          accessibilityLabel={showForm ? "Close machine tag form" : "Add machine tag"}
          hitSlop={touchHitSlop}
          onPress={() => {
            setError(null);
            setShowForm((visible) => !visible);
          }}
          style={pressableFeedback(styles.iconAction)}
        >
          {showForm ? <X size={18} color={palette.ink} /> : <Plus size={18} color={palette.ink} />}
        </Pressable>
      </View>

      {sortedProfiles.length ? (
        <View style={styles.profileChips}>
          {sortedProfiles.map((profile) => {
            const active = profile.id === selectedProfile?.id;
            const confirmingDelete = confirmDeleteId === profile.id;
            return (
              <View key={profile.id} style={[styles.profileRow, active && styles.profileRowActive]}>
                <Pressable
                  hitSlop={touchHitSlop}
                  onPress={() => onSelectProfile(profile.id)}
                  style={pressableFeedback(styles.profileSelect)}
                >
                  <Body style={[styles.profileChipText, active && styles.profileChipTextActive]}>{profile.label}</Body>
                </Pressable>
                {confirmingDelete ? (
                  <>
                    <Pressable
                      disabled={deletingId === profile.id}
                      onPress={() => void deleteTag(profile.id)}
                      style={pressableFeedback(styles.confirmDeleteButton)}
                    >
                      <Body style={styles.confirmDeleteText}>{deletingId === profile.id ? "Deleting" : "Delete"}</Body>
                    </Pressable>
                    <Pressable accessibilityLabel={`Cancel deleting ${profile.label}`} onPress={() => setConfirmDeleteId(null)} style={pressableFeedback(styles.tagIconButton)}>
                      <X size={15} color={active ? palette.surface : palette.ink} />
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    accessibilityLabel={`Delete ${profile.label}`}
                    onPress={() => setConfirmDeleteId(profile.id)}
                    style={pressableFeedback(styles.tagIconButton)}
                  >
                    <Trash2 size={15} color={active ? palette.surface : palette.danger} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <Body>No machine tags yet. Add one for {exerciseName ?? "this exercise"}.</Body>
      )}

      {showForm || !sortedProfiles.length ? (
        <View style={styles.tagForm}>
          <Label>Add machine tag</Label>
          <Body>Use a short name that distinguishes this machine, such as “Gym cable A” or “Upstairs cable.”</Body>
          <View style={styles.tagRow}>
            <TextInput
              autoFocus={showForm}
              style={styles.input}
              value={tag}
              onChangeText={setTag}
              onSubmitEditing={() => void saveTag()}
              placeholder="Machine tag"
              returnKeyType="done"
            />
            <Pressable disabled={saving} hitSlop={touchHitSlop} onPress={() => void saveTag()} style={pressableFeedback(styles.primaryButton)}>
              <Check size={17} color={palette.surface} />
              <Body style={styles.primaryButtonText}>{saving ? "Saving" : "Add tag"}</Body>
            </Pressable>
          </View>
          {error ? <Body style={styles.errorText}>{error}</Body> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  machinePanel: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: palette.surfaceAlt
  },
  headerRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start"
  },
  flex: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs
  },
  hintText: {
    color: palette.muted
  },
  iconAction: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  profileChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  profileRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    overflow: "hidden",
    ...fastTouchStyle
  },
  profileRowActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  profileSelect: {
    minHeight: 40,
    justifyContent: "center",
    paddingLeft: spacing.md,
    paddingRight: spacing.sm
  },
  profileChipText: {
    color: palette.ink,
    fontWeight: "900"
  },
  profileChipTextActive: {
    color: palette.surface
  },
  tagIconButton: {
    width: 38,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  confirmDeleteButton: {
    minHeight: 32,
    borderRadius: 7,
    backgroundColor: palette.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  confirmDeleteText: {
    color: palette.surface,
    fontWeight: "900",
    fontSize: 12
  },
  tagForm: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    gap: spacing.sm
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  input: {
    minHeight: 46,
    flexGrow: 1,
    flexBasis: 220,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    ...fastTouchStyle
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  }
});
