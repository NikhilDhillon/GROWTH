import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, ChevronRight, Plus, Timer, Trash2, X } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { activePlannedExerciseMuscles, emptyActiveExercise, exerciseMuscleToSplitMuscle, splitMuscleToExerciseMuscle } from "@/constants/activeWorkout";
import { ExerciseLoadType, getExerciseLoadType, supportsBarbellCalculator } from "@/constants/exercises";
import { cloneTrainingSplitDays } from "@/constants/trainingSplit";
import { getClosestBodyweightForDate } from "@/services/analytics/bulkAnalyticsService";
import { calculateSessionPerformance, findStrengthReference } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { ActiveWorkout, LoggedSetDraft, MuscleGroup, SplitMuscle, TrainingSplitDay, WorkoutRecommendationRow } from "@/types";
import { muscles, palette, spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatBodyWeight, formatWeight, formatWeightInput, weightToStorageUnit } from "@/utils/units";

const plateWeights = [45, 35, 25, 10, 5] as const;
type PlateWeight = typeof plateWeights[number];
const plateVisuals: Record<PlateWeight, { backgroundColor: string; height: number; width: number }> = {
  45: { backgroundColor: "#2563eb", height: 52, width: 11 },
  35: { backgroundColor: "#eab308", height: 46, width: 10 },
  25: { backgroundColor: "#16a34a", height: 40, width: 9 },
  10: { backgroundColor: "#64748b", height: 32, width: 8 },
  5: { backgroundColor: "#dc2626", height: 24, width: 7 }
};

