import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Copy, Dumbbell, Minus, Plus, RotateCcw, Trash2 } from "lucide-react-native";

import { Body, Label } from "@/components/Text";
import { ExerciseLoadType, isBodyweightLoadType, isMachineLoadType } from "@/constants/exercises";
import { formatMachineLoad, machineLoadToWorkoutInput, stackUnitLabel, suggestedMachineLoads, workoutInputToMachineLoad } from "@/constants/machineProfiles";
import { LoggedSetDraft, MachineProfile, UnitSystem } from "@/types";
import { palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatWeightInput, weightToStorageUnit } from "@/utils/units";

const plateWeights = [45, 35, 25, 10, 5] as const;
type PlateWeight = typeof plateWeights[number];
type PlateCounts = Record<PlateWeight, number>;
type ApplyMode = "one" | "working" | "down";

const emptyPlateCounts = (): PlateCounts => ({ 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 });
const plateVisuals: Record<PlateWeight, { backgroundColor: string; height: number; width: number }> = {
  45: { backgroundColor: "#2563eb", height: 34, width: 8 },
  35: { backgroundColor: "#eab308", height: 30, width: 8 },
  25: { backgroundColor: "#16a34a", height: 26, width: 7 },
  10: { backgroundColor: "#64748b", height: 21, width: 6 },
  5: { backgroundColor: "#dc2626", height: 17, width: 5 }
};

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
  machineProfile?: MachineProfile | null;
  machineLabel?: string | null;
  machineLastLoad?: number | null;
  barWeight: string;
  plateCounts: Record<string, number>;
  targets?: SetComposerTarget[];
  onBarWeightChange: (value: string) => void;
  onPlateCountsChange: (counts: Record<string, number>) => void;
  onSetsChange: (sets: LoggedSetDraft[]) => void;
};

