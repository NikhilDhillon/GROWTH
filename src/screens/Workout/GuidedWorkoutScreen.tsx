import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, ChevronRight, Plus, Timer, X } from "lucide-react-native";

import { MachineProfilePanel } from "@/components/MachineProfilePanel";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { SetComposerTarget, VisualSetComposer } from "@/components/VisualSetComposer";
import { activePlannedExerciseMuscles, emptyActiveExercise, exerciseMuscleToSplitMuscle, splitMuscleToExerciseMuscle } from "@/constants/activeWorkout";
import { ExerciseLoadType, getExerciseLoadType, isBodyweightLoadType, isMachineLoadType, supportsBarbellCalculator } from "@/constants/exercises";
import { guidedCategoryLabels } from "@/constants/guidedWorkout";
import { preferredMachineProfile, profileAppliesToExercise } from "@/constants/machineProfiles";
import { cloneTrainingSplitDays } from "@/constants/trainingSplit";
import { getClosestBodyweightForDate } from "@/services/analytics/bulkAnalyticsService";
import { buildGuidedRecommendation, buildGuidedSessionOutcome } from "@/services/guidedWorkout/guidedWorkoutService";
import { calculateSessionPerformance, findStrengthReference } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { ActiveWorkout, CompletedGuidedWorkout, Exercise, GuidedWorkoutPreferences, LoggedSetDraft, MachineProfile, MuscleGroup, SplitMuscle, TrainingSplitDay, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { muscles, palette, spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatBodyWeight, formatWeight, formatWeightInput, weightFromStorageUnit, weightToStorageUnit } from "@/utils/units";

const emptyPlateCounts = () => ({ 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 });

export function GuidedWorkoutScreen() {
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();

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

  return <ActiveGuidedWorkoutScreen activeWorkout={activeWorkout} />;
}

function ActiveGuidedWorkoutScreen({ activeWorkout }: { activeWorkout: ActiveWorkout }) {
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const machineProfiles = useFitnessStore((state) => state.machineProfiles);
  const trainingSplit = useFitnessStore((state) => state.trainingSplit);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const guidedWorkoutPreferences = useFitnessStore((state) => state.guidedWorkoutPreferences);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const saveMachineProfile = useFitnessStore((state) => state.saveMachineProfile);
  const deleteMachineProfile = useFitnessStore((state) => state.deleteMachineProfile);
  const saveTrainingSplit = useFitnessStore((state) => state.saveTrainingSplit);
  const updateActiveWorkout = useFitnessStore((state) => state.updateActiveWorkout);
  const finishActiveWorkout = useFitnessStore((state) => state.finishActiveWorkout);
  const [clock, setClock] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAlternateMuscles, setShowAlternateMuscles] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const workout = activeWorkout;
  const current = workout.currentExercise;
  const pendingMuscle = workout.pendingMuscle;
  const chooseReplace = workout.schedulePrompt === "replace";
  const selectedExercise = exercises.find((exercise) => exercise.id === current.exerciseId) ?? null;
  const visibleExercises = current.muscle ? exercises.filter((exercise) => exercise.primary_muscle === current.muscle) : [];
  const plannedMuscles = activePlannedExerciseMuscles(workout);
  const displayedMuscles = showAlternateMuscles
    ? muscles
    : [...plannedMuscles, ...(current.muscle && !plannedMuscles.includes(current.muscle) ? [current.muscle] : [])];
  const loadType = getExerciseLoadType(selectedExercise?.name ?? "");
  const selectedBodyWeight = isBodyweightLoadType(loadType) ? getClosestBodyweightForDate(workout.workoutDate, bodyWeightLogs) : null;
  const selectedMachineProfile = machineProfiles.find((profile) => profile.id === current.machineProfileId) ?? null;
  const lastMachineLoad = selectedExercise && isMachineLoadType(loadType)
    ? latestMachineLoadForExercise({
        exerciseId: selectedExercise.id,
        machineProfileId: current.machineProfileId,
        profile: selectedMachineProfile,
        sessions,
        sets,
        unitSystem
      })
    : null;
  const recommendation = useMemo(() => selectedExercise ? buildGuidedRecommendation({
    exercise: selectedExercise,
    preferences: guidedWorkoutPreferences,
    sessions,
    sets,
    workoutDate: workout.workoutDate,
    draftWarmups: current.sets.map((set) => Boolean(set.isWarmup)),
    machineProfileId: isMachineLoadType(loadType) ? current.machineProfileId : null,
    machineScoped: isMachineLoadType(loadType)
  }) : null, [current.machineProfileId, current.sets, guidedWorkoutPreferences, loadType, selectedExercise, sessions, sets, workout.workoutDate]);
  const previousLogScope = isMachineLoadType(loadType)
    ? selectedMachineProfile
      ? ` for ${selectedMachineProfile.label}`
      : " for the selected machine tag"
    : "";
  const composerTargets = useMemo<SetComposerTarget[]>(() => {
    return recommendation?.targets.map((target) => ({
      draftIndex: target.draftIndex,
      weight: target.priorWeight,
      targetReps: target.targetReps,
      label: setRoleLabel(target.role, target.workingSetNumber),
      increaseWeight: target.increaseWeight
    })) ?? [];
  }, [recommendation]);
  const bestPerformance = selectedExercise ? findStrengthReference(exercisePoints.filter((point) => point.exerciseId === selectedExercise.id)) : undefined;
  const projectedPerformance = selectedExercise
    ? calculateSessionPerformance(
        current.sets
          .filter((set) => !set.isWarmup)
          .map((set, index) => ({ reps: Number(set.reps), weight: weightToStorageUnit(Number(set.weight), unitSystem), set_number: index + 1 }))
          .filter((set) => set.reps > 0 || set.weight > 0),
        bestPerformance,
        { loadType, bodyWeight: selectedBodyWeight?.weight }
      )
    : null;
  const sourceDay = trainingSplit.days.find((day) => day.key === workout.sourceDayKey);

  function persist(updater: (workout: ActiveWorkout) => ActiveWorkout) {
    void updateActiveWorkout(updater(workout)).catch((caught) => setError(errorMessage(caught)));
  }

  function updateDraft(patch: Partial<ActiveWorkout["currentExercise"]>) {
    persist((workout) => ({ ...workout, currentExercise: { ...workout.currentExercise, ...patch } }));
  }

  function selectMuscle(muscle: MuscleGroup) {
    if (plannedMuscles.includes(muscle)) {
      setShowAlternateMuscles(false);
      persist((active) => ({ ...active, pendingMuscle: null, schedulePrompt: null, currentExercise: { ...active.currentExercise, muscle, exerciseId: null, machineProfileId: null } }));
      return;
    }
    persist((active) => ({ ...active, pendingMuscle: muscle, schedulePrompt: "off_plan" }));
  }

  function useOffPlanMuscleForWorkout() {
    if (!pendingMuscle) return;
    setShowAlternateMuscles(false);
    persist((active) => ({ ...active, pendingMuscle: null, schedulePrompt: null, currentExercise: { ...active.currentExercise, muscle: pendingMuscle, exerciseId: null, machineProfileId: null } }));
  }

  async function addOffPlanMuscle() {
    if (!pendingMuscle) return;
    const splitMuscle = exerciseMuscleToSplitMuscle(pendingMuscle);
    const days = cloneTrainingSplitDays(trainingSplit.days);
    const today = days.find((day) => day.key === workout.todayDayKey);
    if (today && !today.muscles.includes(splitMuscle)) today.muscles.push(splitMuscle);
    await saveScheduleAndSelect(days, pendingMuscle, `${splitMuscle} was added to today's weekly split.`);
  }

  async function replacePlannedMuscle(replaced: SplitMuscle) {
    if (!pendingMuscle) return;
    const days = cloneTrainingSplitDays(trainingSplit.days);
    const today = days.find((day) => day.key === workout.todayDayKey);
    if (today) {
      const position = today.muscles.indexOf(replaced);
      if (position >= 0) today.muscles[position] = exerciseMuscleToSplitMuscle(pendingMuscle);
    }
    await saveScheduleAndSelect(days, pendingMuscle, `${replaced} was replaced with ${exerciseMuscleToSplitMuscle(pendingMuscle)} in today's weekly split.`);
  }

  async function saveScheduleAndSelect(days: TrainingSplitDay[], muscle: MuscleGroup, scheduleChange: string) {
    try {
      await saveTrainingSplit(days);
      setShowAlternateMuscles(false);
      persist((workout) => ({
        ...workout,
        plannedMuscles: [...(days.find((day) => day.key === workout.todayDayKey)?.muscles ?? workout.plannedMuscles)],
        currentExercise: { ...workout.currentExercise, muscle, exerciseId: null, machineProfileId: null },
        pendingMuscle: null,
        schedulePrompt: null,
        scheduleChanges: [...workout.scheduleChanges, scheduleChange]
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
        schedulePrompt: null,
        scheduleChanges: saveSwap
          ? [...workout.scheduleChanges, `Today's rest day was swapped with ${day.label}.`]
          : workout.scheduleChanges
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
        machineProfileId: isMachineLoadType(loadType) ? current.machineProfileId : null,
        sets: current.sets
      });
      const savedState = useFitnessStore.getState();
      const sessionId = savedState.sessions
        .filter((session) => session.workout_date === workout.workoutDate)
        .filter((session) => savedState.sets.some((set) => set.session_id === session.id && set.exercise_id === selectedExercise.id))
        .sort((left, right) => left.id - right.id)
        .at(-1)?.id;
      const completedExercise = {
        exerciseId: selectedExercise.id,
        sessionId,
        machineProfileId: isMachineLoadType(loadType) ? current.machineProfileId : null,
        machineProfileLabel: isMachineLoadType(loadType) ? selectedMachineProfile?.label ?? null : null,
        exerciseName: selectedExercise.name,
        muscle: selectedExercise.primary_muscle,
        sets: current.sets,
        completedAt: new Date().toISOString(),
        guidedOutcome: buildGuidedSessionOutcome({
          exercise: selectedExercise,
          preferences: guidedWorkoutPreferences,
          recommendation,
          sets: current.sets
        })
      };
      if (endAfterSave) {
        await finish({ ...workout, completedExercises: [...workout.completedExercises, completedExercise] });
        return;
      }
      await updateActiveWorkout({
        ...workout,
        completedExercises: [...workout.completedExercises, completedExercise],
        currentExercise: emptyActiveExercise()
      });
      setShowAlternateMuscles(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function finish(completedWorkout = workout) {
    if (!completedWorkout.completedExercises.length) {
      await finishActiveWorkout();
      setConfirmEnd(false);
      navigation.navigate("Home");
      return;
    }
    const finishedAt = new Date().toISOString();
    const summary: CompletedGuidedWorkout = {
      ...completedWorkout,
      id: `${completedWorkout.startedAt}-${finishedAt}`,
      finishedAt
    };
    await finishActiveWorkout(summary);
    setConfirmEnd(false);
    navigation.navigate("WorkoutSummary", { workout: summary, finishedAt });
  }

  if (!activeWorkout.plannedMuscles.length) {
    return (
      <Screen>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
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
        <View style={styles.titleCopy}>
          <Label>Guided workout</Label>
          <Title>{activeWorkout.workoutLabel ?? sourceDay?.label ?? "Today's"} training</Title>
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
          <Body>{exercise.sets.filter((set) => set.reps || set.weight).map((set) => `${set.isWarmup ? "Warm-up: " : ""}${set.weight} ${unitSystem} x ${set.reps}`).join(" | ")}</Body>
          {exercise.machineProfileLabel ? <Label>{exercise.machineProfileLabel}</Label> : null}
        </Panel>
      ))}

      <Panel>
        <SectionTitle>Exercise {activeWorkout.completedExercises.length + 1}</SectionTitle>
        <Body>Choose one of this workout's muscle groups for your current exercise.</Body>
        <View style={styles.chips}>
          {displayedMuscles.map((muscle) => (
            <Pressable key={muscle} onPress={() => selectMuscle(muscle)} style={pressableFeedback([styles.chip, current.muscle === muscle && styles.chipActive])}>
              <Body style={[styles.chipText, current.muscle === muscle && styles.chipTextActive]}>{muscle === "Core" ? "Abs" : muscle}</Body>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setShowAlternateMuscles((visible) => !visible)} style={pressableFeedback(styles.secondaryButton)}>
          <Plus size={17} color={palette.ink} />
          <Body style={styles.buttonText}>{showAlternateMuscles ? "Hide other muscle groups" : "Add another muscle"}</Body>
        </Pressable>
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
                <Pressable key={exercise.id} onPress={() => chooseExercise(exercise.id)} style={pressableFeedback([styles.chip, current.exerciseId === exercise.id && styles.chipActive])}>
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
              <Label>{recommendation ? guidedCategoryLabels[recommendation.category] : ""}</Label>
              <Body>{bestPerformance ? `Best e1RM ${formatWeight(bestPerformance.estimated1RM, unitSystem)} | ${bestPerformance.performancePoints.toFixed(1)} points` : "No best performance yet."}</Body>
            </View>
          </View>

          <View style={styles.guidance}>
            <Label>Guided target</Label>
            {recommendation?.category === "unguided" ? (
              <Body>No rep or load guidance for pull-ups and dips. Use your last session as reference.</Body>
            ) : (
              <>
                {recommendation?.inactive ? <Body>More than {guidedWorkoutPreferences.inactivityDays} days since this exercise. Repeat conservatively; weight increases are paused today.</Body> : null}
                {recommendation?.targets.map((row) => (
                  <Body key={row.draftIndex}>
                    {setRoleLabel(row.role, row.workingSetNumber)}: {row.increaseWeight && row.priorWeight !== undefined
                      ? `${loadChangeInstruction(loadType)} from ${formatWeight(row.priorWeight, unitSystem)}. No prescribed reps for the first heavier attempt.`
                      : row.priorWeight !== undefined
                        ? `${formatWeight(row.priorWeight, unitSystem)} x ${row.targetReps} reps.`
                        : `${row.targetReps} reps${row.role === "backoff" ? `, starting near ${guidedWorkoutPreferences.backoffPercentage}% of the top-set load` : ""}.`}
                  </Body>
                ))}
                {!recommendation?.latest ? <Body>No previous working sets logged{previousLogScope} yet.</Body> : null}
              </>
            )}
            {recommendation?.latest ? <Body>Most recent log{previousLogScope} ({recommendation.latest.date}): {formatSessionSets(recommendation.latest.sets, unitSystem)}</Body> : null}
            {recommendation?.category === "top_set" ? (
              <>
                {recommendation.topSetBest ? <Body>Best top set ({recommendation.topSetBest.date}): {formatSessionSets(recommendation.topSetBest.sets.slice(0, 1), unitSystem)}</Body> : null}
                {recommendation.backoffBest ? <Body>Best back-off block ({recommendation.backoffBest.date}): {formatSessionSets(recommendation.backoffBest.sets.slice(1), unitSystem)}</Body> : null}
              </>
            ) : recommendation?.best ? <Body>Best completed target ({recommendation.best.date}): {formatSessionSets(recommendation.best.sets, unitSystem)}</Body> : null}
          </View>

          {isBodyweightLoadType(loadType) ? (
            <Body>{loadInstruction(loadType, selectedBodyWeight?.weight)}</Body>
          ) : null}

          {isMachineLoadType(loadType) ? (
            <MachineProfilePanel
              profiles={machineProfiles}
              selectedProfileId={current.machineProfileId}
              exerciseId={selectedExercise.id}
              exerciseName={selectedExercise.name}
              unitSystem={unitSystem}
              lastLoad={lastMachineLoad}
              onSelectProfile={(machineProfileId) => updateDraft({ machineProfileId })}
              onSaveProfile={saveMachineProfile}
              onDeleteProfile={deleteMachineProfile}
            />
          ) : null}

          <VisualSetComposer
            sets={current.sets}
            loadType={loadType}
            unitSystem={unitSystem}
            supportsBarbell={supportsBarbellCalculator(selectedExercise.name)}
            barWeight={current.barWeight}
            plateCounts={current.plateCounts}
            targets={composerTargets}
            onBarWeightChange={(barWeight) => updateDraft({ barWeight })}
            onPlateCountsChange={(plateCounts) => updateDraft({ plateCounts })}
            onSetsChange={(sets) => updateDraft({ sets })}
          />
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
            <Body>{hasEnteredSets(current.sets) && selectedExercise
              ? "You have entered sets for the current exercise. Save them in this workout or discard them before finishing."
              : activeWorkout.completedExercises.length
                ? "Your completed exercises are saved. Finish to view your session summary."
                : "No exercises have been completed. Finishing now will discard this empty workout."}</Body>
            <View style={styles.actions}>
              <Pressable onPress={() => setConfirmEnd(false)} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Continue workout</Body>
              </Pressable>
              {hasEnteredSets(current.sets) && selectedExercise ? (
                <>
                  <Pressable disabled={saving} onPress={() => void finish()} style={pressableFeedback(styles.secondaryButton)}>
                    <Body style={styles.buttonText}>Discard current & finish</Body>
                  </Pressable>
                  <Pressable disabled={saving} onPress={() => void completeCurrent(true)} style={pressableFeedback(styles.primaryButton)}>
                    <Body style={styles.primaryText}>Save current & finish</Body>
                  </Pressable>
                </>
              ) : (
                <Pressable disabled={saving} onPress={() => void finish()} style={pressableFeedback(styles.primaryButton)}>
                  <Body style={styles.primaryText}>{activeWorkout.completedExercises.length ? "Finish workout" : "Discard workout"}</Body>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );

  function chooseExercise(exerciseId: number) {
    const exercise = exercises.find((item) => item.id === exerciseId);
    const nextLoadType = getExerciseLoadType(exercise?.name ?? "");
    const currentProfile = machineProfiles.find((profile) => profile.id === current.machineProfileId) ?? null;
    const machineProfileId = exercise && isMachineLoadType(nextLoadType)
      ? profileAppliesToExercise(currentProfile, exercise.id)
        ? currentProfile?.id ?? null
        : preferredMachineProfile(machineProfiles, exercise.id)?.id ?? null
      : null;
    updateDraft({
      exerciseId,
      machineProfileId,
      sets: exercise ? buildSmartGuidedSets({
        exercise,
        preferences: guidedWorkoutPreferences,
        sessions,
        sets,
        workoutDate: workout.workoutDate,
        machineProfileId: isMachineLoadType(nextLoadType) ? machineProfileId : null,
        machineScoped: isMachineLoadType(nextLoadType),
        unitSystem
      }) : current.sets,
      barWeight: "45",
      plateCounts: emptyPlateCounts()
    });
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

function buildSmartGuidedSets(input: {
  exercise: Exercise;
  preferences: GuidedWorkoutPreferences;
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  workoutDate: string;
  machineProfileId?: string | null;
  machineScoped?: boolean;
  unitSystem: UnitSystem;
}): LoggedSetDraft[] {
  const baseSets: LoggedSetDraft[] = [{ reps: "", weight: "" }, { reps: "", weight: "" }, { reps: "", weight: "" }];
  const recommendation = buildGuidedRecommendation({
    exercise: input.exercise,
    preferences: input.preferences,
    sessions: input.sessions,
    sets: input.sets,
    workoutDate: input.workoutDate,
    draftWarmups: baseSets.map((set) => Boolean(set.isWarmup)),
    machineProfileId: input.machineProfileId,
    machineScoped: input.machineScoped
  });
  const targetCount = Math.max(3, recommendation.targets.reduce((max, target) => Math.max(max, target.draftIndex + 1), 0), recommendation.latest?.sets.length ?? 0);
  const nextSets = Array.from({ length: targetCount }, (): LoggedSetDraft => ({ reps: "", weight: "" }));

  if (recommendation.category === "unguided" && recommendation.latest?.sets.length) {
    return recommendation.latest.sets.map((set) => ({
      reps: String(set.reps),
      weight: formatWeightInput(set.weight, input.unitSystem),
      isWarmup: Boolean(set.is_warmup)
    }));
  }

  for (const target of recommendation.targets) {
    const targetReps = Number(target.targetReps);
    if (Number.isInteger(targetReps) && targetReps > 0) {
      nextSets[target.draftIndex] = {
        ...nextSets[target.draftIndex],
        reps: String(targetReps)
      };
    }
    if (target.increaseWeight) continue;
    const sourceWeight = target.priorWeight ?? recommendation.latest?.sets[target.workingSetNumber - 1]?.weight;
    if (Number.isFinite(sourceWeight)) {
      nextSets[target.draftIndex] = {
        ...nextSets[target.draftIndex],
        weight: formatWeightInput(Number(sourceWeight), input.unitSystem)
      };
    }
  }

  return nextSets;
}

function loadInstruction(loadType: ExerciseLoadType, bodyWeight?: number) {
  const basis = bodyWeight ? `Body weight ${formatBodyWeight(bodyWeight)} is included.` : "Log body weight first to calculate performance.";
  return loadType === "bodyweight_plus_load" ? `Enter added weight only. ${basis}` : `Enter assistance weight. ${basis}`;
}

function loadChangeInstruction(loadType: ExerciseLoadType) {
  return loadType === "bodyweight_minus_assistance" ? "Choose less assistance" : "Choose a heavier load";
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

function setRoleLabel(role: "working" | "top_set" | "backoff", number: number) {
  if (role === "top_set") return "Top set";
  if (role === "backoff") return `Back-off set ${number - 1}`;
  return `Set ${number}`;
}

function formatSessionSets(sets: Array<{ weight: number; reps: number }>, unitSystem: "lb" | "kg") {
  return sets.map((set) => `${formatWeight(set.weight, unitSystem)} x ${set.reps}`).join(" | ");
}

function latestMachineLoadForExercise(input: {
  exerciseId: number;
  machineProfileId?: string | null;
  profile: MachineProfile | null;
  sessions: Array<{ id: number; workout_date: string; machine_profile_id?: string | null }>;
  sets: Array<{ exercise_id: number; session_id: number; weight: number; set_number: number; created_at: string; is_warmup?: number | boolean | null }>;
  unitSystem: "lb" | "kg";
}) {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const matching = input.sets
    .filter((set) => set.exercise_id === input.exerciseId && !set.is_warmup)
    .filter((set) => Boolean(input.machineProfileId) && sessionById.get(set.session_id)?.machine_profile_id === input.machineProfileId)
    .sort((left, right) => {
      const leftDate = sessionById.get(left.session_id)?.workout_date ?? left.created_at.slice(0, 10);
      const rightDate = sessionById.get(right.session_id)?.workout_date ?? right.created_at.slice(0, 10);
      return leftDate.localeCompare(rightDate) || left.session_id - right.session_id || left.set_number - right.set_number;
    });
  const weight = matching.at(-1)?.weight;
  if (!Number.isFinite(weight)) return null;
  if (input.profile?.stackUnit === "kg") return Number((Number(weight) / 2.2046226218).toFixed(1));
  if (input.profile?.stackUnit === "plate") return Number(weightFromStorageUnit(Number(weight), input.unitSystem).toFixed(1));
  return Number(Number(weight).toFixed(1));
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  titleCopy: { flex: 1, minWidth: 0 },
  flex: { flex: 1, gap: spacing.xs },
  timer: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.accentSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 12 },
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
  setRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, width: "100%", minWidth: 0 },
  setNumber: { width: 18, textAlign: "center", flexShrink: 0 },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 8, backgroundColor: palette.surface, paddingHorizontal: spacing.sm, color: palette.ink, fontSize: 16 },
  setInput: { flex: 1, flexBasis: 0, minWidth: 0 },
  setKindButton: { minHeight: 42, flexShrink: 0, borderRadius: 8, borderWidth: 1, borderColor: palette.border, justifyContent: "center", paddingHorizontal: spacing.xs },
  setKindButtonActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  setKindText: { color: palette.ink, fontWeight: "800", fontSize: 11 },
  setKindTextActive: { color: palette.accent },
  notes: { minHeight: 72, textAlignVertical: "top", paddingTop: spacing.sm },
  iconButton: { width: 42, height: 42, flexShrink: 0, borderRadius: 8, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  barCalculator: { backgroundColor: palette.surfaceAlt, borderRadius: 10, padding: spacing.md, gap: spacing.md },
  calculatorInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  resetButton: { minHeight: 38, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: "center", paddingHorizontal: spacing.md },
  barInput: { width: 68 },
  loadedBar: { height: 62, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  plateStack: { flexDirection: "row", alignItems: "center", height: 62 },
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
