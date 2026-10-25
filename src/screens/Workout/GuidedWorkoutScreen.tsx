import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, ChevronDown, ChevronRight, Plus, Search, Timer, X } from "lucide-react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { matchingExercises, SearchableExercisePicker } from "@/components/SearchableExercisePicker";
import { NewExerciseForm } from "@/components/NewExerciseForm";
import { MachineProfilePanel } from "@/components/MachineProfilePanel";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { SetComposerTarget, VisualSetComposer } from "@/components/VisualSetComposer";
import { FlowSetLogger } from "@/components/FlowSetLogger";
import { FocusShell } from "@/components/FocusShell";
import { emptyActiveExercise, splitMuscleToExerciseMuscle } from "@/constants/activeWorkout";
import { ExerciseLoadType, getExerciseLoadType, isBodyweightLoadType, isMachineLoadType, supportsBarbellCalculator } from "@/constants/exercises";
import { guidedCategoryLabels, restLimits } from "@/constants/guidedWorkout";
import { preferredMachineProfile, profileAppliesToExercise } from "@/constants/machineProfiles";
import { WorkoutValidationError } from "@/database/workoutWrite";
import { isCalendarDate } from "@/domain/calendar";
import type { RecoveredWorkoutDraft } from "@/domain/workoutLifecycle";
import { resolveWorkoutSummary } from "@/domain/workoutHistory";
import { getBodyweightEstimateForDate, getClosestBodyweightForDate } from "@/services/body/bodyWeightService";
import { bodyweightLookupMessage } from "@/services/workouts/recordingContext";
import { buildGuidedPrescription, buildGuidedRecommendation } from "@/services/guidedWorkout/guidedWorkoutService";
import { assertGuidedObservationsConfirmed, buildUnconfirmedGuidedSets, canConfirmGuidedObservation, confirmGuidedObservation, GuidedCommitAttempt, isGuidedObservationConfirmed, sameGuidedExerciseDraft, sameGuidedSetValues } from "@/services/guidedWorkout/guidedObservationService";
import { calculateSessionPerformance, findStrengthReference, performanceHistoryForContext } from "@/services/strength/strengthService";
import { existingExerciseNamed } from "@/services/workouts/customExercises";
import { finalizeSetCapture, flowCapturedSet, isLoggedSet, plannedSuggestion, stampSetCapture } from "@/services/workouts/setCapture";
import { expectedReps, flowHistoryForRow, nextFlowRow, plannedFlowLoad } from "@/services/workouts/setPrediction";
import { flowLoadGhost } from "@/services/workouts/loadGhost";
import { clearRestAlert, showRestAlert } from "@/services/workouts/restAlerts";
import { learnedTemplateExercises, sameTemplateExercises, templateExerciseKey } from "@/services/workouts/templateExercises";
import { appendWorkoutSlot, removeWorkoutSlot, slotForChosenExercise, workoutSlotProgress } from "@/services/workouts/workoutSlots";
import { useFitnessStore } from "@/store/useFitnessStore";
import { ActiveWorkout, ActiveWorkoutExerciseDraft, CompletedGuidedWorkout, Exercise, LoggedSetDraft, MachineProfile, UnitSystem, WorkoutRest, WorkoutSession, WorkoutSet, WorkoutSlot } from "@/types";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatBodyWeight, formatWeight, formatWeightInput, weightFromStorageUnit, weightToStorageUnit } from "@/utils/units";
import { createEmptyPlateCounts, formatElapsedWorkoutTime } from "@/utils/workout";
import { createRequestId } from "@/utils/requestId";

const planBuilderSuggestions = 12;

/** Flow mode: the same workout as a full-screen, one-set-at-a-time flow with no app chrome. */
export function FlowWorkoutScreen() {
  return <GuidedWorkoutScreen focus />;
}