export function VisualSetComposer({
  sets,
  loadType,
  unitSystem,
  supportsBarbell,
  machineProfile,
  machineLabel,
  machineLastLoad,
  barWeight,
  plateCounts,
  targets = [],
  onBarWeightChange,
  onPlateCountsChange,
  onSetsChange
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [editorLoad, setEditorLoad] = useState("");
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

    if (isMachineLoadType(loadType)) {
      const stackLoad = workoutInputToMachineLoad(displayLoad, machineProfile, unitSystem);
      setEditorLoad(stackLoad !== null ? String(formatMachineNumber(stackLoad)) : "");
      return;
    }

    setEditorLoad(displayLoad);
  }, [activeIndex, barWeight, loadType, machineProfile, plateCounts, sets, supportsBarbell, targetByIndex, unitSystem]);

  function updateSet(index: number, patch: Partial<LoggedSetDraft>) {
    onSetsChange(sets.map((set, itemIndex) => (itemIndex === index ? { ...set, ...patch } : set)));
  }

  function adjustReps(index: number, amount: number) {
    const parsed = Number.parseInt(sets[index]?.reps ?? "", 10);
    const current = Number.isFinite(parsed) ? parsed : 0;
    const next = Math.max(0, current + amount);
    updateSet(index, { reps: next > 0 ? String(next) : "" });
  }

  function applyLoad(index: number, load: string, mode: ApplyMode) {
    if (!load.trim()) return;
    onSetsChange(sets.map((set, itemIndex) => {
      const shouldApply = mode === "one"
        ? itemIndex === index
        : mode === "working"
          ? !set.isWarmup
          : itemIndex >= index && !set.isWarmup;
      return shouldApply ? { ...set, weight: load } : set;
    }));
    setActiveIndex(null);
  }

  function applyEditorLoad(mode: ApplyMode) {
    if (activeIndex === null) return;
    if (supportsBarbell) {
      onBarWeightChange(editorBarWeight);
      onPlateCountsChange(editorPlateCounts);
      applyLoad(activeIndex, formatWeightInput(parseLoad(editorTotalLoad), unitSystem), mode);
      return;
    }
    if (isMachineLoadType(loadType)) {
      const parsed = parseLoad(editorLoad);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      applyLoad(activeIndex, machineLoadToWorkoutInput(parsed, machineProfile, unitSystem), mode);
      return;
    }
    applyLoad(activeIndex, editorLoad, mode);
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

  function adjustEditorLoad(amount: number) {
    const minimumLoad = isBodyweightLoadType(loadType) ? 0 : (machineProfile?.minLoad ?? 0);
    const next = Math.max(minimumLoad, parseLoad(editorLoad) + amount);
    setEditorLoad(String(formatMachineNumber(next)));
  }

  return (
    <View style={styles.composer}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Label>Sets</Label>
        </View>
      </View>

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
              <Pressable
                accessibilityLabel={`Edit load for set ${index + 1}`}
                hitSlop={touchHitSlop}
                onPress={() => setActiveIndex(active ? null : index)}
                style={pressableFeedback([styles.loadCell, active && styles.loadCellActive])}
              >
                {targetDisplay ? <View style={styles.targetRail} /> : null}
                <LoadVisual
                  loadType={loadType}
                  supportsBarbell={supportsBarbell}
                  displayLoad={displayLoad}
                  targetDisplayLoad={targetDisplay}
                  unitSystem={unitSystem}
                  barWeight={barWeight}
                  machineProfile={machineProfile}
                />
              </Pressable>
              <View style={styles.loadMeta}>
                <Body style={styles.loadValue}>{displayLoad ? loadLabel(displayLoad, loadType, unitSystem, machineProfile) : "Load"}</Body>
                {target?.targetReps ? <Label style={styles.targetLabel}>target {target.targetReps}</Label> : target?.increaseWeight ? <Label style={styles.targetLabel}>heavier attempt</Label> : null}
                {machineLabel && isMachineLoadType(loadType) ? <Label style={styles.targetLabel}>{machineLabel}</Label> : null}
              </View>
              <Pressable accessibilityLabel={`Copy load from set ${index + 1} down`} hitSlop={touchHitSlop} onPress={() => copyLoadDown(index, displayLoad)} style={pressableFeedback([styles.copyDownButton, !displayLoad.trim() && styles.disabledButton])}>
                <Copy size={14} color={displayLoad.trim() ? palette.ink : palette.muted} />
              </Pressable>
              <View style={styles.repsStepper}>
                <Pressable accessibilityLabel={`Decrease reps for set ${index + 1}`} hitSlop={touchHitSlop} onPress={() => adjustReps(index, -1)} style={pressableFeedback(styles.repsStepButton)}>
                  <Minus size={14} color={palette.ink} />
                </Pressable>
                <TextInput
                  style={[styles.input, styles.repsInput]}
                  value={set.reps}
                  onChangeText={(reps) => updateSet(index, { reps })}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder={target?.targetReps ? `${target.targetReps}` : "reps"}
                />
                <Pressable accessibilityLabel={`Increase reps for set ${index + 1}`} hitSlop={touchHitSlop} onPress={() => adjustReps(index, 1)} style={pressableFeedback(styles.repsStepButton)}>
                  <Plus size={14} color={palette.ink} />
                </Pressable>
              </View>
              <Pressable onPress={() => updateSet(index, { isWarmup: !set.isWarmup })} style={pressableFeedback([styles.kindButton, set.isWarmup && styles.kindButtonActive])}>
                <Body style={[styles.kindText, set.isWarmup && styles.kindTextActive]}>{set.isWarmup ? "Warm-up" : "Working"}</Body>
              </Pressable>
              <Pressable accessibilityLabel="Remove set" hitSlop={touchHitSlop} onPress={() => onSetsChange(sets.filter((_, itemIndex) => itemIndex !== index))} style={pressableFeedback(styles.iconButton)}>
                <Trash2 size={16} color={palette.danger} />
              </Pressable>
            </View>

            {active ? (
              <View style={styles.editor}>
                {supportsBarbell ? (
                  <BarbellEditor
                    barWeight={editorBarWeight}
                    totalLoad={editorTotalLoad}
                    plateCounts={editorPlateCounts}
                    onBarWeight={changeEditorBarWeight}
                    onTotalLoad={changeEditorTotalLoad}
                    onPlateCount={changeEditorPlateCount}
                    onAdjustTotal={adjustEditorTotal}
                    onReset={() => {
                      setEditorBarWeight("45");
                      setEditorTotalLoad("45");
                      setEditorPlateCounts(emptyPlateCounts());
                    }}
                  />
                ) : (
                  <SimpleLoadEditor
                    loadType={loadType}
                    load={editorLoad}
                    unitSystem={unitSystem}
                    machineProfile={machineProfile}
                    machineLastLoad={machineLastLoad}
                    onLoad={setEditorLoad}
                    onAdjust={adjustEditorLoad}
                  />
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.editorActions}>
                    <Pressable hitSlop={touchHitSlop} onPress={() => applyEditorLoad("one")} style={pressableFeedback(styles.actionButton)}>
                      <Body style={styles.buttonText}>Apply set</Body>
                    </Pressable>
                    <Pressable hitSlop={touchHitSlop} onPress={() => applyEditorLoad("working")} style={pressableFeedback(styles.actionButton)}>
                      <Body style={styles.buttonText}>All working</Body>
                    </Pressable>
                    <Pressable hitSlop={touchHitSlop} onPress={() => applyEditorLoad("down")} style={pressableFeedback(styles.actionButton)}>
                      <Body style={styles.buttonText}>From here down</Body>
                    </Pressable>
                    <Pressable hitSlop={touchHitSlop} onPress={() => copyPrevious(index)} style={pressableFeedback(styles.actionButton)}>
                      <Copy size={16} color={palette.ink} />
                      <Body style={styles.buttonText}>Copy previous</Body>
                    </Pressable>
                  </View>
                </ScrollView>
              </View>
            ) : null}
          </View>
        );
      })}

      <Pressable hitSlop={touchHitSlop} onPress={() => onSetsChange([...sets, { reps: "", weight: "" }])} style={pressableFeedback(styles.addButton)}>
        <Plus size={18} color={palette.ink} />
        <Body style={styles.buttonText}>Add set</Body>
      </Pressable>
    </View>
  );
}

