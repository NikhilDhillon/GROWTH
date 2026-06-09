import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Plus } from "lucide-react-native";

import { Body, Label, SectionTitle } from "@/components/Text";
import { formatMachineLoad, inferMachineDraftFromModel, machineLoadToWorkoutInput, machineProfileTypeOptions, machineTypeLabel, MachineProfileDraft, pulleyRatioOptions, stackUnitLabel, suggestedMachineLoads } from "@/constants/machineProfiles";
import { MachineProfile, MachineProfileType, MachineStackUnit, UnitSystem } from "@/types";
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
  onApplyLoad
}: Props) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadDraft, setLoadDraft] = useState("");
  const [draft, setDraft] = useState<MachineProfileDraft>(() => emptyDraft(unitSystem, exerciseName, exerciseId));
  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((left, right) => {
      const leftLinked = exerciseId && left.exerciseIds.includes(exerciseId) ? 1 : 0;
      const rightLinked = exerciseId && right.exerciseIds.includes(exerciseId) ? 1 : 0;
      return rightLinked - leftLinked || (right.lastUsedAt ?? right.updatedAt).localeCompare(left.lastUsedAt ?? left.updatedAt);
    });
  }, [exerciseId, profiles]);
  const suggestions = suggestedMachineLoads(selectedProfile, lastLoad);

  useEffect(() => {
    setDraft(emptyDraft(unitSystem, exerciseName, exerciseId));
  }, [exerciseId, exerciseName, unitSystem]);

  useEffect(() => {
    if (suggestions.length) setLoadDraft(String(suggestions[Math.min(2, suggestions.length - 1)]));
  }, [selectedProfileId, suggestions.join(":")]);

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      const saved = await onSaveProfile({ ...draft, exerciseIds: exerciseId ? [exerciseId] : [] });
      onSelectProfile(saved.id);
      setShowForm(false);
      setDraft(emptyDraft(unitSystem, exerciseName, exerciseId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save machine profile.");
    } finally {
      setSaving(false);
    }
  }

  function useModelHints() {
    setDraft((current) => ({
      ...current,
      ...inferMachineDraftFromModel(current.modelName ?? "", unitSystem)
    }));
  }

  function applyLoad(mode: ApplyMode) {
    if (!onApplyLoad) return;
    const parsed = Number(loadDraft.trim().replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onApplyLoad(machineLoadToWorkoutInput(parsed, selectedProfile, unitSystem), mode);
  }

  return (
    <View style={styles.machinePanel}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Label>Machine memory</Label>
          <SectionTitle>{selectedProfile ? selectedProfile.label : "Choose machine"}</SectionTitle>
          <Body style={styles.hintText}>{selectedProfile
            ? machineProfileSummary(selectedProfile, unitSystem)
            : "Save the cable or selectorized machine once, then reuse it for this exercise."}</Body>
        </View>
        <Pressable hitSlop={touchHitSlop} onPress={() => setShowForm((visible) => !visible)} style={pressableFeedback(styles.iconAction)}>
          <Plus size={18} color={palette.ink} />
        </Pressable>
      </View>

      {sortedProfiles.length ? (
        <View style={styles.profileChips}>
          {sortedProfiles.map((profile) => {
            const active = profile.id === selectedProfile?.id;
            return (
              <Pressable key={profile.id} hitSlop={touchHitSlop} onPress={() => onSelectProfile(profile.id)} style={pressableFeedback([styles.profileChip, active && styles.profileChipActive])}>
                <Body style={[styles.profileChipText, active && styles.profileChipTextActive]}>{profile.label}</Body>
                {exerciseId && profile.exerciseIds.includes(exerciseId) ? <Label style={[styles.profileChipMeta, active && styles.profileChipTextActive]}>linked</Label> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {selectedProfile && onApplyLoad ? (
        <View style={styles.quickLoadBox}>
          <View style={styles.machineVisualRow}>
            <MachineVisual type={selectedProfile.machineType} />
            <View style={styles.flex}>
              <Label>Quick stack</Label>
              <Body>{lastLoad ? `Last logged near ${formatMachineLoad(lastLoad, selectedProfile, unitSystem)}.` : "Pick the stack value shown on the machine."}</Body>
            </View>
          </View>
          {suggestions.length ? (
            <View style={styles.loadChips}>
              {suggestions.map((load) => (
                <Pressable key={load} hitSlop={touchHitSlop} onPress={() => setLoadDraft(String(load))} style={pressableFeedback([styles.loadChip, Number(loadDraft) === load && styles.loadChipActive])}>
                  <Body style={[styles.loadChipText, Number(loadDraft) === load && styles.loadChipTextActive]}>{formatMachineLoad(load, selectedProfile, unitSystem)}</Body>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.loadApplyRow}>
            <TextInput
              style={[styles.input, styles.loadInput]}
              value={loadDraft}
              onChangeText={setLoadDraft}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={stackUnitLabel(selectedProfile.stackUnit, unitSystem)}
            />
            <Pressable hitSlop={touchHitSlop} onPress={() => applyLoad("blank")} style={pressableFeedback(styles.secondaryButton)}>
              <Body style={styles.buttonText}>Fill blanks</Body>
            </Pressable>
            <Pressable hitSlop={touchHitSlop} onPress={() => applyLoad("all")} style={pressableFeedback(styles.secondaryButton)}>
              <Body style={styles.buttonText}>Fill all</Body>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showForm || !sortedProfiles.length ? (
        <View style={styles.setupBox}>
          <Label>Set up a machine</Label>
          <TextInput style={styles.input} value={draft.label} onChangeText={(label) => setDraft((current) => ({ ...current, label }))} placeholder="Second floor right cable" />
          <View style={styles.machineTypeGrid}>
            {machineProfileTypeOptions.map((option) => {
              const active = draft.machineType === option.type;
              return (
                <Pressable key={option.type} onPress={() => setDraft((current) => ({ ...current, machineType: option.type }))} style={pressableFeedback([styles.machineTypeCard, active && styles.machineTypeCardActive])}>
                  <MachineVisual type={option.type} />
                  <Body style={[styles.machineTypeTitle, active && styles.machineTypeActiveText]}>{option.label}</Body>
                  <Body style={[styles.machineTypeDetail, active && styles.machineTypeActiveText]}>{option.detail}</Body>
                </Pressable>
              );
            })}
          </View>
          <TextInput style={styles.input} value={draft.modelName} onChangeText={(modelName) => setDraft((current) => ({ ...current, modelName }))} placeholder="Model or nameplate search" />
          <Pressable hitSlop={touchHitSlop} onPress={useModelHints} style={pressableFeedback(styles.secondaryButton)}>
            <Body style={styles.buttonText}>Use model hints</Body>
          </Pressable>
          <TextInput style={styles.input} value={draft.location} onChangeText={(location) => setDraft((current) => ({ ...current, location }))} placeholder="Ground floor near mirrors" />
          <View style={styles.segmentRow}>
            {(["lb", "kg", "plate"] as MachineStackUnit[]).map((unit) => (
              <Pressable key={unit} onPress={() => setDraft((current) => ({ ...current, stackUnit: unit, increment: unit === "kg" ? 2.5 : unit === "plate" ? 1 : 5 }))} style={pressableFeedback([styles.segment, draft.stackUnit === unit && styles.segmentActive])}>
                <Body style={[styles.segmentText, draft.stackUnit === unit && styles.segmentTextActive]}>{unit === "plate" ? "plates" : unit}</Body>
              </Pressable>
            ))}
          </View>
          <View style={styles.numberRow}>
            <LabeledInput label="Increment" value={String(draft.increment)} onChangeText={(increment) => setDraft((current) => ({ ...current, increment: Number(increment) }))} />
            <LabeledInput label="Min" value={String(draft.minLoad)} onChangeText={(minLoad) => setDraft((current) => ({ ...current, minLoad: Number(minLoad) }))} />
            <LabeledInput label="Max" value={String(draft.maxLoad)} onChangeText={(maxLoad) => setDraft((current) => ({ ...current, maxLoad: Number(maxLoad) }))} />
          </View>
          <View style={styles.segmentRow}>
            {pulleyRatioOptions.map((ratio) => (
              <Pressable key={ratio} onPress={() => setDraft((current) => ({ ...current, pulleyRatio: ratio }))} style={pressableFeedback([styles.segment, draft.pulleyRatio === ratio && styles.segmentActive])}>
                <Body style={[styles.segmentText, draft.pulleyRatio === ratio && styles.segmentTextActive]}>{ratio}</Body>
              </Pressable>
            ))}
          </View>
          <TextInput style={[styles.input, styles.notes]} value={draft.notes} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} multiline placeholder="Notes about this machine" />
          {error ? <Body style={styles.errorText}>{error}</Body> : null}
          <Pressable disabled={saving} hitSlop={touchHitSlop} onPress={() => void saveProfile()} style={pressableFeedback(styles.primaryButton)}>
            <Check size={17} color={palette.surface} />
            <Body style={styles.primaryButtonText}>{saving ? "Saving" : "Save machine"}</Body>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function LabeledInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View style={styles.numberField}>
      <Label>{label}</Label>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType="decimal-pad" inputMode="decimal" />
    </View>
  );
}

function MachineVisual({ type }: { type: MachineProfileType }) {
  const dual = type === "dual_pulley" || type === "cable_crossover";
  const wide = type === "cable_crossover";
  return (
    <View style={[styles.visual, wide && styles.visualWide]}>
      <View style={styles.visualStack} />
      <View style={styles.visualFrame}>
        <View style={styles.visualPulley} />
        <View style={styles.visualCable} />
      </View>
      {dual ? (
        <>
          <View style={styles.visualFrame}>
            <View style={styles.visualPulley} />
            <View style={styles.visualCableAlt} />
          </View>
          <View style={styles.visualStack} />
        </>
      ) : null}
    </View>
  );
}

function emptyDraft(unitSystem: UnitSystem, exerciseName?: string, exerciseId?: number | null): MachineProfileDraft {
  const inferred = inferMachineDraftFromModel(exerciseName ?? "", unitSystem);
  return {
    label: exerciseName ? `${exerciseName} machine` : "Cable machine",
    machineType: inferred.machineType ?? "selectorized",
    stackUnit: inferred.stackUnit ?? unitSystem,
    increment: inferred.increment ?? 5,
    minLoad: 0,
    maxLoad: unitSystem === "kg" ? 100 : 200,
    pulleyRatio: inferred.pulleyRatio ?? "unknown",
    location: "",
    modelName: "",
    notes: "",
    exerciseIds: exerciseId ? [exerciseId] : []
  };
}

function machineProfileSummary(profile: MachineProfile, unitSystem: UnitSystem) {
  const unit = stackUnitLabel(profile.stackUnit, unitSystem);
  const parts = [
    machineTypeLabel(profile.machineType),
    `${profile.increment} ${unit} steps`,
    profile.pulleyRatio === "unknown" ? "ratio unknown" : `${profile.pulleyRatio} ratio`,
    profile.location
  ].filter(Boolean);
  return parts.join(" · ");
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
  profileChip: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    ...fastTouchStyle
  },
  profileChipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  profileChipText: {
    color: palette.ink,
    fontWeight: "900"
  },
  profileChipTextActive: {
    color: palette.surface
  },
  profileChipMeta: {
    color: palette.muted
  },
  quickLoadBox: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: palette.surface
  },
  machineVisualRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center"
  },
  loadChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  loadChip: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  loadChipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent
  },
  loadChipText: {
    color: palette.ink,
    fontWeight: "900"
  },
  loadChipTextActive: {
    color: palette.surface
  },
  loadApplyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap"
  },
  loadInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 96
  },
  setupBox: {
    gap: spacing.sm
  },
  machineTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  machineTypeCard: {
    flexGrow: 1,
    flexBasis: 136,
    minHeight: 132,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: spacing.sm,
    gap: spacing.xs,
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  machineTypeCardActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  machineTypeTitle: {
    color: palette.ink,
    fontWeight: "900"
  },
  machineTypeDetail: {
    color: palette.muted,
    fontSize: 12
  },
  machineTypeActiveText: {
    color: palette.surface
  },
  segmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  segment: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  segmentActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent
  },
  segmentText: {
    color: palette.ink,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: palette.accent
  },
  numberRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  numberField: {
    flex: 1,
    gap: spacing.xs
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  notes: {
    minHeight: 68,
    textAlignVertical: "top",
    paddingTop: spacing.md
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  buttonText: {
    color: palette.ink,
    fontWeight: "800"
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  visual: {
    width: 78,
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5
  },
  visualWide: {
    width: 92
  },
  visualStack: {
    width: 13,
    height: 38,
    borderRadius: 3,
    backgroundColor: palette.ink
  },
  visualFrame: {
    width: 18,
    height: 38,
    borderTopWidth: 3,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: palette.muted,
    alignItems: "center"
  },
  visualPulley: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.accent,
    marginTop: 3
  },
  visualCable: {
    width: 2,
    height: 24,
    backgroundColor: palette.muted
  },
  visualCableAlt: {
    width: 2,
    height: 24,
    backgroundColor: palette.warning
  }
});