export function GuidedWorkoutScreen({ focus = false }: { focus?: boolean } = {}) {
  const { palette, styles } = useStyles();
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const exercises = useFitnessStore((state) => state.exercises);
  const recoveredDrafts = useFitnessStore((state) => state.recoveredWorkoutDrafts);
  const conflict = useFitnessStore((state) => state.activeDraftConflict);
  const reloadSavedDraft = useFitnessStore((state) => state.reloadSavedWorkoutDraft);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();

  if (!activeWorkout && focus) {
    return (
      <FocusShell startedAt={new Date().toISOString()} now={Date.now()} onClose={() => navigation.navigate("Home")} closeLabel="Return home" stepKey="none">
        <View style={styles.focusCenter}>
          <SectionTitle>No workout in progress</SectionTitle>
          <Body style={styles.focusMeta}>Start one from Home.</Body>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Home")} style={pressableFeedback(styles.primaryButton)}>
            <Body style={styles.primaryText}>Return home</Body>
          </Pressable>
        </View>
      </FocusShell>
    );
  }

  if (!activeWorkout) {
    return (
      <Screen>
        {draftRecoveryPanels(exercises, recoveredDrafts ?? [], conflict, () => void reloadSavedDraft().catch((caught) => setRecoveryError(errorMessage(caught))), styles)}
        {recoveryError ? <Body style={styles.error}>{recoveryError}</Body> : null}
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

  return <ActiveGuidedWorkoutScreen activeWorkout={activeWorkout} focus={focus} />;
}

function draftRecoveryPanels(exercises: Exercise[], drafts: RecoveredWorkoutDraft[], conflict: boolean, reload: () => void, styles: ReturnType<typeof useStyles>["styles"]) {
  return <>
    {conflict ? <Panel>
      <SectionTitle>Workout draft conflict</SectionTitle>
      <Body>A newer version is saved. Your entered values are kept below for recovery.</Body>
      <Pressable onPress={reload} style={pressableFeedback(styles.secondaryButton)}><Body style={styles.buttonText}>Reload saved draft</Body></Pressable>
    </Panel> : null}
    {drafts.map((recovery) => <Panel key={recovery.id}>
      <SectionTitle>Recovered draft</SectionTitle>
      <Body>{recovery.draft.workoutDate} · {exercises.find((item) => item.id === recovery.draft.currentExercise.exerciseId)?.name ?? "Unresolved exercise"}</Body>
      {recovery.draft.currentExercise.sets.map((set, index) => <Body key={index}>
        {`Set ${index + 1}: ${set.weight || "—"} ${recovery.draft.currentExercise.requestUnit ?? "(unit unrecorded)"} × ${set.reps || "—"}`}
      </Body>)}
      {recovery.draft.currentExercise.notes ? <Body>{recovery.draft.currentExercise.notes}</Body> : null}
    </Panel>)}
  </>;
}

function ActiveGuidedWorkoutScreen({ activeWorkout, focus }: { activeWorkout: ActiveWorkout; focus: boolean }) {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const completedGuidedWorkouts = useFitnessStore((state) => state.completedGuidedWorkouts);
  const workoutArchiveEvidence = useFitnessStore((state) => state.workoutArchiveEvidence);
  const workoutRecords = useFitnessStore((state) => state.workoutRecords);
  const workoutReferences = useFitnessStore((state) => state.workoutReferences);
  const draftConflict = useFitnessStore((state) => state.activeDraftConflict);
  const recoveredDrafts = useFitnessStore((state) => state.recoveredWorkoutDrafts);
  const reloadSavedDraft = useFitnessStore((state) => state.reloadSavedWorkoutDraft);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const bodyWeightUnit = useFitnessStore((state) => state.bodyUnitPreferences.weight);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const machineProfiles = useFitnessStore((state) => state.machineProfiles);
  const preferredUnitSystem = useFitnessStore((state) => state.unitSystem);
  const guidedWorkoutPreferences = useFitnessStore((state) => state.guidedWorkoutPreferences);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const saveMachineProfile = useFitnessStore((state) => state.saveMachineProfile);
  const deleteMachineProfile = useFitnessStore((state) => state.deleteMachineProfile);
  const updateActiveWorkout = useFitnessStore((state) => state.updateActiveWorkout);
  const finishActiveWorkout = useFitnessStore((state) => state.finishActiveWorkout);
  const activeWorkoutFinalizing = useFitnessStore((state) => state.activeWorkoutFinalizing);
  const saveTemplateExercises = useFitnessStore((state) => state.saveTemplateExercises);
  const createCustomExercise = useFitnessStore((state) => state.createCustomExercise);
  const [clock, setClock] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const recordingLocked = saving || activeWorkoutFinalizing || draftConflict;
  const [showCompleted, setShowCompleted] = useState(false);
  const [addingSlot, setAddingSlot] = useState(false);
  const [planPicks, setPlanPicks] = useState<number[]>([]);
  const [planQuery, setPlanQuery] = useState("");
  const [planCreating, setPlanCreating] = useState(false);
  const [flowValues, setFlowValues] = useState<{ key: string; weight: number; reps: number } | null>(null);
  const [focusMenu, setFocusMenu] = useState(false);
  const [exerciseSheet, setExerciseSheet] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<{ exercise: string; row: number } | null>(null);
  const autoSaved = useRef<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const workout = activeWorkout;
  const recorded = useMemo(() => resolveWorkoutSummary({
    sessions, sets, exercises, activeWorkout, completedGuidedWorkouts, workoutArchiveEvidence, workoutRecords, workoutReferences
  }, activeWorkout), [sessions, sets, exercises, activeWorkout, completedGuidedWorkouts, workoutArchiveEvidence, workoutRecords, workoutReferences]);
  const current = workout.currentExercise;
  const unitSystem = current.requestUnit ?? preferredUnitSystem;
  const pendingSave = Boolean(current.requestId);
  const selectedExercise = exercises.find((exercise) => exercise.id === current.exerciseId) ?? null;
  const loadType = getExerciseLoadType(selectedExercise ?? "");
  const observationContext = selectedExercise ? {
    exerciseId: selectedExercise.id,
    workoutDate: workout.workoutDate,
    machineProfileId: isMachineLoadType(loadType) ? current.machineProfileId : null,
    unitSystem
  } : undefined;
  const confirmationReviewNeeded = pendingSave && (!current.requestUnit || !observationContext
    || current.sets.some((set) => (set.reps.trim() || set.weight.trim()) && !isGuidedObservationConfirmed(set, observationContext)));
  const displayedSets = pendingSave && !current.requestUnit
    ? current.sets.map((set) => ({ ...set, observationConfirmation: undefined }))
    : current.sets;
  const selectedBodyWeight = isBodyweightLoadType(loadType) ? getClosestBodyweightForDate(workout.workoutDate, bodyWeightLogs) : null;
  const selectedMachineProfile = machineProfiles.find((profile) => profile.id === current.machineProfileId) ?? null;
  const lastMachineLoad = selectedExercise && isMachineLoadType(loadType)
    ? latestMachineLoadForExercise({
        exerciseId: selectedExercise.id,
        machineProfileId: current.machineProfileId,
        profile: selectedMachineProfile,
        sessions,
        sets,
        asOfDate: workout.workoutDate,
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
    if (current.prescription) {
      const workingIndexes = current.sets.map((set, index) => set.isWarmup ? -1 : index).filter((index) => index >= 0);
      return current.prescription.sets.filter((target) => !target.isWarmup).map((target) => ({
        draftIndex: workingIndexes[target.setNumber - 1] ?? current.sets.length + target.setNumber - workingIndexes.length - 1,
        weight: target.targetLoadLb ?? undefined, targetReps: target.targetReps?.minimum,
        label: current.prescription!.category === "top_set" ? target.setNumber === 1 ? "Top set" : `Back-off set ${target.setNumber - 1}` : `Set ${target.setNumber}`,
        increaseWeight: target.targetLoadLb === null && target.targetReps === null
      }));
    }
    return recommendation?.targets.map((target) => ({ draftIndex: target.draftIndex, weight: target.priorWeight,
      targetReps: target.targetReps, label: setRoleLabel(target.role, target.workingSetNumber), increaseWeight: target.increaseWeight })) ?? [];
  }, [recommendation, current.prescription, current.sets]);
  const bestPerformance = selectedExercise ? findStrengthReference(performanceHistoryForContext(exercisePoints, { exerciseId: selectedExercise.id, asOfDate: workout.workoutDate, loadType, machineProfileId: current.machineProfileId, sessions })) : undefined;
  const projectedPerformance = selectedExercise
    ? calculateSessionPerformance(
        current.sets
          // In flow mode only confirmed sets count; the rest are still suggestions.
          .filter((set) => !set.isWarmup && (!focus || isLoggedSet(set)))
          .map((set, index) => ({ reps: Number(set.reps), weight: weightToStorageUnit(Number(set.weight), unitSystem), set_number: index + 1 }))
          .filter((set) => set.reps > 0 || set.weight > 0),
        bestPerformance,
        { loadType, bodyWeight: selectedBodyWeight?.weight }
      )
    : null;
  const progress = useMemo(() => workoutSlotProgress(workout), [workout]);
  const doneCount = progress.filter((item) => item.status === "done").length;
  const currentIndex = progress.findIndex((item) => item.status === "current");
  const currentPosition = currentIndex >= 0 ? currentIndex + 1 : Math.max(doneCount, activeWorkout.completedExercises.length) + 1;
  const nextSlot = progress.find((item) => item.status === "pending")?.slot ?? null;
  const nextSlotName = nextSlot ? exercises.find((exercise) => exercise.id === nextSlot.exerciseId)?.name ?? null : null;
  const suggested = suggestedExercises(exercises, activeWorkout.plannedMuscles, activeWorkout.completedExercises.map((entry) => entry.exerciseId), sessions, sets);
  const needsPlan = !workout.slots?.length && !workout.completedExercises.length && !current.exerciseId;
  const planSearching = Boolean(planQuery.trim());
  const planMatches = planSearching ? matchingExercises(exercises, planQuery) : [];
  const planSuggestions = suggested.slice(0, planBuilderSuggestions);
  const planCanCreate = planSearching && !existingExerciseNamed(exercises, planQuery);
  const newExerciseMuscle = activeWorkout.plannedMuscles.length ? splitMuscleToExerciseMuscle(activeWorkout.plannedMuscles[0]) : null;
  // A pick found by search stays on the list once the search is cleared.
  const planChoices = planSearching ? planMatches.slice(0, planBuilderSuggestions) : [
    ...planSuggestions,
    ...planPicks.filter((id) => !planSuggestions.some((exercise) => exercise.id === id)).flatMap((id) => exercises.filter((exercise) => exercise.id === id))
  ];
  const flowMode = focus;
  const flowRow = flowMode && selectedExercise && !pendingSave ? nextFlowRow(current.sets) : null;
  const flowStep = flowLoadStep(unitSystem, isMachineLoadType(loadType) ? selectedMachineProfile : null);
  /** Where the dial starts for the next row: its planned load and the reps you will probably get. */
  const flowPrediction = useMemo(() => {
    if (flowRow === null || !selectedExercise) return null;
    const previousWorking = (recommendation?.latest?.sets ?? []).map((set) => ({ reps: set.reps, load: Number(formatWeightInput(set.weight, unitSystem)) }));
    const target = composerTargets.find((item) => item.draftIndex === flowRow);
    const workingOrdinal = current.sets.slice(0, flowRow).filter((set) => !set.isWarmup).length;
    const fallback = target?.weight !== undefined ? Number(formatWeightInput(target.weight, unitSystem))
      : current.sets[flowRow]?.isWarmup ? undefined : previousWorking[workingOrdinal]?.load;
    const load = plannedFlowLoad(current.sets, flowRow, fallback) ?? startingFlowLoad(loadType, unitSystem, supportsBarbellCalculator(selectedExercise.name));
    const reps = expectedReps({ load, scaleByLoad: !isBodyweightLoadType(loadType), ...flowHistoryForRow(current.sets, flowRow, previousWorking), targetReps: target?.targetReps });
    return { weight: load, reps: Math.max(1, Math.round(reps)) };
  }, [flowRow, selectedExercise, recommendation, composerTargets, current.sets, unitSystem, loadType]);
  const flowKey = `${workout.startedAt}:${current.slotId ?? current.exerciseId}:${flowRow}`;
  const loggedSetCount = current.sets.filter(isLoggedSet).length;
  // A finished set reopened from its pill: the dial starts from what was logged.
  const exerciseKey = `${workout.startedAt}:${current.slotId ?? current.exerciseId}`;
  const editing = flowMode && !pendingSave && editingRow?.exercise === exerciseKey && current.sets[editingRow.row] && isLoggedSet(current.sets[editingRow.row]) ? editingRow.row : null;
  const dialKey = editing !== null ? `${flowKey}:edit:${editing}` : flowKey;
  const dialStart = editing !== null ? { weight: Number(current.sets[editing].weight), reps: Number(current.sets[editing].reps) } : flowPrediction;
  const dialValues = flowValues?.key === dialKey ? flowValues : dialStart;
  const rest = workout.rest ?? null;
  const restRemaining = rest ? Math.ceil(rest.seconds - (clock - Date.parse(rest.startedAt)) / 1000) : 0;
  const restActive = Boolean(rest && restRemaining > 0);
  const exerciseLogged = flowMode && Boolean(selectedExercise) && !pendingSave && flowRow === null && loggedSetCount > 0;
  const autoSaveKey = `${workout.startedAt}:${current.slotId ?? current.exerciseId}:${loggedSetCount}`;

  // Flow mode never asks to save: once the rest after an exercise's last set ends, it saves and the next one opens.
  useEffect(() => {
    if (!exerciseLogged || restActive || recordingLocked || editing !== null || autoSaved.current === autoSaveKey) return;
    autoSaved.current = autoSaveKey;
    void completeCurrent(false);
  }, [exerciseLogged, restActive, recordingLocked, editing, autoSaveKey]);

  // In the Android app the rest also counts down in the notification shade, so the phone can be locked or put away.
  const restEndsAt = focus && rest && editing === null ? Date.parse(rest.startedAt) + rest.seconds * 1000 : null;
  const restSeconds = rest?.seconds ?? 0;
  const nextSet = flowRow !== null && dialValues && selectedExercise
    ? `${selectedExercise.name} set ${flowRow + 1} · ${isBodyweightLoadType(loadType) && dialValues.weight === 0 ? `${dialValues.reps} reps` : `${formatFlowLoad(dialValues.weight)} ${flowWeightCaption()} × ${dialValues.reps}`}`
    : null;
  const restDetail = nextSet ? `Next: ${nextSet}` : nextSlotName ? `Next: ${nextSlotName}` : "That was the last set";
  const restDoneDetail = nextSet ?? (nextSlotName ? `Up next: ${nextSlotName}` : "Finish the workout or add a set");
  useEffect(() => {
    if (!focus) return;
    if (restEndsAt === null || restEndsAt <= Date.now()) clearRestAlert();
    else showRestAlert({ endsAt: restEndsAt, seconds: restSeconds, detail: restDetail, doneDetail: restDoneDetail });
  }, [focus, restEndsAt, restSeconds, restDetail, restDoneDetail]);
  useEffect(() => () => {
    if (focus) clearRestAlert();
  }, [focus]);

  function persist(updater: (workout: ActiveWorkout) => ActiveWorkout) {
    if (savingRef.current || useFitnessStore.getState().activeWorkoutFinalizing || useFitnessStore.getState().activeDraftConflict) return;
    const latest = useFitnessStore.getState().activeWorkout;
    if (!latest || latest.startedAt !== workout.startedAt) return;
    if (latest.currentExercise.requestId) {
      setError("A save is pending. Retry the same recorded values before changing this draft.");
      return;
    }
    void updateActiveWorkout(updater(latest)).catch((caught) => setError(errorMessage(caught)));
  }

  /** Reads the store, so an exercise created a moment ago is found before the next render. */
  function findExercise(exerciseId: number | null | undefined) {
    return useFitnessStore.getState().exercises.find((item) => item.id === exerciseId);
  }

  function withPrescription(active: ActiveWorkout, draft: ActiveWorkout["currentExercise"]) {
    const exercise = findExercise(draft.exerciseId);
    if (!exercise) return { ...draft, prescription: undefined };
    const changed = active.currentExercise.exerciseId !== draft.exerciseId || active.currentExercise.machineProfileId !== draft.machineProfileId;
    if (draft.prescription && !changed) return draft;
    const type = getExerciseLoadType(exercise);
    const recommendation = buildGuidedRecommendation({ exercise, preferences: guidedWorkoutPreferences, sessions, sets,
      workoutDate: active.workoutDate, draftWarmups: draft.sets.map((set) => Boolean(set.isWarmup)),
      machineProfileId: isMachineLoadType(type) ? draft.machineProfileId : null, machineScoped: isMachineLoadType(type) });
    const prescription = buildGuidedPrescription({ exerciseId: exercise.id, recommendation, generatedAt: new Date().toISOString() });
    prescription.equipment = isMachineLoadType(type)
      ? draft.machineProfileId ? { kind: "machine_profile", machineProfileId: draft.machineProfileId } : { kind: "unknown", reason: "No machine profile was selected." }
      : { kind: "non_machine", loadType: type };
    return { ...draft, prescription };
  }

  function updateDraft(patch: Partial<ActiveWorkout["currentExercise"]>) {
    persist((active) => ({ ...active, currentExercise: withPrescription(active, { ...active.currentExercise, ...patch }) }));
  }

  useEffect(() => {
    if (selectedExercise && !current.prescription && !pendingSave && !recordingLocked) updateDraft({});
  }, [selectedExercise?.id, current.prescription, pendingSave, recordingLocked]);

  // When an exercise is saved (or removed), the next planned one opens by itself.
  useEffect(() => {
    if (current.exerciseId !== null || pendingSave || recordingLocked || !nextSlot) return;
    activateSlot(nextSlot);
  }, [current.exerciseId, nextSlot?.id, pendingSave, recordingLocked]);

  function updateDisplayedSets(sets: LoggedSetDraft[]) {
    if (savingRef.current || useFitnessStore.getState().activeWorkoutFinalizing || useFitnessStore.getState().activeDraftConflict) return;
    const latestState = useFitnessStore.getState();
    const latest = latestState.activeWorkout;
    if (!latest || latest.startedAt !== workout.startedAt) return;
    if (!latest.currentExercise.requestId) {
      updateDraft({ sets: stampSetCapture(sets, new Date().toISOString()), requestUnit: latest.currentExercise.requestUnit ?? unitSystem });
      return;
    }
    const latestExercise = latestState.exercises.find((exercise) => exercise.id === latest.currentExercise.exerciseId);
    if (latest.currentExercise.requestUnit && latestExercise) {
      const context = {
        exerciseId: latestExercise.id, workoutDate: latest.workoutDate,
        machineProfileId: isMachineLoadType(getExerciseLoadType(latestExercise)) ? latest.currentExercise.machineProfileId : null,
        unitSystem: latest.currentExercise.requestUnit
      };
      if (latest.currentExercise.sets.every((set) => (!set.reps.trim() && !set.weight.trim()) || isGuidedObservationConfirmed(set, context))) {
        setError("A save is pending. Retry the same recorded values before changing this draft.");
        return;
      }
    }
    // A legacy pending draft may review its confirmation; its attempted values stay intact.
    if (!sameGuidedSetValues(latest.currentExercise.sets, sets)) {
      setError("A save is pending. Its values must stay unchanged until the retry is resolved.");
      return;
    }
    void updateActiveWorkout({
      ...latest,
      currentExercise: { ...latest.currentExercise, sets, requestUnit: latest.currentExercise.requestUnit ?? unitSystem }
    }).catch((caught) => setError(errorMessage(caught)));
  }

  async function completeCurrent(endAfterSave: boolean) {
    if (savingRef.current || useFitnessStore.getState().activeWorkoutFinalizing || useFitnessStore.getState().activeDraftConflict) return;
    setSaving(true);
    savingRef.current = true;
    setError(null);
    let newRequestId: string | null = null;
    let canonicalCommitted = false;
    try {
      const state = useFitnessStore.getState();
      const snapshot = state.activeWorkout;
      if (!snapshot || snapshot.startedAt !== workout.startedAt) throw new Error("Your active workout changed. Review the current draft before saving.");
      // Flow mode saves only the sets you confirmed; suggestions you never reached were not performed.
      const draft = focus && !snapshot.currentExercise.requestId
        ? { ...snapshot.currentExercise, sets: snapshot.currentExercise.sets.filter(isLoggedSet) } : snapshot.currentExercise;
      const recordingUnit = draft.requestUnit ?? (draft.requestId ? undefined : state.unitSystem);
      if (!recordingUnit) throw new Error("This saved draft has no recorded unit. Check the displayed units, then save again.");
      const exercise = state.exercises.find((item) => item.id === draft.exerciseId);
      if (endAfterSave && !hasEnteredSets(draft.sets)) {
        if (draft.requestId) throw new Error("A save is pending. Retry it before discarding or finishing this workout.");
        await finish(snapshot);
        return;
      }
      if (!exercise) throw new Error("Choose an exercise and enter working sets first.");
      const recordingLoadType = getExerciseLoadType(exercise);
      const machineProfileId = isMachineLoadType(recordingLoadType) ? draft.machineProfileId : null;
      const recordingContext = { exerciseId: exercise.id, workoutDate: snapshot.workoutDate, machineProfileId, unitSystem: recordingUnit };
      // Saving is the performed signal: every set with reps and load is confirmed here, so there is
      // no per-set tap. Confirmation fingerprints the values, so a retry confirms identically.
      const partial = draft.sets.findIndex((set) => (set.reps.trim() || set.weight.trim()) && !canConfirmGuidedObservation(set));
      if (partial >= 0) throw new Error(`Set ${partial + 1} needs both reps and load. Fill it in or delete it.`);
      const performed = { ...draft, sets: draft.sets.map((set) => canConfirmGuidedObservation(set) ? confirmGuidedObservation(finalizeSetCapture(set), recordingContext) : set) };
      assertGuidedObservationsConfirmed(performed.sets, recordingContext);
      const requestId = draft.requestId ?? createRequestId();
      if (!draft.requestId) newRequestId = requestId;
      const attempt: GuidedCommitAttempt = {
        workoutId: snapshot.startedAt, workoutDate: snapshot.workoutDate, unitSystem: recordingUnit,
        draft: { ...withPrescription(snapshot, performed), requestId, requestUnit: recordingUnit }
      };
      // Optimistic state may contain an identity whose previous draft write failed.
      // Establish the exact durable retry payload before every canonical attempt.
      if (!draft.requestId || state.activeWorkoutDirty || !sameGuidedExerciseDraft(draft, attempt.draft)) await updateActiveWorkout({ ...snapshot, currentExercise: attempt.draft });
      const prepared = useFitnessStore.getState();
      if (prepared.currentUser?.id !== state.currentUser?.id) throw new Error("Your account changed. Review your workout before retrying.");
      if (!prepared.activeWorkout || prepared.activeWorkout.startedAt !== attempt.workoutId
        || prepared.activeWorkout.workoutDate !== attempt.workoutDate || prepared.activeWorkout.currentExercise.requestUnit !== attempt.unitSystem
        || !sameGuidedExerciseDraft(prepared.activeWorkout.currentExercise, attempt.draft)) {
        throw new Error("Your draft changed while preparing the save. Review it before retrying; no new observation was recorded by this attempt.");
      }
      const sessionId = await saveWorkout({
        origin: "guided",
        expectedActive: prepared.activeWorkout,
        requestId,
        unitSystem: recordingUnit,
        exerciseId: exercise.id,
        workoutDate: snapshot.workoutDate,
        notes: draft.notes,
        machineProfileId,
        sets: performed.sets
      });
      canonicalCommitted = true;
      const latest = useFitnessStore.getState();
      if (latest.currentUser?.id !== state.currentUser?.id) throw new Error("Exercise saved. Your account changed while saving; the current account's draft was kept.");
      if (!latest.activeWorkout) throw new Error("Exercise saved. The active workout was already closed; review the saved entry in Logs.");
      if (latest.activeWorkout.workoutId !== snapshot.workoutId || latest.activeWorkout.startedAt !== snapshot.startedAt) {
        throw new Error("Exercise saved. Your active workout changed while saving; the newer workout was kept.");
      }
      const recordedEntry = latest.activeWorkout.completedExercises.find((entry) => entry.sessionId === sessionId && entry.exerciseId === exercise.id);
      if (!recordedEntry) throw new Error("This entry was already recorded by an earlier attempt. Its original data was preserved; review it in Logs before reconciling this draft.");
      if (endAfterSave && !latest.activeWorkout.currentExercise.exerciseId) {
        await finish(latest.activeWorkout);
        return;
      }
      if (latest.activeWorkout.currentExercise.exerciseId) setError("Exercise saved. A newer draft was kept and the workout remains open; review it before continuing.");
    } catch (caught) {
      // Validation of a reused request proves nothing about its earlier uncertain attempt.
      if (caught instanceof WorkoutValidationError && newRequestId && !canonicalCommitted) {
        const latest = useFitnessStore.getState().activeWorkout;
        if (latest?.startedAt === workout.startedAt && latest.currentExercise.requestId === newRequestId) {
          try {
            await updateActiveWorkout({ ...latest, currentExercise: { ...latest.currentExercise, requestId: undefined, requestUnit: undefined } });
          } catch (releaseError) {
            setError(`${errorMessage(caught)} ${errorMessage(releaseError)}`);
            return;
          }
        }
      }
      setError(errorMessage(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function finish(completedWorkout = useFitnessStore.getState().activeWorkout) {
    if (!completedWorkout || completedWorkout.startedAt !== workout.startedAt) throw new Error("Your active workout changed. Review it before finishing.");
    if (!completedWorkout.completedExercises.length) {
      await finishActiveWorkout();
      setConfirmEnd(false);
      navigation.navigate("Home");
      return;
    }
    const finishedAt = new Date().toISOString();
    const summary: CompletedGuidedWorkout = {
      ...completedWorkout,
      id: completedWorkout.startedAt,
      finishedAt
    };
    if (!completedWorkout.workoutId) throw new Error("The saved workout identity is unavailable. Reload and review the draft before finishing.");
    await finishActiveWorkout(summary);
    await rememberTemplateExercises(completedWorkout);
    setConfirmEnd(false);
    navigation.navigate("WorkoutSummary", { workoutId: completedWorkout.workoutId });
  }

  /** The template learns today's exercises and order. The workout itself is already saved, so this cannot fail it. */
  async function rememberTemplateExercises(finished: ActiveWorkout) {
    const key = templateExerciseKey(finished.plannedMuscles);
    const learned = learnedTemplateExercises(finished);
    if (!key || !learned.length || sameTemplateExercises(learned, useFitnessStore.getState().templateExercises?.[key] ?? [])) return;
    try { await saveTemplateExercises(key, learned); }
    catch { useFitnessStore.setState({ operationNotice: "Workout saved. Its exercise list could not be remembered for next time." }); }
  }

  function logFlowSet() {
    if (flowRow === null || !dialValues) return;
    const at = new Date().toISOString();
    const row = flowRow;
    const load = formatFlowLoad(dialValues.weight);
    const reps = String(dialValues.reps);
    persist((active) => {
      const draft = active.currentExercise;
      if (nextFlowRow(draft.sets) !== row) return active;
      const original = draft.sets[row];
      // A different load carries down to the waiting rows that shared the planned load; they stay suggestions.
      const sets = draft.sets.map((set, index) => {
        if (index === row) return flowCapturedSet(set, { reps, weight: load }, at);
        if (index < row || isLoggedSet(set) || Boolean(set.isWarmup) !== Boolean(original.isWarmup) || (set.weight.trim() && set.weight !== original.weight)) return set;
        return plannedSuggestion({ ...set, weight: load });
      });
      const restPeriod: WorkoutRest = { startedAt: at, seconds: guidedWorkoutPreferences.restSeconds, exerciseId: draft.exerciseId, setIndex: row };
      return { ...active, rest: restPeriod, currentExercise: withPrescription(active, { ...draft, sets, requestUnit: draft.requestUnit ?? unitSystem }) };
    });
  }

  /** Saves the corrected values of a reopened set, keeping when it was performed. */
  function saveEditedSet() {
    if (editing === null || !dialValues) return;
    const row = editing;
    const load = formatFlowLoad(dialValues.weight);
    const reps = String(dialValues.reps);
    persist((active) => {
      const draft = active.currentExercise;
      if (!draft.sets[row] || !isLoggedSet(draft.sets[row])) return active;
      const sets = draft.sets.map((set, index) => index === row ? flowCapturedSet(set, { reps, weight: load }, set.performedAt ?? new Date().toISOString()) : set);
      return { ...active, currentExercise: withPrescription(active, { ...draft, sets }) };
    });
    setEditingRow(null);
  }

  /** Puts a reopened set back in the queue, e.g. after an accidental Done. */
  function unlogEditedSet() {
    if (editing === null) return;
    const row = editing;
    persist((active) => {
      const draft = active.currentExercise;
      const sets = stampSetCapture(draft.sets.map((set, index) => index === row ? { ...set, reps: "" } : set), new Date().toISOString());
      const rest = active.rest?.exerciseId === draft.exerciseId && active.rest?.setIndex === row ? null : active.rest;
      return { ...active, rest, currentExercise: withPrescription(active, { ...draft, sets }) };
    });
    setEditingRow(null);
  }

  function flowWeightCaption() {
    return loadType === "bodyweight_plus_load" ? `${unitSystem} added` : loadType === "bodyweight_minus_assistance" ? `${unitSystem} assist` : unitSystem;
  }

  function addFlowSet() {
    persist((active) => {
      const draft = active.currentExercise;
      const lastWorking = [...draft.sets].reverse().find((set) => !set.isWarmup);
      return { ...active, currentExercise: withPrescription(active, { ...draft, sets: [...draft.sets, { reps: "", weight: lastWorking?.weight ?? "" }] }) };
    });
  }

  /** Winding the rest ring: this rest now ends this many seconds from now, within 1:30 to 5:00 in all. The next rest starts at the setting again. */
  function setRestRemaining(seconds: number) {
    persist((active) => {
      if (!active.rest) return active;
      const elapsed = Math.max(0, (Date.now() - Date.parse(active.rest.startedAt)) / 1000);
      const length = Math.round(Math.min(restLimits.max, Math.max(restLimits.min, elapsed + Math.max(0, seconds))));
      return { ...active, rest: { ...active.rest, seconds: length } };
    });
  }

  function endRest() {
    persist((active) => ({ ...active, rest: null }));
  }

  /** Flow mode: one full-screen step at a time (plan, set, rest), with nothing else of the app visible. */
  function focusView() {
    const exerciseName = selectedExercise?.name ?? "Exercise";
    const position = progress.length ? `${Math.min(currentPosition, progress.length)} / ${progress.length}` : null;
    const blocked = draftConflict || Boolean(recoveredDrafts?.length);
    const stepKey = blocked ? "blocked" : needsPlan ? "plan" : String(current.slotId ?? current.exerciseId ?? (nextSlot ? "opening" : "end"));
    let body: ReactNode;
    if (blocked) {
      body = <View style={styles.focusCenter}>
        <SectionTitle>This workout needs a quick review</SectionTitle>
        <Body style={styles.focusMeta}>A newer or recovered draft exists. Your entered values are kept; review them in the full workout view.</Body>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("ActiveWorkout")} style={pressableFeedback(styles.primaryButton)}>
          <Body style={styles.primaryText}>Open full view</Body>
        </Pressable>
      </View>;
    } else if (needsPlan) {
      body = <ScrollView contentContainerStyle={styles.focusScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {planBuilder}
        <Pressable accessibilityRole="button" onPress={() => setExerciseSheet(true)} style={pressableFeedback(styles.focusLink)}>
          <Body style={styles.focusLinkText}>Or choose one exercise at a time</Body>
        </Pressable>
      </ScrollView>;
    } else if (!selectedExercise) {
      body = nextSlot ? <View style={styles.focusCenter}><Body style={styles.focusMeta}>Opening {nextSlotName ?? "the next exercise"}…</Body></View>
        : <View style={styles.focusCenter}>
          <SectionTitle>{activeWorkout.completedExercises.length ? "That's everything planned" : "Choose an exercise"}</SectionTitle>
          <Body style={styles.focusMeta}>{activeWorkout.completedExercises.length
            ? `${activeWorkout.completedExercises.length} ${activeWorkout.completedExercises.length === 1 ? "exercise" : "exercises"} saved. Finish, or add one more.`
            : "Pick what you are doing first."}</Body>
          {activeWorkout.completedExercises.length ? <Pressable accessibilityRole="button" disabled={recordingLocked} onPress={() => void finishFromAction()} style={pressableFeedback(styles.primaryButton)}>
            <Body style={styles.primaryText}>{recordingLocked ? "Finishing…" : "Finish workout"}</Body>
          </Pressable> : null}
          <Pressable accessibilityRole="button" disabled={recordingLocked} onPress={() => setExerciseSheet(true)} style={pressableFeedback(styles.secondaryButton)}>
            <Body style={styles.buttonText}>{activeWorkout.completedExercises.length ? "Add an exercise" : "Choose exercise"}</Body>
          </Pressable>
          {error ? <Body style={styles.error}>{error}</Body> : null}
        </View>;
    } else if (pendingSave) {
      body = <View style={styles.focusCenter}>
        <SectionTitle>{exerciseName}</SectionTitle>
        <Body style={styles.focusMeta}>{recordingLocked ? `Saving ${exerciseName}…` : error ?? "This exercise has not saved yet. Your sets are kept."}</Body>
        {!recordingLocked ? <Pressable accessibilityRole="button" onPress={() => void completeCurrent(false)} style={pressableFeedback(styles.primaryButton)}>
          <Body style={styles.primaryText}>Retry save</Body>
        </Pressable> : null}
      </View>;
    } else {
      body = <>
        <Pressable accessibilityRole="button" accessibilityLabel={`${exerciseName}. Change exercise`} disabled={recordingLocked} onPress={() => setExerciseSheet(true)} style={pressableFeedback(styles.focusTitle)}>
          <Body numberOfLines={2} style={styles.focusTitleText}>{exerciseName}</Body>
          <ChevronDown size={18} color={palette.muted} />
        </Pressable>
        {current.sets.length ? <FlowSetLogger
          fill
          sets={current.sets}
          row={editing ?? flowRow}
          weight={dialValues?.weight ?? 0}
          reps={dialValues?.reps ?? 1}
          weightStep={flowStep}
          weightCaption={flowWeightCaption()}
          formatLoad={formatFlowLoad}
          editing={editing !== null}
          loadGhost={flowLoadGhost({ exerciseName: selectedExercise.name, loadType, unitSystem, profile: isMachineLoadType(loadType) ? selectedMachineProfile : null,
            barWeight: Number(current.barWeight) })}
          rest={restActive && rest && editing === null ? {
            remaining: restRemaining, total: rest.seconds,
            next: flowRow !== null && dialValues ? `${formatFlowLoad(dialValues.weight)} × ${dialValues.reps}` : null,
            nextExercise: flowRow === null ? nextSlotName : null,
            canAddSet: flowRow === null
          } : null}
          status={exerciseLogged && editing === null ? `Saving ${exerciseName}…` : null}
          disabled={recordingLocked}
          onChange={(values) => setFlowValues({ key: dialKey, ...values })}
          onLog={editing !== null ? saveEditedSet : logFlowSet}
          onSkipRest={endRest}
          note={current.notes}
          onNote={() => setNoteOpen(true)}
          onAddSet={addFlowSet}
          onAdjustRest={setRestRemaining}
          onEditSet={(row) => { setFlowValues(null); setEditingRow({ exercise: exerciseKey, row }); }}
          onUnlog={unlogEditedSet}
          onCancelEdit={() => setEditingRow(null)}
        /> : <View style={styles.focusCenter}>
          <Pressable accessibilityRole="button" onPress={addFlowSet} style={pressableFeedback(styles.primaryButton)}>
            <Body style={styles.primaryText}>Add a set</Body>
          </Pressable>
        </View>}
        {error ? <Body style={styles.error}>{error}</Body> : null}
      </>;
    }

    return (
      <FocusShell startedAt={activeWorkout.startedAt} now={clock} position={position} onClose={() => setFocusMenu(true)} stepKey={stepKey}>
        {body}
        <Modal visible={focusMenu} transparent animationType="none" statusBarTranslucent onRequestClose={() => setFocusMenu(false)}>
          <BottomSheet title="Workout" closeLabel="Keep going" onClose={() => setFocusMenu(false)}>
            <View style={styles.focusSheet}>
              <Pressable accessibilityRole="button" disabled={recordingLocked} onPress={() => {
                setFocusMenu(false);
                if (selectedExercise && hasLoggedSets(current.sets) && !pendingSave) void completeCurrent(true);
                else void finishFromAction();
              }} style={pressableFeedback(styles.primaryButton)}>
                <Body style={styles.primaryText}>{activeWorkout.completedExercises.length || hasLoggedSets(current.sets) ? "Finish workout" : "Discard workout"}</Body>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setFocusMenu(false); navigation.navigate("Home"); }} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Leave flow · workout keeps running</Body>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setFocusMenu(false); navigation.navigate("ActiveWorkout"); }} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Edit sets in the full view</Body>
              </Pressable>
            </View>
          </BottomSheet>
        </Modal>
        <Modal visible={exerciseSheet} transparent animationType="none" statusBarTranslucent onRequestClose={() => setExerciseSheet(false)}>
          <BottomSheet title="Exercises" onClose={() => setExerciseSheet(false)}>
            <View style={styles.focusSheet}>
              {progress.length ? planStrip : null}
              <SearchableExercisePicker exercises={exercises} caption={selectedExercise ? "Swap or add an exercise" : "Choose an exercise"} disabled={recordingLocked || pendingSave}
                onSelect={(exerciseId) => { setExerciseSheet(false); chooseExercise(exerciseId); }}
                onCreate={createCustomExercise} defaultMuscle={newExerciseMuscle} suggested={suggested}
                suggestedLabel={activeWorkout.plannedMuscles.length ? `Suggested for ${activeWorkout.plannedMuscles.join(" / ")}` : "Suggested"} />
            </View>
          </BottomSheet>
        </Modal>
        <Modal visible={noteOpen} transparent animationType="none" statusBarTranslucent onRequestClose={() => setNoteOpen(false)}>
          <BottomSheet title="Note" eyebrow={exerciseName} closeLabel="Done" onClose={() => setNoteOpen(false)}>
            <View style={styles.focusSheet}>
              <TextInput accessibilityLabel={`Note for ${exerciseName}`} autoFocus multiline value={current.notes} editable={!recordingLocked && !pendingSave}
                onChangeText={(notes) => updateDraft({ notes })} placeholder="Seat height, grip, how it felt" placeholderTextColor={palette.muted} style={[styles.input, styles.focusNote]} />
              <Pressable accessibilityRole="button" onPress={() => setNoteOpen(false)} style={pressableFeedback(styles.primaryButton)}>
                <Body style={styles.primaryText}>Done</Body>
              </Pressable>
            </View>
          </BottomSheet>
        </Modal>
      </FocusShell>
    );
  }

  async function finishFromAction() {
    if (savingRef.current || useFitnessStore.getState().activeWorkoutFinalizing || useFitnessStore.getState().activeDraftConflict) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (useFitnessStore.getState().activeWorkout?.currentExercise.requestId) throw new Error("A save is pending. Retry it before discarding or finishing this workout.");
      await finish();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const planBuilder = (
    <>
    <SectionTitle>Plan this day once</SectionTitle>
    <Body>Tap everything you usually do, in order. GROWTH remembers the list, so next time each exercise is ready and logging a set is one tap.</Body>
    <View style={styles.planSearch}>
      <Search size={17} color={palette.muted} />
      <TextInput accessibilityLabel="Search all exercises" value={planQuery} onChangeText={setPlanQuery} editable={!recordingLocked}
        placeholder="Not listed? Search by name or muscle" placeholderTextColor={palette.muted} autoCapitalize="none" autoCorrect={false} style={styles.planSearchInput} />
      {planQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={touchHitSlop} onPress={() => setPlanQuery("")} style={pressableFeedback(styles.planSearchClear)}>
        <X size={16} color={palette.muted} />
      </Pressable> : null}
    </View>
    {planCreating ? <NewExerciseForm initialName={planQuery} defaultMuscle={newExerciseMuscle} exercises={exercises} disabled={recordingLocked}
      onCreate={createCustomExercise} onCreated={(exercise) => pickPlanExercise(exercise.id)} onUseExisting={(exercise) => pickPlanExercise(exercise.id)}
      onCancel={() => setPlanCreating(false)} /> : null}
    {!planCreating ? <View style={styles.planChips}>
      {planChoices.map((exercise) => {
        const picked = planPicks.indexOf(exercise.id);
        return (
          <Pressable key={exercise.id} accessibilityRole="checkbox" accessibilityState={{ checked: picked >= 0 }} accessibilityLabel={exercise.name}
            onPress={() => setPlanPicks(picked >= 0 ? planPicks.filter((id) => id !== exercise.id) : [...planPicks, exercise.id])}
            style={pressableFeedback([styles.planChip, picked >= 0 && styles.planChipCurrent])}>
            {picked >= 0 ? <Body style={[styles.planChipText, styles.planChipCurrentText]}>{picked + 1}</Body> : null}
            <Body numberOfLines={1} style={[styles.planChipText, picked >= 0 && styles.planChipCurrentText]}>{exercise.name}</Body>
          </Pressable>
        );
      })}
      {planCanCreate ? <Pressable accessibilityRole="button" accessibilityLabel={`Add ${planQuery.trim()} as a new exercise`} disabled={recordingLocked}
        onPress={() => setPlanCreating(true)} style={pressableFeedback([styles.planChip, styles.planAdd])}>
        <Plus size={14} color={palette.ink} />
        <Body numberOfLines={1} style={styles.planChipText}>New exercise “{planQuery.trim()}”</Body>
      </Pressable> : null}
    </View> : null}
    {planSearching && !planMatches.length && !planCreating ? <Body style={styles.planMeta}>No exercises match “{planQuery.trim()}”. Add it as a new exercise.</Body> : null}
    {planMatches.length > planBuilderSuggestions && !planCreating ? <Body style={styles.planMeta}>Showing {planBuilderSuggestions} of {planMatches.length}. Keep typing to narrow it down.</Body> : null}
    <Pressable accessibilityRole="button" disabled={!planPicks.length || recordingLocked} onPress={startPlan} style={pressableFeedback([styles.primaryButton, !planPicks.length && styles.disabledButton])}>
      <Body style={styles.primaryText}>{planPicks.length ? `Start with ${planPicks.length} ${planPicks.length === 1 ? "exercise" : "exercises"}` : "Pick exercises to start"}</Body>
    </Pressable>
    </>
  );

  const planStrip = (
    <>
    <View style={styles.summaryRow}>
      <Label style={styles.flex}>Today's plan</Label>
      <Body style={styles.planMeta}>{doneCount} of {progress.length} done</Body>
    </View>
    <View style={styles.planChips}>
      {progress.map((item) => {
        const name = exercises.find((exercise) => exercise.id === item.slot.exerciseId)?.name ?? "Exercise";
        if (item.status === "done") return (
          <View key={item.slot.id} style={[styles.planChip, styles.planChipDone]}>
            <Check size={14} color={palette.success} />
            <Body numberOfLines={1} style={styles.planChipDoneText}>{name}</Body>
          </View>
        );
        const isCurrent = item.status === "current";
        return (
          <View key={item.slot.id} style={[styles.planChip, isCurrent && styles.planChipCurrent]}>
            <Pressable accessibilityRole="button" accessibilityLabel={isCurrent ? `${name}, current exercise` : `Switch to ${name}`} disabled={isCurrent || recordingLocked || pendingSave}
              onPress={() => activateSlot(item.slot)} style={pressableFeedback(styles.planChipLabel)}>
              <Body numberOfLines={1} style={[styles.planChipText, isCurrent && styles.planChipCurrentText]}>{name}</Body>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name} from today's plan`} hitSlop={touchHitSlop} disabled={recordingLocked || pendingSave}
              onPress={() => removeSlot(item.slot.id)} style={pressableFeedback(styles.planChipRemove)}>
              <X size={14} color={isCurrent ? palette.surface : palette.muted} />
            </Pressable>
          </View>
        );
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="Add an exercise to today's plan" accessibilityState={{ expanded: addingSlot }} disabled={recordingLocked}
        onPress={() => setAddingSlot(!addingSlot)} style={pressableFeedback([styles.planChip, styles.planAdd])}>
        <Plus size={16} color={palette.ink} />
      </Pressable>
    </View>
    {addingSlot ? <SearchableExercisePicker exercises={exercises} caption="Add to today's plan" disabled={recordingLocked} onSelect={addSlot}
      onCreate={createCustomExercise} defaultMuscle={newExerciseMuscle}
      suggested={suggested} suggestedLabel={activeWorkout.plannedMuscles.length ? `Suggested for ${activeWorkout.plannedMuscles.join(" / ")}` : "Suggested"} /> : null}
    </>
  );

  if (focus) return focusView();

  const setList = selectedExercise ? (
    <VisualSetComposer
      sets={displayedSets}
      loadType={loadType}
      unitSystem={unitSystem}
      supportsBarbell={supportsBarbellCalculator(selectedExercise.name)}
      barWeight={current.barWeight}
      plateCounts={current.plateCounts}
      targets={composerTargets}
      observationContext={observationContext}
      disabled={recordingLocked || (pendingSave && !confirmationReviewNeeded)}
      readOnlyValues={pendingSave}
      onBarbellApply={(patch) => updateDraft(patch)}
      onBarWeightChange={(barWeight) => updateDraft({ barWeight })}
      onPlateCountsChange={(plateCounts) => updateDraft({ plateCounts })}
      onSetsChange={updateDisplayedSets}
    />
  ) : null;

  return (
    <Screen>
      {draftRecoveryPanels(exercises, recoveredDrafts ?? [], draftConflict, () => void reloadSavedDraft().catch((caught) => setError(errorMessage(caught))), styles)}
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Title>{activeWorkout.workoutLabel ?? (activeWorkout.plannedMuscles.join(" / ") || "Workout")}</Title>
          <Body>{progress.length ? `${doneCount} of ${progress.length} ${progress.length === 1 ? "exercise" : "exercises"} done`
            : activeWorkout.completedExercises.length ? `${activeWorkout.completedExercises.length} ${activeWorkout.completedExercises.length === 1 ? "exercise" : "exercises"} recorded` : "Pick your first exercise"}</Body>
        </View>
        <TimerDisplay startedAt={activeWorkout.startedAt} now={clock} />
      </View>

      {recorded.resolution !== "complete" ? <Panel><Body accessibilityRole="alert">Some completed exercise links need review. Their archived values are preserved, but only linked recorded work is shown here.</Body></Panel> : null}

      {needsPlan ? (
        <Panel>
          {planBuilder}
          <Body style={styles.planMeta}>Or choose one exercise at a time below. Whatever you do today is remembered too.</Body>
        </Panel>
      ) : null}

      {progress.length ? <Panel>{planStrip}</Panel> : null}

      <Panel>
        <SearchableExercisePicker exercises={exercises} selectedId={current.exerciseId} caption={`Exercise ${currentPosition}`} disabled={recordingLocked || pendingSave} onSelect={chooseExercise}
          onCreate={createCustomExercise} defaultMuscle={newExerciseMuscle}
          suggested={suggested}
          suggestedLabel={activeWorkout.plannedMuscles.length ? `Suggested for ${activeWorkout.plannedMuscles.join(" / ")}` : "Suggested"} />
      </Panel>

      {selectedExercise ? (
        <Panel>
          <View style={styles.summaryRow}>
            <View style={styles.flex}>
              {recommendation ? <Label>{guidedCategoryLabels[recommendation.category]}</Label> : null}
              <Body>{bestPerformance ? `Best e1RM ${formatWeight(bestPerformance.estimated1RM, unitSystem)} · ${bestPerformance.performancePoints.toFixed(1)} points` : "No best performance yet."}</Body>
            </View>
          </View>

          <DetailsDisclosure title="Guidance and previous results">
            <View style={styles.guidance}>
            <Label>Suggested for this session</Label>
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
            {recommendation?.latest ? <Body>Most recent logged work{previousLogScope} ({recommendation.latest.date}): {formatSessionSets(recommendation.latest.sets, unitSystem)}</Body> : null}
            {recommendation?.category === "top_set" ? (
              <>
                {recommendation.topSetBest ? <Body>Best logged top set ({recommendation.topSetBest.date}): {formatSessionSets(recommendation.topSetBest.sets.slice(0, 1), unitSystem)}</Body> : null}
                {recommendation.backoffBest ? <Body>Best logged back-off block ({recommendation.backoffBest.date}): {formatSessionSets(recommendation.backoffBest.sets.slice(1), unitSystem)}</Body> : null}
              </>
            ) : recommendation?.best ? <Body>Best logged target ({recommendation.best.date}): {formatSessionSets(recommendation.best.sets, unitSystem)}</Body> : null}
            </View>
          </DetailsDisclosure>

          {isBodyweightLoadType(loadType) ? (
            <Body>{loadInstruction(loadType, selectedBodyWeight?.weight, bodyWeightUnit)}</Body>
          ) : null}
          {isBodyweightLoadType(loadType) ? <Body>{bodyweightLookupMessage(getBodyweightEstimateForDate(workout.workoutDate, bodyWeightLogs), bodyWeightUnit)}</Body> : null}

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

          {setList}
          {pendingSave ? <Body>A save is pending. These values use {unitSystem} and stay unchanged while you retry.{!current.requestUnit ? " Check these units before retrying." : ""}</Body> : null}
          <Pressable accessibilityRole="button" disabled={recordingLocked || !selectedExercise} onPress={() => void completeCurrent(false)} style={pressableFeedback(styles.primaryButton)}>
            <Body style={styles.primaryText}>{recordingLocked ? "Saving…" : pendingSave ? "Retry exercise save" : nextSlotName ? `Save · next: ${nextSlotName}` : "Save exercise"}</Body>
          </Pressable>
          <DetailsDisclosure title="Add exercise notes">
            <TextInput accessibilityLabel="Exercise notes" style={[styles.input, styles.notes]} value={current.notes} editable={!recordingLocked && !pendingSave} onChangeText={(notes) => updateDraft({ notes })} multiline placeholder="Optional context" />
          </DetailsDisclosure>
          {projectedPerformance ? <Body>Session feedback: {projectedPerformance.performancePoints.toFixed(1)} | e1RM {formatWeight(projectedPerformance.estimated1RM, unitSystem)}</Body> : null}
        </Panel>
      ) : null}

      {error ? <Body style={styles.error}>{error}</Body> : null}
      {activeWorkoutFinalizing ? <Body>Finishing this workout. Recording stays locked until it completes.</Body> : null}
      <View style={styles.footerActions}>
        <Pressable disabled={recordingLocked} onPress={() => setConfirmEnd(true)} style={pressableFeedback(styles.endButton)}>
          <Body style={styles.buttonText}>End workout</Body>
        </Pressable>
      </View>

      {recorded.entries.length ? <Panel>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCompleted }} onPress={() => setShowCompleted(!showCompleted)} style={pressableFeedback(styles.secondaryButton)}>
          <Body style={styles.buttonText}>{showCompleted ? "Hide recorded exercises" : `Show ${recorded.entries.length} recorded ${recorded.entries.length === 1 ? "exercise" : "exercises"}`}</Body>
        </Pressable>
      </Panel> : null}
      {showCompleted ? <View style={{ gap: spacing.md }}>
      {recorded.entries.map((entry, index) => (
        <Panel key={entry.id}>
          <View style={styles.summaryRow}>
            <Check size={18} color={palette.success} />
            <SectionTitle>Exercise {index + 1}: {exercises.find((exercise) => exercise.id === entry.exerciseId)?.name ?? "Recorded exercise"}</SectionTitle>
            <ChevronRight size={18} color={palette.muted} />
          </View>
          <Body>{entry.sets.map((set) => `${set.isWarmup ? "Warm-up: " : ""}${formatWeight(set.loadLb, unitSystem)} x ${set.reps}`).join(" | ")}</Body>
          {entry.machineProfileId ? <Label>{machineProfiles.find((profile) => profile.id === entry.machineProfileId)?.label ?? "Recorded machine"}</Label> : null}
        </Panel>
      ))}
      </View> : null}

      <Modal visible={confirmEnd} transparent animationType="none" statusBarTranslucent onRequestClose={() => setConfirmEnd(false)}>
        <BottomSheet title="End workout?" closeLabel="Continue workout" onClose={() => setConfirmEnd(false)}>
          <View style={styles.sheetBody}>
            <Body>{pendingSave
              ? "A save is pending. Retry its unchanged values before finishing this workout."
              : hasLoggedSets(current.sets) && selectedExercise
              ? "This exercise has entered sets that aren't saved yet. Save it first, or discard it and finish."
              : activeWorkout.completedExercises.length
                ? "Your completed exercises are saved. Finish to view your session summary."
                : "No exercises have been completed. Finishing now will discard this empty workout."}</Body>
            {error ? <Body style={styles.error}>{error}</Body> : null}
            <View style={styles.actions}>
              <Pressable onPress={() => setConfirmEnd(false)} style={pressableFeedback(styles.secondaryButton)}>
                <Body style={styles.buttonText}>Continue workout</Body>
              </Pressable>
              {hasLoggedSets(current.sets) && selectedExercise ? (
                <>
                  <Pressable disabled={recordingLocked || pendingSave} onPress={() => void finishFromAction()} style={pressableFeedback(styles.secondaryButton)}>
                    <Body style={styles.buttonText}>Discard current & finish</Body>
                  </Pressable>
                  <Pressable disabled={recordingLocked} onPress={() => void completeCurrent(true)} style={pressableFeedback(styles.primaryButton)}>
                    <Body style={styles.primaryText}>Save current & finish</Body>
                  </Pressable>
                </>
              ) : (
                <Pressable disabled={recordingLocked} onPress={() => void finishFromAction()} style={pressableFeedback(styles.primaryButton)}>
                  <Body style={styles.primaryText}>{activeWorkout.completedExercises.length ? "Finish workout" : "Discard workout"}</Body>
                </Pressable>
              )}
            </View>
          </View>
        </BottomSheet>
      </Modal>
    </Screen>
  );

  /** A fresh draft for an exercise in a slot: the slot's machine if it fits, then the current or preferred one. */
  function exerciseDraft(exerciseId: number, slot: WorkoutSlot): Partial<ActiveWorkoutExerciseDraft> {
    const exercise = findExercise(exerciseId);
    const nextLoadType = getExerciseLoadType(exercise ?? "");
    const slotProfile = machineProfiles.find((profile) => profile.id === slot.machineProfileId) ?? null;
    const currentProfile = machineProfiles.find((profile) => profile.id === current.machineProfileId) ?? null;
    const machineProfileId = exercise && isMachineLoadType(nextLoadType)
      ? profileAppliesToExercise(slotProfile, exercise.id)
        ? slotProfile?.id ?? null
        : profileAppliesToExercise(currentProfile, exercise.id)
          ? currentProfile?.id ?? null
          : preferredMachineProfile(machineProfiles, exercise.id)?.id ?? null
      : null;
    return {
      exerciseId,
      slotId: slot.id,
      muscle: exercise?.primary_muscle ?? current.muscle,
      machineProfileId,
      requestId: undefined,
      notes: "",
      // Prefilled rows are suggestions until performed; flow mode logs over them.
      sets: exercise ? buildUnconfirmedGuidedSets({
        exercise,
        preferences: guidedWorkoutPreferences,
        sessions,
        sets,
        workoutDate: workout.workoutDate,
        machineProfileId: isMachineLoadType(nextLoadType) ? machineProfileId : null,
        machineScoped: isMachineLoadType(nextLoadType),
        unitSystem
      }).map(plannedSuggestion) : current.sets,
      barWeight: "45",
      plateCounts: createEmptyPlateCounts()
    };
  }

  function chooseExercise(exerciseId: number) {
    if (exerciseId === current.exerciseId) return;
    if (current.exerciseId && hasLoggedSets(current.sets)) {
      setError("Save this exercise, or delete its sets, before switching.");
      return;
    }
    setError(null);
    persist((active) => {
      const { slots, slot } = slotForChosenExercise(active, exerciseId, null);
      return { ...active, slots, currentExercise: withPrescription(active, { ...active.currentExercise, ...exerciseDraft(exerciseId, slot) }) };
    });
  }

  function activateSlot(slot: WorkoutSlot) {
    if (slot.id === current.slotId) return;
    if (current.exerciseId && hasLoggedSets(current.sets)) {
      setError("Save this exercise, or delete its sets, before switching.");
      return;
    }
    setError(null);
    persist((active) => ({ ...active, currentExercise: withPrescription(active, { ...active.currentExercise, ...exerciseDraft(slot.exerciseId, slot) }) }));
  }

  function removeSlot(slotId: string) {
    const removingCurrent = current.slotId === slotId;
    if (removingCurrent && hasLoggedSets(current.sets)) {
      setError("Save this exercise, or delete its sets, before removing it from today's plan.");
      return;
    }
    setError(null);
    persist((active) => {
      const next = removeWorkoutSlot(active, slotId);
      return removingCurrent ? { ...next, currentExercise: emptyActiveExercise() } : next;
    });
  }

  function addSlot(exerciseId: number) {
    setAddingSlot(false);
    persist((active) => appendWorkoutSlot(active, exerciseId, null));
  }

  /** A plan pick from a search or a new exercise; the search is done once it lands. */
  function pickPlanExercise(exerciseId: number) {
    setPlanPicks((picks) => picks.includes(exerciseId) ? picks : [...picks, exerciseId]);
    setPlanQuery("");
    setPlanCreating(false);
  }

  function startPlan() {
    if (!planPicks.length) return;
    persist((active) => planPicks.reduce((next, exerciseId) => appendWorkoutSlot(next, exerciseId, null), active));
    setPlanPicks([]);
    setPlanQuery("");
    setPlanCreating(false);
  }

}

/** The dial offers one machine increment when the tag records it in the display unit, else a common plate step. */
function flowLoadStep(unitSystem: UnitSystem, profile: MachineProfile | null) {
  if (profile && profile.stackUnit === unitSystem && profile.increment > 0) return profile.increment;
  return unitSystem === "kg" ? 2.5 : 5;
}

function formatFlowLoad(load: number) {
  return String(Math.round(load * 100) / 100);
}

/** A first load for an exercise with no history: bodyweight alone, an empty bar, or a light pair. */
function startingFlowLoad(loadType: ExerciseLoadType, unitSystem: UnitSystem, barbell: boolean) {
  if (isBodyweightLoadType(loadType)) return 0;
  if (barbell) return unitSystem === "kg" ? 20 : 45;
  return unitSystem === "kg" ? 10 : 20;
}

function TimerDisplay({ startedAt, now }: { startedAt: string; now: number }) {
  const { palette, styles } = useStyles();
  return (
    <View style={styles.timer}>
      <Timer size={18} color={palette.accent} />
      <Body style={styles.timerText}>{formatElapsedWorkoutTime(startedAt, now)}</Body>
    </View>
  );
}

function loadInstruction(loadType: ExerciseLoadType, bodyWeight: number | undefined, bodyWeightUnit: "lb" | "kg") {
  const basis = bodyWeight ? `Body weight ${formatBodyWeight(bodyWeight, bodyWeightUnit)} is included.` : "Log body weight first to calculate performance.";
  return loadType === "bodyweight_plus_load" ? `Enter added weight only. ${basis}` : `Enter assistance weight. ${basis}`;
}

function loadChangeInstruction(loadType: ExerciseLoadType) {
  return loadType === "bodyweight_minus_assistance" ? "Choose less assistance" : "Choose a heavier load";
}

/** Sets the lifter logged, as opposed to empty rows or suggestions from the plan. */
function hasLoggedSets(sets: LoggedSetDraft[]) {
  return sets.some(isLoggedSet);
}

function hasEnteredSets(sets: LoggedSetDraft[]) {
  return sets.some((set) => set.weight.trim() || set.reps.trim());
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
  asOfDate: string;
}) {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const matching = input.sets
    .filter((set) => set.exercise_id === input.exerciseId && !set.is_warmup)
    .filter((set) => (sessionById.get(set.session_id)?.machine_profile_id ?? null) === (input.machineProfileId ?? null))
    .filter((set) => {
      const date = sessionById.get(set.session_id)?.workout_date;
      return isCalendarDate(date) && isCalendarDate(input.asOfDate) && date <= input.asOfDate;
    })
    .sort((left, right) => {
      const leftDate = sessionById.get(left.session_id)!.workout_date;
      const rightDate = sessionById.get(right.session_id)!.workout_date;
      return leftDate.localeCompare(rightDate) || left.session_id - right.session_id || left.set_number - right.set_number;
    });
  const weight = matching.at(-1)?.weight;
  if (!Number.isFinite(weight)) return null;
  if (input.profile?.stackUnit === "kg") return Number((Number(weight) / 2.2046226218).toFixed(1));
  if (input.profile?.stackUnit === "plate") return Number(weightFromStorageUnit(Number(weight), input.unitSystem).toFixed(1));
  return Number(Number(weight).toFixed(1));
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  titleCopy: { flex: 1, minWidth: 0 },
  flex: { flex: 1, gap: spacing.xs },
  timer: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.accentSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 12 },
  timerText: { color: palette.ink, fontWeight: "900", fontVariant: ["tabular-nums"] },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  guidance: { backgroundColor: palette.surfaceAlt, borderRadius: 10, padding: spacing.md, gap: spacing.xs },
  // Primary action is declared last for reading order, shown first visually.
  actions: { flexDirection: "column-reverse", gap: spacing.sm },
  footerActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  primaryButton: { minHeight: 46, borderRadius: 9, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center", flexDirection: "row", paddingHorizontal: spacing.lg },
  primaryText: { color: palette.surface, fontWeight: "900" },
  secondaryButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: palette.surfaceAlt},
  endButton: { minHeight: 44, borderRadius: 12, backgroundColor: palette.surfaceAlt, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
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
  resetButton: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: "center", paddingHorizontal: spacing.md },
  barInput: { width: 68 },
  loadedBar: { height: 62, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  plateStack: { flexDirection: "row", alignItems: "center", height: 62 },
  plate: { borderRadius: 2, marginHorizontal: 1 },
  sleeve: { width: 14, height: 7, backgroundColor: palette.muted },
  shaft: { width: 98, height: 4, backgroundColor: palette.ink },
  plateControl: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: palette.border, borderRadius: 8, padding: spacing.xs },
  swatch: { width: 8, height: 20, borderRadius: 2 },
  countButton: { width: 26, height: 30, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderRadius: 6 },
  error: { color: palette.danger, fontWeight: "800" },
  sheetBody: { paddingHorizontal: spacing.sm, gap: spacing.md },
  disabledButton: { opacity: 0.45 },
  planChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  planChip: { minHeight: 36, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  planChipCurrent: { backgroundColor: palette.ink, borderColor: palette.ink },
  planChipDone: { backgroundColor: palette.surfaceAlt, borderColor: palette.surfaceAlt },
  planChipLabel: { flexShrink: 1, minHeight: 36, justifyContent: "center" },
  planChipRemove: { width: 20, height: 28, alignItems: "center", justifyContent: "center" },
  planChipText: { color: palette.ink, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  planChipCurrentText: { color: palette.surface },
  planChipDoneText: { color: palette.muted, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  planAdd: { paddingHorizontal: spacing.sm, borderStyle: "dashed" },
  planMeta: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  focusCenter: { flex: 1, justifyContent: "center", gap: spacing.md },
  focusMeta: { color: palette.muted, fontSize: 15, lineHeight: 21 },
  focusScroll: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  focusTitle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.sm, marginBottom: spacing.xl, alignSelf: "center", maxWidth: "100%" },
  focusTitleText: { color: palette.ink, fontSize: 22, fontWeight: "800", textAlign: "center", flexShrink: 1 },
  focusLink: { minHeight: 40, alignItems: "center", justifyContent: "center" },
  focusLinkText: { color: palette.muted, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
  focusSheet: { gap: spacing.md },
  focusNote: { minHeight: 110, textAlignVertical: "top", paddingTop: spacing.sm },
  planSearch: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface },
  planSearchInput: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, color: palette.ink },
  planSearchClear: { minHeight: 32, minWidth: 32, alignItems: "center", justifyContent: "center" },
}));

/** Planned-muscle exercises not yet done in this workout, most recently trained first. */
function suggestedExercises(exercises: Exercise[], plannedMuscles: readonly string[], doneIds: Array<number | null | undefined>, sessions: Array<{ id: number; workout_date: string }>, sets: Array<{ session_id: number; exercise_id: number }>) {
  if (!plannedMuscles.length) return [];
  const lastTrained = new Map<number, string>();
  const dateBySession = new Map(sessions.map((session) => [session.id, session.workout_date]));
  for (const set of sets) {
    const date = dateBySession.get(set.session_id);
    if (date && date > (lastTrained.get(set.exercise_id) ?? "")) lastTrained.set(set.exercise_id, date);
  }
  const done = new Set(doneIds);
  return exercises.filter((exercise) => plannedMuscles.includes(exercise.primary_muscle) && !done.has(exercise.id))
    .sort((a, b) => (lastTrained.get(b.id) ?? "").localeCompare(lastTrained.get(a.id) ?? "") || a.name.localeCompare(b.name));
}