function LoadVisual({
  loadType,
  supportsBarbell,
  displayLoad,
  targetDisplayLoad,
  unitSystem,
  barWeight,
  machineProfile
}: {
  loadType: ExerciseLoadType;
  supportsBarbell: boolean;
  displayLoad: string;
  targetDisplayLoad: string;
  unitSystem: UnitSystem;
  barWeight: string;
  machineProfile?: MachineProfile | null;
}) {
  if (supportsBarbell) {
    const load = displayLoad || targetDisplayLoad;
    const counts = load ? calculatePlateCounts(String(weightToStorageUnit(parseLoad(load), unitSystem)), barWeight) : emptyPlateCounts();
    return <LoadedBar counts={counts} />;
  }
  if (isMachineLoadType(loadType)) {
    const load = workoutInputToMachineLoad(displayLoad || targetDisplayLoad, machineProfile, unitSystem);
    return <MachineStack load={load} profile={machineProfile} />;
  }
  if (isBodyweightLoadType(loadType)) {
    return <BodyweightBadge load={displayLoad || targetDisplayLoad} assisted={loadType === "bodyweight_minus_assistance"} />;
  }
  return <DumbbellPair />;
}

function BarbellEditor({
  barWeight,
  totalLoad,
  plateCounts,
  onBarWeight,
  onTotalLoad,
  onPlateCount,
  onAdjustTotal,
  onReset
}: {
  barWeight: string;
  totalLoad: string;
  plateCounts: PlateCounts;
  onBarWeight: (value: string) => void;
  onTotalLoad: (value: string) => void;
  onPlateCount: (plate: PlateWeight, amount: number) => void;
  onAdjustTotal: (amount: number) => void;
  onReset: () => void;
}) {
  return (
    <>
      <View style={styles.editorHeader}>
        <View style={styles.flex}>
          <Label>Loaded bar</Label>
          <Body style={styles.hintText}>Counts are plates per side.</Body>
        </View>
        <Pressable hitSlop={touchHitSlop} onPress={onReset} style={pressableFeedback(styles.smallIconButton)}>
          <RotateCcw size={16} color={palette.ink} />
        </Pressable>
      </View>
      <View style={styles.barDropZone}>
        <LoadedBar
          counts={plateCounts}
          large
          onPlatePress={(plate) => onPlateCount(plate, -1)}
        />
      </View>
      <View style={styles.editorInputRow}>
        <Label>Total</Label>
        <TextInput style={[styles.input, styles.smallInput]} value={totalLoad} onChangeText={onTotalLoad} keyboardType="decimal-pad" inputMode="decimal" />
        <Body>lb</Body>
        <Label>Bar</Label>
        <TextInput style={[styles.input, styles.smallInput]} value={barWeight} onChangeText={onBarWeight} keyboardType="decimal-pad" inputMode="decimal" />
      </View>
      <View style={styles.quickButtons}>
        {[-10, -5, 5, 10].map((amount) => (
          <Pressable key={amount} hitSlop={touchHitSlop} onPress={() => onAdjustTotal(amount)} style={pressableFeedback(styles.quickButton)}>
            <Body style={styles.buttonText}>{amount > 0 ? `+${amount}` : amount}</Body>
          </Pressable>
        ))}
      </View>
      <View style={styles.plateControls}>
        {plateWeights.map((plate) => (
          <View key={plate} style={styles.plateControl}>
            <Pressable
              accessibilityLabel={`Add ${plate} lb plate to bar`}
              hitSlop={touchHitSlop}
              onPress={() => onPlateCount(plate, 1)}
              style={pressableFeedback(styles.plateTapHandle)}
            >
              <View style={[styles.plateSwatch, { backgroundColor: plateVisuals[plate].backgroundColor }]} />
              <Body style={styles.plateText}>{plate}</Body>
            </Pressable>
            <Pressable hitSlop={touchHitSlop} onPress={() => onPlateCount(plate, -1)} style={pressableFeedback(styles.countButton)}>
              <Body style={styles.buttonText}>-</Body>
            </Pressable>
            <Body style={styles.countText}>{plateCounts[plate]}</Body>
            <Pressable hitSlop={touchHitSlop} onPress={() => onPlateCount(plate, 1)} style={pressableFeedback(styles.countButton)}>
              <Body style={styles.buttonText}>+</Body>
            </Pressable>
          </View>
        ))}
      </View>
    </>
  );
}

