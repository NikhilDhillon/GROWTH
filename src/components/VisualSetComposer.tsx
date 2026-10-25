import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Copy, Minus, Plus, RotateCcw, Trash2 } from "lucide-react-native";

import { Body, Label } from "@/components/Text";
import { ExerciseLoadType } from "@/constants/exercises";
import type { GuidedObservationContext } from "@/services/guidedWorkout/guidedObservationService";
import { isPlannedSuggestion } from "@/services/workouts/setCapture";
import { LoggedSetDraft, UnitSystem } from "@/types";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatWeightInput, weightToStorageUnit } from "@/utils/units";
import { createEmptyPlateCounts } from "@/utils/workout";
import { calculatePlateCounts, LoadedBar, parseLoad, PlateCounts, plateVisuals, PlateWeight, plateWeights } from "@/components/LoadedBar";

type ApplyMode = "one" | "working" | "down";


export type SetComposerTarget = {
  draftIndex: number;
  weight?: number;
  targetReps?: number;
  label?: string;
  increaseWeight?: boolean;
};

type Props = {
  sets: LoggedSetDraft[];
  loadType: ExerciseLoadType;
  unitSystem: UnitSystem;
  supportsBarbell: boolean;
  barWeight: string;
  plateCounts: Record<string, number>;
  targets?: SetComposerTarget[];
  observationContext?: GuidedObservationContext;
  disabled?: boolean;
  readOnlyValues?: boolean;
  onBarbellApply?: (input: { barWeight: string; plateCounts: Record<string, number>; sets: LoggedSetDraft[] }) => void;
  onBarWeightChange: (value: string) => void;
  onPlateCountsChange: (counts: Record<string, number>) => void;
  onSetsChange: (sets: LoggedSetDraft[]) => void;
};