export function GuidedWorkoutScreen() {
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const trainingSplit = useFitnessStore((state) => state.trainingSplit);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const saveTrainingSplit = useFitnessStore((state) => state.saveTrainingSplit);
  const updateActiveWorkout = useFitnessStore((state) => state.updateActiveWorkout);
  const finishActiveWorkout = useFitnessStore((state) => state.finishActiveWorkout);
  const [clock, setClock] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!activeWorkout) {
    return (
      <Screen>
        <Panel>
          <SectionTitle>No workout in progress</SectionTitle>
          <Body>Start a guided workout from Home.</Body>
          <Pressable onPress={() => navigation.navigate("Home")} style={pressableFeedback(styles.primaryButton)}>
            <Body style={styles.primaryText}>Return home</Body>
          </Pressable>
        </Panel>
      </Screen>
    );
  }

  const workout = activeWorkout;
  const current = workout.currentExercise;
  const pendingMuscle = workout.pendingMuscle;
  const chooseReplace = workout.schedulePrompt === "replace";
  const selectedExercise = exercises.find((exercise) => exercise.id === current.exerciseId) ?? null;
  const visibleExercises = current.muscle ? exercises.filter((exercise) => exercise.primary_muscle === current.muscle) : [];
  const plannedMuscles = activePlannedExerciseMuscles(workout);
  const loadType = getExerciseLoadType(selectedExercise?.name ?? "");
  const selectedBodyWeight = loadType === "external" ? null : getClosestBodyweightForDate(workout.workoutDate, bodyWeightLogs);
  const latestSets = selectedExercise ? findLatestSets(selectedExercise.id, sessions, sets) : [];
  const recommendations = latestSets.map((set, index) => recommendationForSet(set.weight, set.reps, index + 1));
  const bestPerformance = selectedExercise ? findStrengthReference(exercisePoints.filter((point) => point.exerciseId === selectedExercise.id)) : undefined;
  const projectedPerformance = selectedExercise
    ? calculateSessionPerformance(
        current.sets
          .map((set, index) => ({ reps: Number(set.reps), weight: weightToStorageUnit(Number(set.weight), unitSystem), set_number: index + 1 }))
          .filter((set) => set.reps > 0 || set.weight > 0),
        bestPerformance,
        { loadType, bodyWeight: selectedBodyWeight?.weight }
      )
    : null;
  const loadedBarWeight = calculateLoadedBarWeight(current.barWeight, current.plateCounts);
  const sourceDay = trainingSplit.days.find((day) => day.key === workout.sourceDayKey);

  function persist(updater: (workout: ActiveWorkout) => ActiveWorkout) {
    void updateActiveWorkout(updater(workout)).catch((caught) => setError(errorMessage(caught)));
  }

  function updateDraft(patch: Partial<ActiveWorkout["currentExercise"]>) {
    persist((workout) => ({ ...workout, currentExercise: { ...workout.currentExercise, ...patch } }));
  }

  function selectMuscle(muscle: MuscleGroup) {
    if (plannedMuscles.includes(muscle)) {
      persist((active) => ({ ...active, pendingMuscle: null, schedulePrompt: null, currentExercise: { ...active.currentExercise, muscle, exerciseId: null } }));
      return;
    }
    persist((active) => ({ ...active, pendingMuscle: muscle, schedulePrompt: "off_plan" }));
  }

  function useOffPlanMuscleForWorkout() {
    if (!pendingMuscle) return;
    persist((active) => ({ ...active, pendingMuscle: null, schedulePrompt: null, currentExercise: { ...active.currentExercise, muscle: pendingMuscle, exerciseId: null } }));
  }

  async function addOffPlanMuscle() {
    if (!pendingMuscle) return;
    const splitMuscle = exerciseMuscleToSplitMuscle(pendingMuscle);
    const days = cloneTrainingSplitDays(trainingSplit.days);
    const today = days.find((day) => day.key === workout.todayDayKey);
    if (today && !today.muscles.includes(splitMuscle)) today.muscles.push(splitMuscle);
    await saveScheduleAndSelect(days, pendingMuscle);
  }

  async function replacePlannedMuscle(replaced: SplitMuscle) {
    if (!pendingMuscle) return;
    const days = cloneTrainingSplitDays(trainingSplit.days);
    const today = days.find((day) => day.key === workout.todayDayKey);
    if (today) {
      const position = today.muscles.indexOf(replaced);
      if (position >= 0) today.muscles[position] = exerciseMuscleToSplitMuscle(pendingMuscle);
    }
    await saveScheduleAndSelect(days, pendingMuscle);
  }

  async function saveScheduleAndSelect(days: TrainingSplitDay[], muscle: MuscleGroup) {
    try {
      await saveTrainingSplit(days);
      persist((workout) => ({
        ...workout,
        plannedMuscles: [...(days.find((day) => day.key === workout.todayDayKey)?.muscles ?? workout.plannedMuscles)],
        currentExercise: { ...workout.currentExercise, muscle, exerciseId: null },
        pendingMuscle: null,
        schedulePrompt: null
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function chooseRestDay(day: TrainingSplitDay, saveSwap: boolean) {
    try {
      if (saveSwap) {
        const days = cloneTrainingSplitDays(trainingSplit.days);
        const today = days.find((item) => item.key === workout.todayDayKey);
        const selected = days.find((item) => item.key === day.key);
        if (today && selected) {
          today.muscles = [...selected.muscles];
          selected.muscles = [];
          await saveTrainingSplit(days);
        }
      }
      await updateActiveWorkout({
        ...workout,
        sourceDayKey: day.key,
        plannedMuscles: [...day.muscles],
        currentExercise: emptyActiveExercise(),
        pendingMuscle: null,
        schedulePrompt: null
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function completeCurrent(endAfterSave: boolean) {
    if (!selectedExercise) {
      if (endAfterSave && !hasEnteredSets(current.sets)) {
        await finish();
      } else {
        setError("Choose an exercise and enter working sets first.");
      }
      return;
    }
    if (endAfterSave && !hasEnteredSets(current.sets)) {
      await finish();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveWorkout({
        exerciseId: selectedExercise.id,
        workoutDate: workout.workoutDate,
        notes: current.notes,
        sets: current.sets
      });
      if (endAfterSave) {
        await finish();
        return;
      }
      await updateActiveWorkout({
        ...workout,
        completedExercises: [...workout.completedExercises, {
          exerciseId: selectedExercise.id,
          exerciseName: selectedExercise.name,
          muscle: selectedExercise.primary_muscle,
          sets: current.sets,
          completedAt: new Date().toISOString()
        }],
        currentExercise: emptyActiveExercise()
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    await finishActiveWorkout();
    setConfirmEnd(false);
    navigation.navigate("Home");
  }

  if (!activeWorkout.plannedMuscles.length) {
    return (
      <Screen>
        <View style={styles.titleRow}>
          <View>
            <Label>Guided workout</Label>
            <Title>Rest day override</Title>
          </View>
          <TimerDisplay startedAt={activeWorkout.startedAt} now={clock} />
        </View>
        <Panel>
          <SectionTitle>Today is scheduled for rest</SectionTitle>
          <Body>Choose a training day to follow. You can use it only for this workout or swap it with today in your synchronized split.</Body>
          {trainingSplit.days.filter((day) => day.muscles.length).map((day) => (
            <View key={day.key} style={styles.planRow}>
              <View style={styles.flex}>
                <Label>{day.label}</Label>
                <Body>{day.muscles.join(" + ")}</Body>
              </View>
              <Pressable onPress={() => void chooseRestDay(day, false)} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Use today</Body>
              </Pressable>
              <Pressable onPress={() => void chooseRestDay(day, true)} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Swap & save</Body>
              </Pressable>
            </View>
          ))}
          {error ? <Body style={styles.error}>{error}</Body> : null}
        </Panel>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.titleRow}>
        <View>
          <Label>Guided workout</Label>
          <Title>{sourceDay?.label ?? "Today's"} training</Title>
          <Body>{activeWorkout.plannedMuscles.join(" + ")}</Body>
        </View>
        <TimerDisplay startedAt={activeWorkout.startedAt} now={clock} />
      </View>

      {activeWorkout.completedExercises.map((exercise, index) => (
        <Panel key={`${exercise.exerciseId}-${exercise.completedAt}`}>
          <View style={styles.summaryRow}>
            <Check size={18} color={palette.success} />
            <SectionTitle>Exercise {index + 1}: {exercise.exerciseName}</SectionTitle>
            <ChevronRight size={18} color={palette.muted} />
          </View>
          <Body>{exercise.sets.filter((set) => set.reps || set.weight).map((set) => `${set.weight} ${unitSystem} x ${set.reps}`).join(" | ")}</Body>
        </Panel>
      ))}

      <Panel>
        <SectionTitle>Exercise {activeWorkout.completedExercises.length + 1}</SectionTitle>
        <Body>Choose a muscle group for your current exercise.</Body>
        <View style={styles.chips}>
          {muscles.map((muscle) => (
            <Pressable key={muscle} onPress={() => selectMuscle(muscle)} style={pressableFeedback([styles.chip, current.muscle === muscle && styles.chipActive])}>
              <Body style={[styles.chipText, current.muscle === muscle && styles.chipTextActive]}>{muscle === "Core" ? "Abs" : muscle}</Body>
            </Pressable>
          ))}
        </View>
        {pendingMuscle ? (
          <View style={styles.prompt}>
            <Body>{pendingMuscle === "Core" ? "Abs" : pendingMuscle} is not planned today. Use it only now or update the weekly split?</Body>
            <View style={styles.actions}>
              <Pressable onPress={useOffPlanMuscleForWorkout} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>This workout only</Body>
              </Pressable>
              <Pressable onPress={() => persist((active) => ({ ...active, schedulePrompt: "replace" }))} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Update weekly split</Body>
              </Pressable>
            </View>
            {chooseReplace ? (
              <>
                <Pressable onPress={() => void addOffPlanMuscle()} style={pressableFeedback(styles.secondaryButton)}>
                  <Body style={styles.buttonText}>Add to today</Body>
                </Pressable>
                <Body>Or replace a planned muscle:</Body>
                <View style={styles.chips}>
                  {activeWorkout.plannedMuscles.map((muscle) => (
                    <Pressable key={muscle} onPress={() => void replacePlannedMuscle(muscle)} style={pressableFeedback(styles.secondaryButton)}>
                      <Body style={styles.buttonText}>Replace {muscle}</Body>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {current.muscle ? (
          <>
            <Body>Choose an exercise:</Body>
            <View style={styles.chips}>
              {visibleExercises.map((exercise) => (
                <Pressable key={exercise.id} onPress={() => updateDraft({ exerciseId: exercise.id })} style={pressableFeedback([styles.chip, current.exerciseId === exercise.id && styles.chipActive])}>
                  <Body style={[styles.chipText, current.exerciseId === exercise.id && styles.chipTextActive]}>{exercise.name}</Body>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </Panel>

      {selectedExercise ? (
        <Panel>
          <View style={styles.summaryRow}>
            <View style={styles.flex}>
              <SectionTitle>{selectedExercise.name}</SectionTitle>
              <Body>{bestPerformance ? `Best e1RM ${formatWeight(bestPerformance.estimated1RM, unitSystem)} | ${bestPerformance.performancePoints.toFixed(1)} points` : "No best performance yet."}</Body>
            </View>
          </View>

          <View style={styles.guidance}>
            <Label>Progressive overload target</Label>
            {recommendations.length ? recommendations.map((row) => (
              <Body key={row.setNumber}>
                Set {row.setNumber}: {row.requiresLoadChange
                  ? `${loadChangeInstruction(loadType)} from ${formatWeight(row.weight, unitSystem)} and aim for 8-10 reps.`
                  : `${formatWeight(row.weight, unitSystem)} x ${row.minimumReps}-${row.maximumReps} reps.`}
              </Body>
            )) : <Body>We don't have data yet, but luckily we'll get it today.</Body>}
          </View>

          {loadType !== "external" ? (
            <Body>{loadInstruction(loadType, selectedBodyWeight?.weight)}</Body>
          ) : null}

          {supportsBarbellCalculator(selectedExercise.name) ? (
            <BarCalculator
              barWeight={current.barWeight}
              plateCounts={current.plateCounts}
              loadedBarWeight={loadedBarWeight}
              unitSystem={unitSystem}
              onBarWeight={(barWeight) => updateDraft({ barWeight })}
              onPlateCount={(plate, amount) => updateDraft({ plateCounts: { ...current.plateCounts, [plate]: Math.max(0, Number(current.plateCounts[plate] ?? 0) + amount) } })}
              onApply={(index) => updateSet(index, "weight", formatWeightInput(loadedBarWeight, unitSystem))}
              setCount={current.sets.length}
            />
          ) : null}

          <Label>Working sets</Label>
          {current.sets.map((set, index) => (
            <View key={index} style={styles.setRow}>
              <Label>{index + 1}</Label>
              <TextInput style={[styles.input, styles.setInput]} value={set.weight} onChangeText={(value) => updateSet(index, "weight", value)} inputMode="decimal" placeholder={loadPlaceholder(loadType, unitSystem)} />
              <TextInput style={[styles.input, styles.setInput]} value={set.reps} onChangeText={(value) => updateSet(index, "reps", value)} inputMode="numeric" placeholder="reps" />
              <Pressable onPress={() => updateDraft({ sets: current.sets.filter((_, itemIndex) => itemIndex !== index) })} style={pressableFeedback(styles.iconButton)}>
                <Trash2 size={16} color={palette.danger} />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => updateDraft({ sets: [...current.sets, { weight: "", reps: "" }] })} style={pressableFeedback(styles.secondaryButton)}>
            <Plus size={17} color={palette.ink} />
            <Body style={styles.buttonText}>Add set</Body>
          </Pressable>
          <TextInput style={[styles.input, styles.notes]} value={current.notes} onChangeText={(notes) => updateDraft({ notes })} multiline placeholder="Notes" />
          {projectedPerformance ? <Body>Projected performance: {projectedPerformance.performancePoints.toFixed(1)} points | e1RM {formatWeight(projectedPerformance.estimated1RM, unitSystem)}</Body> : null}
        </Panel>
      ) : null}

      {error ? <Body style={styles.error}>{error}</Body> : null}
      <View style={styles.footerActions}>
        <Pressable disabled={saving} onPress={() => setConfirmEnd(true)} style={pressableFeedback(styles.endButton)}>
          <Body style={styles.buttonText}>End workout</Body>
        </Pressable>
        <Pressable disabled={saving || !selectedExercise} onPress={() => void completeCurrent(false)} style={pressableFeedback(styles.primaryButton)}>
          <Body style={styles.primaryText}>{saving ? "Saving..." : "Next exercise"}</Body>
        </Pressable>
      </View>

      <Modal visible={confirmEnd} transparent animationType="fade" onRequestClose={() => setConfirmEnd(false)}>
        <View style={styles.modalLayer}>
          <View style={styles.modalCard}>
            <View style={styles.summaryRow}>
              <SectionTitle>End workout?</SectionTitle>
              <Pressable onPress={() => setConfirmEnd(false)}><X size={20} color={palette.ink} /></Pressable>
            </View>
            <Body>{hasEnteredSets(current.sets) && selectedExercise ? "Your current exercise will be saved before finishing." : "Your completed exercises are already saved."}</Body>
            <View style={styles.actions}>
              <Pressable onPress={() => setConfirmEnd(false)} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Continue workout</Body>
              </Pressable>
              <Pressable disabled={saving} onPress={() => void completeCurrent(true)} style={pressableFeedback(styles.primaryButton)}>
                <Body style={styles.primaryText}>End workout</Body>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );

  function updateSet(index: number, field: keyof LoggedSetDraft, value: string) {
    updateDraft({ sets: current.sets.map((set, itemIndex) => itemIndex === index ? { ...set, [field]: value } : set) });
  }
}

function TimerDisplay({ startedAt, now }: { startedAt: string; now: number }) {
  return (
    <View style={styles.timer}>
      <Timer size={18} color={palette.accent} />
      <Body style={styles.timerText}>{formatElapsed(startedAt, now)}</Body>
    </View>
  );
}

function BarCalculator({ barWeight, plateCounts, loadedBarWeight, unitSystem, onBarWeight, onPlateCount, onApply, setCount }: {
  barWeight: string;
  plateCounts: Record<string, number>;
  loadedBarWeight: number;
  unitSystem: "lb" | "kg";
  onBarWeight: (value: string) => void;
  onPlateCount: (plate: PlateWeight, amount: number) => void;
  onApply: (index: number) => void;
  setCount: number;
}) {
  return (
    <View style={styles.barCalculator}>
      <View style={styles.summaryRow}>
        <View style={styles.flex}>
          <Label>Plate calculator</Label>
          <Body>Total load: {loadedBarWeight.toFixed(1).replace(".0", "")} lb</Body>
        </View>
        <Label>Bar</Label>
        <TextInput style={[styles.input, styles.barInput]} value={barWeight} onChangeText={onBarWeight} inputMode="decimal" placeholder="45" />
        <Body>lb</Body>
      </View>
      <View style={styles.loadedBar}>
        <View style={styles.plateStack}>{[...plateWeights].reverse().flatMap((plate) => Array.from({ length: Number(plateCounts[plate] ?? 0) }, (_, index) => <View key={`left-${plate}-${index}`} style={[styles.plate, plateVisuals[plate]]} />))}</View>
        <View style={styles.sleeve} /><View style={styles.shaft} /><View style={styles.sleeve} />
        <View style={[styles.plateStack, styles.rightPlates]}>{plateWeights.flatMap((plate) => Array.from({ length: Number(plateCounts[plate] ?? 0) }, (_, index) => <View key={`right-${plate}-${index}`} style={[styles.plate, plateVisuals[plate]]} />))}</View>
      </View>
      <View style={styles.chips}>
        {plateWeights.map((plate) => (
          <View key={plate} style={styles.plateControl}>
            <View style={[styles.swatch, { backgroundColor: plateVisuals[plate].backgroundColor }]} />
            <Body>{plate}</Body>
            <Pressable onPress={() => onPlateCount(plate, -1)} style={pressableFeedback(styles.countButton)}><Body>-</Body></Pressable>
            <Body>{plateCounts[plate] ?? 0}</Body>
            <Pressable onPress={() => onPlateCount(plate, 1)} style={pressableFeedback(styles.countButton)}><Body>+</Body></Pressable>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.actions}>
          {Array.from({ length: setCount }, (_, index) => (
            <Pressable key={index} onPress={() => onApply(index)} style={pressableFeedback(styles.secondaryButton)}>
              <Body style={styles.buttonText}>Use for set {index + 1} ({formatWeightInput(loadedBarWeight, unitSystem)})</Body>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function recommendationForSet(weight: number, reps: number, setNumber: number): WorkoutRecommendationRow {
  return {
    setNumber,
    weight,
    priorReps: reps,
    minimumReps: Math.min(10, reps + 1),
    maximumReps: Math.min(10, reps + 3),
    requiresLoadChange: reps >= 10
  };
}

function findLatestSets(exerciseId: number, sessions: Array<{ id: number; workout_date: string; created_at: string }>, sets: Array<{ session_id: number; exercise_id: number; set_number: number; reps: number; weight: number }>) {
  const relevantSessionIds = new Set(sets.filter((set) => set.exercise_id === exerciseId).map((set) => set.session_id));
  const latest = sessions
    .filter((session) => relevantSessionIds.has(session.id))
    .sort((a, b) => a.workout_date.localeCompare(b.workout_date) || a.created_at.localeCompare(b.created_at) || a.id - b.id)
    .at(-1);
  return latest ? sets.filter((set) => set.exercise_id === exerciseId && set.session_id === latest.id).sort((a, b) => a.set_number - b.set_number) : [];
}

function calculateLoadedBarWeight(barWeight: string, counts: Record<string, number>) {
  const parsed = Number(barWeight.trim().replace(",", "."));
  const bar = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  return bar + plateWeights.reduce((total, plate) => total + plate * Number(counts[plate] ?? 0) * 2, 0);
}

function loadInstruction(loadType: ExerciseLoadType, bodyWeight?: number) {
  const basis = bodyWeight ? `Body weight ${formatBodyWeight(bodyWeight)} is included.` : "Log body weight first to calculate performance.";
  return loadType === "bodyweight_plus_load" ? `Enter added weight only. ${basis}` : `Enter assistance weight. ${basis}`;
}

function loadChangeInstruction(loadType: ExerciseLoadType) {
  return loadType === "bodyweight_minus_assistance" ? "Choose less assistance" : "Choose a heavier load";
}

function loadPlaceholder(loadType: ExerciseLoadType, unitSystem: string) {
  if (loadType === "bodyweight_plus_load") return `added ${unitSystem}`;
  if (loadType === "bodyweight_minus_assistance") return `assist ${unitSystem}`;
  return unitSystem;
}

function hasEnteredSets(sets: LoggedSetDraft[]) {
  return sets.some((set) => set.weight.trim() || set.reps.trim());
}

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update the guided workout.";
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  flex: { flex: 1, gap: spacing.xs },
  timer: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.accentSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 12 },
  timerText: { color: palette.ink, fontWeight: "900", fontVariant: ["tabular-nums"] },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, minHeight: 40, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt },
  chipActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { color: palette.ink, fontWeight: "800" },
  chipTextActive: { color: palette.surface },
  prompt: { backgroundColor: palette.accentSoft, padding: spacing.md, borderRadius: 10, gap: spacing.sm },
  guidance: { backgroundColor: palette.surfaceAlt, borderRadius: 10, padding: spacing.md, gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  footerActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  primaryButton: { minHeight: 46, borderRadius: 9, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center", flexDirection: "row", paddingHorizontal: spacing.lg },
  primaryText: { color: palette.surface, fontWeight: "900" },
  secondaryButton: { minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md },
  endButton: { minHeight: 46, borderRadius: 9, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: palette.ink, fontWeight: "800" },
  setRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 8, backgroundColor: palette.surface, paddingHorizontal: spacing.sm, color: palette.ink, fontSize: 16 },
  setInput: { flex: 1 },
  notes: { minHeight: 72, textAlignVertical: "top", paddingTop: spacing.sm },
  iconButton: { width: 42, height: 42, borderRadius: 8, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  barCalculator: { backgroundColor: palette.surfaceAlt, borderRadius: 10, padding: spacing.md, gap: spacing.md },
  barInput: { width: 68 },
  loadedBar: { height: 62, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  plateStack: { flexDirection: "row", alignItems: "center", height: 62 },
  rightPlates: { flexDirection: "row-reverse" },
  plate: { borderRadius: 2, marginHorizontal: 1 },
  sleeve: { width: 14, height: 7, backgroundColor: palette.muted },
  shaft: { width: 98, height: 4, backgroundColor: palette.ink },
  plateControl: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: palette.border, borderRadius: 8, padding: spacing.xs },
  swatch: { width: 8, height: 20, borderRadius: 2 },
  countButton: { width: 26, height: 30, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderRadius: 6 },
  planRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm },
  error: { color: palette.danger, fontWeight: "800" },
  modalLayer: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 14, backgroundColor: palette.surface, padding: spacing.lg, gap: spacing.md }
});