function SimpleLoadEditor({
  loadType,
  load,
  unitSystem,
  machineProfile,
  machineLastLoad,
  onLoad,
  onAdjust
}: {
  loadType: ExerciseLoadType;
  load: string;
  unitSystem: UnitSystem;
  machineProfile?: MachineProfile | null;
  machineLastLoad?: number | null;
  onLoad: (value: string) => void;
  onAdjust: (amount: number) => void;
}) {
  const machine = isMachineLoadType(loadType);
  const step = machine ? machineProfile?.increment ?? 5 : 5;
  const unit = machine ? stackUnitLabel(machineProfile?.stackUnit ?? unitSystem, unitSystem) : unitSystem;
  const machineSuggestions = machine ? suggestedMachineLoads(machineProfile, machineLastLoad) : [];
  return (
    <>
      <View style={styles.editorHeader}>
        <View style={styles.flex}>
          <Label>{machine ? "Stack pin" : isBodyweightLoadType(loadType) ? "Bodyweight load" : "Dumbbells"}</Label>
          <Body style={styles.hintText}>{machine ? "Move the pin by plate steps or type the stack value." : "Adjust the actual load for this set."}</Body>
        </View>
      </View>
      <View style={styles.simpleEditorVisual}>
        {machine ? <MachineStack load={parseLoad(load)} profile={machineProfile} large /> : isBodyweightLoadType(loadType) ? <BodyweightBadge load={load} assisted={loadType === "bodyweight_minus_assistance"} large /> : <DumbbellPair large />}
      </View>
      <View style={styles.editorInputRow}>
        <TextInput style={[styles.input, styles.loadInput]} value={load} onChangeText={onLoad} keyboardType="decimal-pad" inputMode="decimal" placeholder={unit} />
        <Body>{unit}</Body>
      </View>
      <View style={styles.quickButtons}>
        {[-step, step].map((amount) => (
          <Pressable key={amount} hitSlop={touchHitSlop} onPress={() => onAdjust(amount)} style={pressableFeedback(styles.quickButton)}>
            <Body style={styles.buttonText}>{amount > 0 ? `+${formatMachineNumber(amount)}` : `-${formatMachineNumber(Math.abs(amount))}`}</Body>
          </Pressable>
        ))}
      </View>
      {machineSuggestions.length ? (
        <View style={styles.loadChips}>
          {machineSuggestions.map((suggestion) => (
            <Pressable key={suggestion} hitSlop={touchHitSlop} onPress={() => onLoad(String(formatMachineNumber(suggestion)))} style={pressableFeedback([styles.loadChip, parseLoad(load) === suggestion && styles.loadChipActive])}>
              <Body style={[styles.loadChipText, parseLoad(load) === suggestion && styles.loadChipTextActive]}>{formatMachineLoad(suggestion, machineProfile, unitSystem)}</Body>
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
}

function LoadedBar({
  counts,
  large = false,
  onPlatePress
}: {
  counts: PlateCounts;
  large?: boolean;
  onPlatePress?: (plate: PlateWeight) => void;
}) {
  function renderPlate(side: "left" | "right", plate: PlateWeight, index: number) {
    const plateView = <View style={[styles.plate, plateVisuals[plate], large && styles.plateLarge]} />;
    if (!onPlatePress) return <View key={`${side}-${plate}-${index}`}>{plateView}</View>;
    return (
      <Pressable
        key={`${side}-${plate}-${index}`}
        accessibilityLabel={`Remove ${plate} lb plate from bar`}
        hitSlop={touchHitSlop}
        onPress={() => onPlatePress(plate)}
        style={pressableFeedback(styles.loadedPlateHandle)}
      >
        {plateView}
      </Pressable>
    );
  }

  return (
    <View style={[styles.loadedBar, large && styles.loadedBarLarge]}>
      <View style={[styles.plateStack, styles.plateStackLeft]}>
        {[...plateWeights].reverse().flatMap((plate) => plateCopies(counts[plate]).map((_, index) => renderPlate("left", plate, index)))}
      </View>
      <View style={styles.sleeve} />
      <View style={[styles.shaft, large && styles.shaftLarge]} />
      <View style={styles.sleeve} />
      <View style={[styles.plateStack, styles.plateStackRight]}>
        {plateWeights.flatMap((plate) => plateCopies(counts[plate]).map((_, index) => renderPlate("right", plate, index)))}
      </View>
    </View>
  );
}

function MachineStack({ load, profile, large = false }: { load: number | null; profile?: MachineProfile | null; large?: boolean }) {
  const min = profile?.minLoad ?? 0;
  const max = Math.max(profile?.maxLoad ?? 100, min + 1);
  const value = Number.isFinite(load) ? Number(load) : min;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const activeIndex = 5 - Math.round(ratio * 5);
  return (
    <View style={[styles.stackVisual, large && styles.stackVisualLarge]}>
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={[styles.stackPlate, index === activeIndex && styles.stackPlateActive]}>
          {index === activeIndex ? <View style={styles.stackPin} /> : null}
        </View>
      ))}
    </View>
  );
}

function DumbbellPair({ large = false }: { large?: boolean }) {
  return (
    <View style={styles.dumbbellPair}>
      {[0, 1].map((item) => (
        <View key={item} style={[styles.dumbbell, large && styles.dumbbellLarge]}>
          <View style={styles.dumbbellEnd} />
          <View style={styles.dumbbellHandle} />
          <View style={styles.dumbbellEnd} />
        </View>
      ))}
      <Dumbbell size={large ? 22 : 16} color={palette.ink} />
    </View>
  );
}

function BodyweightBadge({ load, assisted, large = false }: { load: string; assisted: boolean; large?: boolean }) {
  const value = load.trim() || "0";
  return (
    <View style={[styles.bodyweightBadge, large && styles.bodyweightBadgeLarge]}>
      <Body style={styles.bodyweightText}>{assisted ? "assist" : "+"}</Body>
      <Body style={styles.bodyweightNumber}>{value}</Body>
    </View>
  );
}

function loadLabel(displayLoad: string, loadType: ExerciseLoadType, unitSystem: UnitSystem, machineProfile?: MachineProfile | null) {
  if (isMachineLoadType(loadType)) {
    const stackLoad = workoutInputToMachineLoad(displayLoad, machineProfile, unitSystem);
    return stackLoad !== null ? formatMachineLoad(stackLoad, machineProfile, unitSystem) : "Stack";
  }
  if (isBodyweightLoadType(loadType)) return loadType === "bodyweight_minus_assistance" ? `${displayLoad} assist` : `+${displayLoad}`;
  return `${displayLoad} ${unitSystem}`;
}

function normalizePlateCounts(counts: Record<string, number>): PlateCounts {
  return plateWeights.reduce<PlateCounts>((output, plate) => {
    output[plate] = Math.max(0, Number(counts[plate] ?? 0));
    return output;
  }, emptyPlateCounts());
}

function calculateLoadedBarWeight(currentBarWeight: string, counts: PlateCounts) {
  const bar = parseLoad(currentBarWeight);
  return bar + plateWeights.reduce((total, plate) => total + plate * counts[plate] * 2, 0);
}

function calculatePlateCounts(totalLoad: string, currentBarWeight: string) {
  let remainingPerSide = Math.max(0, (parseLoad(totalLoad) - parseLoad(currentBarWeight)) / 2);
  return plateWeights.reduce<PlateCounts>((counts, plate) => {
    const count = Math.floor((remainingPerSide + Number.EPSILON) / plate);
    counts[plate] = count;
    remainingPerSide -= count * plate;
    return counts;
  }, emptyPlateCounts());
}

function parseLoad(value: string) {
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatLoadedBarWeight(weight: number) {
  return weight.toFixed(1).replace(".0", "");
}

function formatMachineNumber(value: number) {
  return Number(value.toFixed(1).replace(".0", ""));
}

function plateCopies(count: number) {
  return Array.from({ length: Math.min(5, Math.max(0, Number(count) || 0)) });
}

const styles = StyleSheet.create({
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
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
    minWidth: 0
  },
  setBadge: {
    width: 26,
    height: 34,
    borderRadius: 7,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  setBadgeText: {
    color: palette.ink,
    fontWeight: "900"
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
  loadValue: {
    color: palette.ink,
    fontWeight: "900",
    fontVariant: ["tabular-nums"]
  },
  targetLabel: {
    color: palette.muted,
    fontSize: 11
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
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 4
  },
  repsStepButton: {
    width: 34,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  kindButton: {
    minHeight: 40,
    minWidth: 72,
    flexShrink: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  kindButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  kindText: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "800"
  },
  kindTextActive: {
    color: palette.surface
  },
  iconButton: {
    width: 40,
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
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm
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
    flexWrap: "wrap",
    gap: spacing.sm
  },
  loadChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  loadChip: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
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
  quickButton: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  editorActions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: 2
  },
  actionButton: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  addButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  smallIconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  loadedBar: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center"
  },
  loadedBarLarge: {
    minHeight: 62
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
  plateStack: {
    minWidth: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 1
  },
  plateStackLeft: {
    justifyContent: "flex-end"
  },
  plateStackRight: {
    justifyContent: "flex-start"
  },
  plate: {
    borderRadius: 2
  },
  plateLarge: {
    transform: [{ scaleY: 1.18 }]
  },
  loadedPlateHandle: {
    borderRadius: 4,
    ...fastTouchStyle
  },
  sleeve: {
    width: 10,
    height: 8,
    backgroundColor: palette.ink
  },
  shaft: {
    width: 44,
    height: 5,
    backgroundColor: palette.muted
  },
  shaftLarge: {
    width: 94
  },
  plateControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  plateControl: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.sm
  },
  plateTapHandle: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: 7,
    paddingHorizontal: spacing.xs,
    ...fastTouchStyle
  },
  plateSwatch: {
    width: 10,
    height: 18,
    borderRadius: 2
  },
  plateText: {
    fontWeight: "900"
  },
  countButton: {
    width: 26,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  countText: {
    minWidth: 14,
    textAlign: "center",
    fontWeight: "900"
  },
  buttonText: {
    color: palette.ink,
    fontWeight: "900"
  },
  stackVisual: {
    width: 54,
    gap: 2
  },
  stackVisualLarge: {
    width: 96,
    gap: 3
  },
  stackPlate: {
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.border,
    alignItems: "flex-end",
    justifyContent: "center"
  },
  stackPlateActive: {
    backgroundColor: palette.accent
  },
  stackPin: {
    width: 14,
    height: 8,
    borderRadius: 5,
    backgroundColor: palette.ink,
    marginRight: -5
  },
  simpleEditorVisual: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center"
  },
  dumbbellPair: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  dumbbell: {
    flexDirection: "row",
    alignItems: "center"
  },
  dumbbellLarge: {
    transform: [{ scale: 1.2 }]
  },
  dumbbellEnd: {
    width: 8,
    height: 24,
    borderRadius: 3,
    backgroundColor: palette.ink
  },
  dumbbellHandle: {
    width: 20,
    height: 5,
    backgroundColor: palette.muted
  },
  bodyweightBadge: {
    minWidth: 68,
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  bodyweightBadgeLarge: {
    minWidth: 112,
    minHeight: 48
  },
  bodyweightText: {
    color: palette.surface,
    fontSize: 11,
    fontWeight: "900"
  },
  bodyweightNumber: {
    color: palette.surface,
    fontWeight: "900",
    fontVariant: ["tabular-nums"]
  }
});