export function VisualSetComposer({
  sets,
  loadType,
  unitSystem,
  supportsBarbell,
  barWeight,
  plateCounts,
  targets = [],
  observationContext,
  disabled = false,
  readOnlyValues = false,
  onBarbellApply,
  onBarWeightChange,
  onPlateCountsChange,
  onSetsChange
}: Props) {
  const { palette, styles } = useStyles();
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [editorTotalLoad, setEditorTotalLoad] = useState("45");
  const [editorBarWeight, setEditorBarWeight] = useState(barWeight || "45");
  const [editorPlateCounts, setEditorPlateCounts] = useState<PlateCounts>(normalizePlateCounts(plateCounts));
  const targetByIndex = useMemo(() => new Map(targets.map((target) => [target.draftIndex, target])), [targets]);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= sets.length) setActiveIndex(null);
  }, [activeIndex, sets.length]);

  useEffect(() => {
    if (activeIndex === null) return;
    const set = sets[activeIndex];
    const target = targetByIndex.get(activeIndex);
    const targetDisplay = target?.weight !== undefined ? formatWeightInput(target.weight, unitSystem) : "";
    const displayLoad = set?.weight.trim() || targetDisplay;

    if (supportsBarbell) {
      const seedTotal = displayLoad
        ? weightToStorageUnit(parseLoad(displayLoad), unitSystem)
        : calculateLoadedBarWeight(barWeight, normalizePlateCounts(plateCounts));
      const nextBarWeight = barWeight || "45";
      setEditorBarWeight(nextBarWeight);
      setEditorTotalLoad(formatLoadedBarWeight(seedTotal));
      setEditorPlateCounts(calculatePlateCounts(String(seedTotal), nextBarWeight));
      return;
    }

  }, [activeIndex, barWeight, plateCounts, sets, supportsBarbell, targetByIndex, unitSystem]);

  function updateSet(index: number, patch: Partial<LoggedSetDraft>) {
    if (disabled || readOnlyValues) return;
    onSetsChange(sets.map((set, itemIndex) => (itemIndex === index ? { ...set, ...patch } : set)));
  }

  function adjustReps(index: number, amount: number) {
    const parsed = Number.parseInt(sets[index]?.reps ?? "", 10);
    const targetReps = targetByIndex.get(index)?.targetReps;
    const current = Number.isFinite(parsed) ? parsed : isPositiveInteger(targetReps) ? Number(targetReps) : 0;
    const next = Math.max(0, current + amount);
    updateSet(index, { reps: next > 0 ? String(next) : "" });
  }

  function setsWithLoad(index: number, load: string, mode: ApplyMode) {
    return sets.map((set, itemIndex) => {
      const shouldApply = mode === "one"
        ? itemIndex === index
        : mode === "working"
          ? !set.isWarmup
          : itemIndex >= index && !set.isWarmup;
      return shouldApply ? { ...set, weight: load } : set;
    });
  }

  function applyLoad(index: number, load: string, mode: ApplyMode) {
    if (disabled || readOnlyValues || !load.trim()) return;
    onSetsChange(setsWithLoad(index, load, mode));
    setActiveIndex(null);
  }

  function applyEditorLoad(mode: ApplyMode) {
    if (disabled || readOnlyValues || activeIndex === null) return;
    if (supportsBarbell) {
      const load = formatWeightInput(parseLoad(editorTotalLoad), unitSystem);
      if (onBarbellApply) {
        onBarbellApply({ barWeight: editorBarWeight, plateCounts: editorPlateCounts, sets: setsWithLoad(activeIndex, load, mode) });
        setActiveIndex(null);
        return;
      }
      onBarWeightChange(editorBarWeight);
      onPlateCountsChange(editorPlateCounts);
      applyLoad(activeIndex, load, mode);
      return;
    }
  }

  function copyPrevious(index: number) {
    if (index <= 0) return;
    const previous = sets[index - 1]?.weight ?? "";
    if (!previous.trim()) return;
    applyLoad(index, previous, "one");
  }

  function copyLoadDown(index: number, load: string) {
    if (!load.trim()) {
      setActiveIndex(index);
      return;
    }
    applyLoad(index, load, "down");
  }

  function changeEditorPlateCount(plate: PlateWeight, amount: number) {
    const next = { ...editorPlateCounts, [plate]: Math.max(0, editorPlateCounts[plate] + amount) };
    setEditorPlateCounts(next);
    setEditorTotalLoad(formatLoadedBarWeight(calculateLoadedBarWeight(editorBarWeight, next)));
  }

  function changeEditorTotalLoad(value: string) {
    setEditorTotalLoad(value);
    setEditorPlateCounts(calculatePlateCounts(value, editorBarWeight));
  }

  function changeEditorBarWeight(value: string) {
    setEditorBarWeight(value);
    setEditorPlateCounts(calculatePlateCounts(editorTotalLoad, value));
  }

  function adjustEditorTotal(amount: number) {
    const next = Math.max(parseLoad(editorBarWeight), parseLoad(editorTotalLoad) + amount);
    setEditorTotalLoad(formatLoadedBarWeight(next));
    setEditorPlateCounts(calculatePlateCounts(String(next), editorBarWeight));
  }

  return (
    <View style={styles.composer} pointerEvents={disabled ? "none" : "auto"}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Label>Sets</Label>
        </View>
      </View>
      {observationContext ? <Body style={styles.hintText}>Adjust anything you did differently. Every filled-in set is saved; delete sets you skipped.</Body> : null}

      {sets.map((set, index) => {
        const active = activeIndex === index;
        const target = targetByIndex.get(index);
        const targetDisplay = target?.weight !== undefined ? formatWeightInput(target.weight, unitSystem) : "";
        const displayLoad = set.weight.trim() || targetDisplay;
        return (
          <View
            key={index}
            style={[styles.setLane, active && styles.setLaneActive]}
          >
            <View style={styles.setRow}>
              <View style={styles.setBadge}>
                <Label style={styles.setBadgeText}>{index + 1}</Label>
              </View>
              <View style={styles.setBody}>
              <View style={styles.setPrimaryRow}>
                <View style={styles.weightField}>
                  <Label>Weight</Label>
                  <View style={styles.directWeight}>
                    <TextInput
                      accessibilityLabel={`Weight for set ${index + 1}`}
                      style={[styles.input, styles.weightInput, compact && styles.weightInputCompact]}
                      value={set.weight}
                      editable={!disabled && !readOnlyValues}
                      onChangeText={(weight) => updateSet(index, { weight })}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      placeholder={targetDisplay || "Weight"}
                    />
                    <Body style={styles.unitText}>{unitSystem}</Body>
                  </View>
                </View>
                <View style={styles.repsField}>
                  <Label>Reps</Label>
                  <View style={[styles.repsStepper, compact && styles.repsStepperCompact]}>
                    <Pressable disabled={disabled || readOnlyValues} accessibilityLabel={`Decrease reps for set ${index + 1}`} hitSlop={touchHitSlop} onPress={() => adjustReps(index, -1)} style={pressableFeedback([styles.repsStepButton, compact && styles.repsStepButtonCompact])}>
                      <Minus size={14} color={palette.ink} />
                    </Pressable>
                    <TextInput
                      accessibilityLabel={`Reps for set ${index + 1}`}
                      style={[styles.input, styles.repsInput, compact && styles.repsInputCompact]}
                      value={set.reps}
                      editable={!disabled && !readOnlyValues}
                      onChangeText={(reps) => updateSet(index, { reps })}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      placeholder={target?.targetReps ? `${target.targetReps}` : "reps"}
                    />
                    <Pressable disabled={disabled || readOnlyValues} accessibilityLabel={`Increase reps for set ${index + 1}`} hitSlop={touchHitSlop} onPress={() => adjustReps(index, 1)} style={pressableFeedback([styles.repsStepButton, compact && styles.repsStepButtonCompact])}>
                      <Plus size={14} color={palette.ink} />
                    </Pressable>
                  </View>
                </View>
              </View>
              {set.weight.trim() || targetDisplay || target?.targetReps || target?.increaseWeight ? (
                <View style={styles.setHints}>
                  {isPlannedSuggestion(set) ? <Label style={styles.loadState}>Planned</Label> : set.weight.trim() ? <Label style={styles.loadState}>Entered</Label> : targetDisplay ? <Label style={styles.loadState}>Suggested {targetDisplay}</Label> : null}
                  {target?.targetReps ? <Label style={styles.targetLabel}>Target {target.targetReps} reps</Label> : target?.increaseWeight ? <Label style={styles.targetLabel}>Heavier attempt</Label> : null}
                </View>
              ) : null}
              <View style={styles.setFooter}>
                <Pressable disabled={disabled || readOnlyValues} onPress={() => updateSet(index, { isWarmup: !set.isWarmup })} style={pressableFeedback([styles.kindButton, set.isWarmup && styles.kindButtonActive])}>
                  <Body style={[styles.kindText, set.isWarmup && styles.kindTextActive]}>{set.isWarmup ? "Warm-up" : "Working"}</Body>
                </Pressable>
                {supportsBarbell ? (
                  <Pressable
                    disabled={disabled || readOnlyValues}
                    accessibilityRole="button"
                    accessibilityLabel={`Open plate calculator for set ${index + 1}`}
                    accessibilityState={{ expanded: active }}
                    hitSlop={touchHitSlop}
                    onPress={() => setActiveIndex(active ? null : index)}
                    style={pressableFeedback([styles.plateCalculatorButton, active && styles.plateCalculatorButtonActive, (disabled || readOnlyValues) && styles.disabledButton])}
                  >
                    <Body style={[styles.plateCalculatorText, active && styles.plateCalculatorTextActive]}>Load plates</Body>
                  </Pressable>
                ) : null}
                <Pressable disabled={disabled || readOnlyValues} accessibilityLabel="Remove set" hitSlop={touchHitSlop} onPress={() => onSetsChange(sets.filter((_, itemIndex) => itemIndex !== index))} style={pressableFeedback(styles.iconButton)}>
                  <Trash2 size={16} color={palette.danger} />
                </Pressable>
              </View>
              </View>
            </View>


            {active && supportsBarbell ? (
              <View style={styles.editor}>
                <BarbellEditor
                  barWeight={editorBarWeight}
                  totalLoad={editorTotalLoad}
                  plateCounts={editorPlateCounts}
                  onBarWeight={changeEditorBarWeight}
                  onTotalLoad={changeEditorTotalLoad}
                  onPlateCount={changeEditorPlateCount}
                  onAdjustTotal={adjustEditorTotal}
                  disabled={disabled || readOnlyValues}
                  onReset={() => {
                    setEditorBarWeight("45");
                    setEditorTotalLoad("45");
                    setEditorPlateCounts(createEmptyPlateCounts());
                  }}
                />
                <View style={styles.editorActions}>
                  <Pressable disabled={disabled || readOnlyValues} hitSlop={touchHitSlop} onPress={() => applyEditorLoad("one")} style={pressableFeedback([styles.actionButton, styles.actionPrimary, (disabled || readOnlyValues) && styles.disabledButton])}>
                    <Body numberOfLines={1} style={[styles.buttonText, styles.actionText, styles.actionPrimaryText]}>Apply to set</Body>
                  </Pressable>
                  <Pressable disabled={disabled || readOnlyValues} hitSlop={touchHitSlop} onPress={() => applyEditorLoad("working")} style={pressableFeedback([styles.actionButton, (disabled || readOnlyValues) && styles.disabledButton])}>
                    <Body numberOfLines={1} style={[styles.buttonText, styles.actionText]}>All working sets</Body>
                  </Pressable>
                  <Pressable disabled={disabled || readOnlyValues} hitSlop={touchHitSlop} onPress={() => applyEditorLoad("down")} style={pressableFeedback([styles.actionButton, (disabled || readOnlyValues) && styles.disabledButton])}>
                    <Body numberOfLines={1} style={[styles.buttonText, styles.actionText]}>This and later sets</Body>
                  </Pressable>
                  <Pressable disabled={disabled || readOnlyValues || index === 0} hitSlop={touchHitSlop} onPress={() => copyPrevious(index)} style={pressableFeedback([styles.actionButton, (disabled || readOnlyValues || index === 0) && styles.disabledButton])}>
                    <Copy size={15} color={palette.ink} />
                    <Body numberOfLines={1} style={[styles.buttonText, styles.actionText]}>Copy previous</Body>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}

      <Pressable disabled={disabled || readOnlyValues} hitSlop={touchHitSlop} onPress={() => onSetsChange([...sets, { reps: "", weight: "" }])} style={pressableFeedback(styles.addButton)}>
        <Plus size={18} color={palette.ink} />
        <Body style={styles.buttonText}>Add set</Body>
      </Pressable>
    </View>
  );
}

function BarbellEditor({
  barWeight,
  totalLoad,
  plateCounts,
  onBarWeight,
  onTotalLoad,
  onPlateCount,
  onAdjustTotal,
  onReset,
  disabled
}: {
  barWeight: string;
  totalLoad: string;
  plateCounts: PlateCounts;
  onBarWeight: (value: string) => void;
  onTotalLoad: (value: string) => void;
  onPlateCount: (plate: PlateWeight, amount: number) => void;
  onAdjustTotal: (amount: number) => void;
  onReset: () => void;
  disabled: boolean;
}) {
  const { palette, styles } = useStyles();
  return (
    <>
      <View style={styles.editorHeader}>
        <View style={styles.flex}>
          <Label>Plate calculator</Label>
          <Body style={styles.hintText}>Set the target total. Plate counts are per side.</Body>
        </View>
        <Pressable disabled={disabled} accessibilityLabel="Reset plate calculator" hitSlop={touchHitSlop} onPress={onReset} style={pressableFeedback(styles.smallIconButton)}>
          <RotateCcw size={16} color={palette.ink} />
        </Pressable>
      </View>
      <View style={styles.barDropZone}>
        <LoadedBar
          counts={plateCounts}
          large
          onPlatePress={disabled ? undefined : (plate) => onPlateCount(plate, -1)}
        />
      </View>
      <Body style={styles.hintText}>Target {totalLoad} lb · loaded {formatLoadedBarWeight(calculateLoadedBarWeight(barWeight, plateCounts))} lb</Body>
      <View style={styles.editorInputRow}>
        <View style={styles.editorField}>
          <Label>Target (lb)</Label>
          <TextInput editable={!disabled} accessibilityLabel="Target total load in pounds" style={[styles.input, styles.editorInput]} value={totalLoad} onChangeText={onTotalLoad} keyboardType="decimal-pad" inputMode="decimal" />
        </View>
        <View style={styles.editorField}>
          <Label>Bar (lb)</Label>
          <TextInput editable={!disabled} accessibilityLabel="Bar weight in pounds" style={[styles.input, styles.editorInput]} value={barWeight} onChangeText={onBarWeight} keyboardType="decimal-pad" inputMode="decimal" />
        </View>
      </View>
      <View style={styles.quickButtons}>
        {[-10, -5, 5, 10].map((amount) => (
          <Pressable key={amount} accessibilityLabel={`${amount > 0 ? "Add" : "Remove"} ${Math.abs(amount)} lb`} disabled={disabled} hitSlop={touchHitSlop} onPress={() => onAdjustTotal(amount)} style={pressableFeedback(styles.quickButton)}>
            <Body style={styles.buttonText}>{amount > 0 ? `+${amount}` : `−${Math.abs(amount)}`}</Body>
          </Pressable>
        ))}
      </View>
      <View style={styles.plateControls}>
        {plateWeights.map((plate) => (
          <View key={plate} style={styles.plateControl}>
            <Pressable
              accessibilityLabel={`Add ${plate} lb plate to bar`}
              disabled={disabled}
              hitSlop={touchHitSlop}
              onPress={() => onPlateCount(plate, 1)}
              style={pressableFeedback(styles.plateTapHandle)}
            >
              <View style={[styles.plateSwatch, { backgroundColor: plateVisuals[plate].backgroundColor }]} />
              <Body style={styles.plateText}>{plate} lb</Body>
            </Pressable>
            <Pressable accessibilityLabel={`Remove one ${plate} lb plate per side`} disabled={disabled || plateCounts[plate] === 0} hitSlop={touchHitSlop} onPress={() => onPlateCount(plate, -1)} style={pressableFeedback([styles.countButton, plateCounts[plate] === 0 && styles.disabledButton])}>
              <Minus size={14} color={palette.ink} />
            </Pressable>
            <Body style={styles.countText}>{plateCounts[plate]}</Body>
            <Pressable accessibilityLabel={`Add one ${plate} lb plate per side`} disabled={disabled} hitSlop={touchHitSlop} onPress={() => onPlateCount(plate, 1)} style={pressableFeedback(styles.countButton)}>
              <Plus size={14} color={palette.ink} />
            </Pressable>
          </View>
        ))}
      </View>
    </>
  );
}

function normalizePlateCounts(counts: Record<string, number>): PlateCounts {
  return plateWeights.reduce<PlateCounts>((output, plate) => {
    output[plate] = Math.max(0, Number(counts[plate] ?? 0));
    return output;
  }, createEmptyPlateCounts());
}

function calculateLoadedBarWeight(currentBarWeight: string, counts: PlateCounts) {
  const bar = parseLoad(currentBarWeight);
  return bar + plateWeights.reduce((total, plate) => total + plate * counts[plate] * 2, 0);
}



function formatLoadedBarWeight(weight: number) {
  return weight.toFixed(1).replace(".0", "");
}


function isPositiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  composer: {
    gap: spacing.sm
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md
  },
  flex: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs
  },
  hintText: {
    color: palette.muted
  },
  setLane: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    padding: spacing.sm,
    gap: spacing.sm
  },
  setLaneActive: {
    borderColor: palette.ink,
    backgroundColor: palette.surface
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0
  },
  setBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs
  },
  setPrimaryRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xs,
    minWidth: 0
  },
  setHints: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md
  },
  setBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  setBadgeText: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  loadCell: {
    width: 116,
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...fastTouchStyle
  },
  loadCellActive: {
    borderColor: palette.accent,
    backgroundColor: palette.surface
  },
  targetRail: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 4,
    borderRadius: 3,
    backgroundColor: palette.border,
    opacity: 0.8
  },
  loadMeta: {
    flex: 1,
    minWidth: 68,
    gap: 2
  },
  weightField: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  directWeight: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  weightInput: {
    flex: 1,
    minWidth: 90
  },
  weightInputCompact: {
    minWidth: 0
  },
  unitText: {
    color: palette.muted,
    fontWeight: "800"
  },
  loadValue: {
    color: palette.ink,
    fontWeight: "900",
    fontVariant: ["tabular-nums"]
  },
  targetLabel: {
    color: palette.muted,
    fontSize: 10,
    lineHeight: 14
  },
  loadState: {
    color: palette.muted,
    fontSize: 10,
    lineHeight: 14
  },
  plateCalculatorButton: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: palette.surfaceAlt,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: "transparent",
    ...fastTouchStyle
  },
  plateCalculatorButtonActive: {
    borderColor: palette.ink,
    backgroundColor: palette.accentSoft
  },
  plateCalculatorText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "700"
  },
  plateCalculatorTextActive: {
    color: palette.accent
  },
  copyDownButton: {
    width: 36,
    height: 40,
    flexShrink: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  disabledButton: {
    opacity: 0.45
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.sm,
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  repsInput: {
    width: 48,
    textAlign: "center"
  },
  repsStepper: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 4
  },
  repsStepperCompact: {
    gap: 3
  },
  repsInputCompact: {
    width: 40,
    minWidth: 0,
    paddingHorizontal: 2
  },
  repsField: {
    flexShrink: 0,
    gap: 2
  },
  setFooter: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  repsStepButton: {
    width: 34,
    height: 42,
    borderRadius: 10,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  repsStepButtonCompact: {
    width: 32,
    height: 42
  },
  setActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  kindButton: {
    minHeight: 36,
    flexShrink: 0,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  kindButtonActive: {
    backgroundColor: palette.warning
  },
  kindText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "700"
  },
  kindTextActive: {
    color: palette.surface
  },
  iconButton: {
    width: 36,
    height: 36,
    flexShrink: 0,
    marginLeft: "auto",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  editor: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.sm,
    gap: spacing.sm
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  editorInputRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  editorField: {
    flex: 1,
    minWidth: 0,
    gap: 4
  },
  editorInput: {
    width: "100%"
  },
  smallInput: {
    width: 76,
    flexGrow: 0
  },
  loadInput: {
    flexGrow: 1,
    flexBasis: 120
  },
  quickButtons: {
    flexDirection: "row",
    gap: spacing.xs
  },
  quickButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  editorActions: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingBottom: 2
  },
  actionButton: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...fastTouchStyle
  },
  actionPrimary: {
    backgroundColor: palette.ink
  },
  actionPrimaryText: {
    color: palette.surface
  },
  actionText: {
    fontSize: 13
  },
  addButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  smallIconButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  barDropZone: {
    minHeight: 68,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  plateControls: {
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    paddingHorizontal: spacing.sm
  },
  plateControl: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border
  },
  plateTapHandle: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: 8,
    ...fastTouchStyle
  },
  plateSwatch: {
    width: 10,
    height: 18,
    borderRadius: 2
  },
  plateText: {
    color: palette.ink,
    fontWeight: "700"
  },
  countButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  countText: {
    minWidth: 22,
    textAlign: "center",
    color: palette.ink,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  buttonText: {
    color: palette.ink,
    fontWeight: "900",
    flexShrink: 1,
    textAlign: "center"
  },
}));
