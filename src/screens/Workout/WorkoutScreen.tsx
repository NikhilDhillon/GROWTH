import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Check, Copy, Save } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { useQuickWorkoutDraft } from "@/hooks/useQuickWorkoutDraft";
import { createQuickWorkoutDraft, QuickWorkoutDraft, quickWorkoutAttempt } from "@/services/workouts/quickWorkoutDraft";
import { prepareWorkoutObservations } from "@/services/workouts/workoutRecording";
import { SearchableExercisePicker } from "@/components/SearchableExercisePicker";
import { MachineProfilePanel } from "@/components/MachineProfilePanel";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle } from "@/components/Text";
import { SetComposerTarget, VisualSetComposer } from "@/components/VisualSetComposer";
import { ExerciseLoadType, getExerciseLoadType, isBodyweightLoadType, isMachineLoadType, supportsBarbellCalculator } from "@/constants/exercises";
import { preferredMachineProfile, profileAppliesToExercise } from "@/constants/machineProfiles";
import { WorkoutValidationError } from "@/database/workoutWrite";
import { isCalendarDate } from "@/domain/calendar";
import { getBodyweightEstimateForDate, getClosestBodyweightForDate } from "@/services/body/bodyWeightService";
import { bodyweightLookupMessage } from "@/services/workouts/recordingContext";
import { calculateSessionPerformance, findStrengthReference, performanceHistoryForContext } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { LoggedSetDraft, MachineProfile, MuscleGroup, WorkoutSet } from "@/types";
import { createRequestId } from "@/utils/requestId";
import { confirmDeletion } from "@/utils/deletion";
import { sameStoredJson } from "@/database/workoutWrite";
import { todayIso } from "@/utils/date";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatBodyWeight, formatWeightInput, weightFromStorageUnit, weightToStorageUnit } from "@/utils/units";
import { createEmptyPlateCounts } from "@/utils/workout";
import { latestSetsForExercise } from "@/utils/workoutHistory";

const emptySet = (): LoggedSetDraft => ({ reps: "", weight: "" });
type SaveState = "idle" | "saving" | "saved";

export function WorkoutScreen() {
  const { palette, styles } = useStyles();
  const allExercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const bodyWeightLogs = useFitnessStore((state) => state.bodyWeightLogs);
  const bodyWeightUnit = useFitnessStore((state) => state.bodyUnitPreferences.weight);
  const machineProfiles = useFitnessStore((state) => state.machineProfiles);
  const saveWorkout = useFitnessStore((state) => state.saveWorkout);
  const saveMachineProfile = useFitnessStore((state) => state.saveMachineProfile);
  const deleteMachineProfile = useFitnessStore((state) => state.deleteMachineProfile);
  const preferredUnitSystem = useFitnessStore((state) => state.unitSystem);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const exercises = allExercises;
  const route = useRoute<{ key: string; name: string; params?: { exerciseId?: number } }>();
  const navigation = useNavigation<{ setParams: (params: { exerciseId?: number }) => void; navigate: (route: "Record", params: { logged?: string }) => void }>();
  /** Entries opened from Record return there once saved, so a routine log is two taps. */
  const returnToRecordRef = useRef(false);
  const requestedExerciseId = route.params?.exerciseId;
  const defaults = useMemo(() => createQuickWorkoutDraft(String(currentUser?.id ?? ""), preferredUnitSystem, todayIso(), exercises[0]?.id ?? null, exercises[0]?.primary_muscle ?? "Chest"), [currentUser?.id]);
  const recovery = useQuickWorkoutDraft(currentUser?.id, defaults);
  const { draft, setDraft, ready } = recovery;
  const { selectedMuscle, exerciseId, seededHistoryKey, sets: draftSets, barWeight, plateCounts, workoutDate, notes, machineProfileId: selectedMachineProfileId } = draft;
  function field<K extends keyof QuickWorkoutDraft>(key: K, next: QuickWorkoutDraft[K] | ((previous: QuickWorkoutDraft[K]) => QuickWorkoutDraft[K])) {
    setDraft((current) => ({ ...current, [key]: typeof next === "function" ? (next as (previous: QuickWorkoutDraft[K]) => QuickWorkoutDraft[K])(current[key]) : next }));
  }
  const setSelectedMuscle = (value: MuscleGroup) => field("selectedMuscle", value);
  const setExerciseId = (value: number | null) => field("exerciseId", value);
  const setSeededHistoryKey = (value: string | null) => field("seededHistoryKey", value);
  const setDraftSets = (value: LoggedSetDraft[]) => field("sets", value);
  const setBarWeight = (value: string) => field("barWeight", value);
  const setPlateCounts = (value: Record<string, number>) => field("plateCounts", value);
  const setWorkoutDate = (value: string) => field("workoutDate", value);
  const setNotes = (value: string) => field("notes", value);
  const setSelectedMachineProfileId = (value: string | null | ((previous: string | null) => string | null)) => field("machineProfileId", value);
  const [workoutSaveState, setWorkoutSaveState] = useState<SaveState>("idle");
  const [workoutError, setWorkoutError] = useState<string | null>(null);
  const [changingExercise, setChangingExercise] = useState(false);
  /** Exercise opened from Record whose last sets should be filled in once it is selected. */
  const [repeatExerciseId, setRepeatExerciseId] = useState<number | null>(null);
  const selectionRef = useRef(false);
  const savingRef = useRef(false);
  const committedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const unitSystem = draft.unitSystem;
  const pendingSave = draft.pending !== null;
  const locked = !ready || pendingSave || workoutSaveState === "saving" || changingExercise;

  useEffect(() => {
    committedRef.current = false;
    setWorkoutSaveState("idle");
    setWorkoutError(null);
  }, [currentUser?.id]);

  function editDraft(update: () => void) {
    if (!ready || savingRef.current || selectionRef.current || draftRef.current.pending !== null) {
      setWorkoutError("A save is pending. Retry these same values before changing the entry.");
      return;
    }
    // A new operation starts only after a deliberate edit, never a late second tap.
    if (committedRef.current) {
      committedRef.current = false;
      setWorkoutSaveState("idle");
    }
    setWorkoutError(null);
    update();
  }

  async function selectExercise(nextId: number | null, nextMuscle: MuscleGroup) {
    if (!ready || savingRef.current || selectionRef.current || draftRef.current.pending) return;
    const previous = draftRef.current;
    if (previous.exerciseId === nextId) return;
    const accountId = currentUser?.id;
    selectionRef.current = true;
    setChangingExercise(true);
    try {
      const hasInput = previous.sets.some((set) => set.reps.trim() || set.weight.trim() || set.isWarmup)
        || previous.notes.trim() || previous.barWeight !== defaults.barWeight || Object.values(previous.plateCounts).some((count) => count > 0);
      if (hasInput && !await confirmDeletion({ title: "Replace entered workout?", message: "Changing the exercise discards this draft's entered sets, notes and calculator input. Replace this input?", confirmLabel: "Replace input" })) return;
      if (useFitnessStore.getState().currentUser?.id !== accountId || !sameStoredJson(draftRef.current, previous)) throw new Error("The account or workout input changed. Review it before switching exercises.");
      const next = { ...previous, exerciseId: nextId, selectedMuscle: nextMuscle, seededHistoryKey: null,
        sets: [emptySet(), emptySet(), emptySet()], notes: "", barWeight: defaults.barWeight,
        plateCounts: createEmptyPlateCounts(), machineProfileId: null };
      draftRef.current = next;
      setDraft(next);
      committedRef.current = false;
      setWorkoutSaveState("idle");
      setWorkoutError(null);
    } catch (error) { if (useFitnessStore.getState().currentUser?.id === accountId) setWorkoutError(error instanceof Error ? error.message : "The exercise could not be changed."); }
    finally { selectionRef.current = false; setChangingExercise(false); }
  }

  useEffect(() => {
    if (!ready || savingRef.current || draftRef.current.pending !== null) return;
    if (draftRef.current.sets.some((set) => set.reps.trim() || set.weight.trim()) || draftRef.current.notes) return;
    const selectedExists = exercises.some((exercise) => exercise.id === exerciseId);
    if (selectedExists) return;
    const nextExercise = exercises[0] ?? null;
    setSelectedMuscle(nextExercise?.primary_muscle ?? "Chest");
    setExerciseId(nextExercise?.id ?? null);
  }, [exerciseId, exercises, ready]);

  const selectedExercise = allExercises.find((exercise) => exercise.id === exerciseId) ?? null;
  const selectedLoadType = getExerciseLoadType(selectedExercise?.name ?? "");
  const showBarbellCalculator = supportsBarbellCalculator(selectedExercise?.name ?? "");
  const selectedBodyWeight = isBodyweightLoadType(selectedLoadType) ? getClosestBodyweightForDate(workoutDate, bodyWeightLogs) : null;
  const selectedMachineProfile = machineProfiles.find((profile) => profile.id === selectedMachineProfileId) ?? null;
  const previousSets = useMemo(() => {
    if (!selectedExercise || !isCalendarDate(workoutDate)) return [];
    return latestSetsForExercise({
      exerciseId: selectedExercise.id,
      sessions,
      sets,
      asOfDate: workoutDate,
      machineProfileId: isMachineLoadType(selectedLoadType) ? selectedMachineProfileId : null,
      machineScoped: isMachineLoadType(selectedLoadType),
      includeWarmups: true
    });
  }, [selectedExercise, selectedLoadType, selectedMachineProfileId, sessions, sets, workoutDate]);
  const lastMachineLoad = useMemo(() => {
    if (!selectedExercise || !isMachineLoadType(selectedLoadType) || !isCalendarDate(workoutDate)) return null;
    const matchingSets = latestSetsForExercise({
      exerciseId: selectedExercise.id,
      sessions,
      sets,
      asOfDate: workoutDate,
      machineProfileId: selectedMachineProfileId,
      machineScoped: true
    });
    return storageWeightToMachineLoad(matchingSets.at(-1)?.weight, selectedMachineProfile, unitSystem);
  }, [selectedExercise, selectedLoadType, selectedMachineProfile, selectedMachineProfileId, sessions, sets, unitSystem, workoutDate]);
  const composerTargets = useMemo<SetComposerTarget[]>(() => {
    return previousSets.map((set, index) => ({
      draftIndex: index,
      weight: set.weight,
      targetReps: set.reps,
      label: "last"
    }));
  }, [previousSets]);

  useEffect(() => {
    if (!ready || savingRef.current || draftRef.current.pending !== null) return;
    if (selectedExercise && isMachineLoadType(selectedLoadType) && selectedMachineProfileId === null && preferredMachineProfile(machineProfiles, selectedExercise.id)) return;
    const historyKey = selectedExercise
      ? `${selectedExercise.id}:${isMachineLoadType(selectedLoadType) ? selectedMachineProfileId ?? "no-machine" : "all"}`
      : null;
    if (!selectedExercise || seededHistoryKey === historyKey || draftRef.current.sets.some((set) => set.reps.trim() || set.weight.trim())) return;
    setDraftSets(blankWorkoutSets(previousSets));
    setBarWeight("45");
    setPlateCounts(createEmptyPlateCounts());
    setSeededHistoryKey(historyKey);
  }, [previousSets, seededHistoryKey, selectedExercise, selectedLoadType, selectedMachineProfileId, machineProfiles, unitSystem, ready]);

  // Opening from Record with an exercise selects it (asking before replacing entered input)
  // and repeats its last session, so a routine entry is one tap away from saved.
  useEffect(() => {
    if (!ready || requestedExerciseId === undefined) return;
    navigation.setParams({ exerciseId: undefined });
    const requested = exercises.find((exercise) => exercise.id === requestedExerciseId);
    if (!requested || draftRef.current.pending !== null) return;
    setRepeatExerciseId(requested.id);
    returnToRecordRef.current = true;
    if (draftRef.current.exerciseId !== requested.id) void selectExercise(requested.id, requested.primary_muscle);
  }, [ready, requestedExerciseId]);

  useEffect(() => {
    if (repeatExerciseId === null || repeatExerciseId !== exerciseId || changingExercise || !ready || draftRef.current.pending !== null) return;
    if (selectedExercise && isMachineLoadType(selectedLoadType) && selectedMachineProfileId === null && preferredMachineProfile(machineProfiles, selectedExercise.id)) return;
    setRepeatExerciseId(null);
    if (!previousSets.length || draftRef.current.sets.some((set) => set.reps.trim() || set.weight.trim())) return;
    setDraftSets(previousSets.map((set) => ({ reps: String(set.reps), weight: formatWeightInput(set.weight, unitSystem), isWarmup: Boolean(set.is_warmup) })));
  }, [repeatExerciseId, exerciseId, changingExercise, previousSets, ready, selectedMachineProfileId]);

  useEffect(() => {
    if (!ready || savingRef.current || draftRef.current.pending !== null) return;
    if (draftRef.current.sets.some((set) => set.reps.trim() || set.weight.trim()) || draftRef.current.notes) return;
    if (!selectedExercise || !isMachineLoadType(selectedLoadType)) {
      setSelectedMachineProfileId(null);
      return;
    }
    setSelectedMachineProfileId((current) => {
      const currentProfile = machineProfiles.find((profile) => profile.id === current) ?? null;
      if (profileAppliesToExercise(currentProfile, selectedExercise.id)) return current;
      return preferredMachineProfile(machineProfiles, selectedExercise.id)?.id ?? null;
    });
  }, [machineProfiles, selectedExercise, selectedLoadType, ready]);

  const projectedPerformance = useMemo(() => {
    const reference = selectedExercise
      ? findStrengthReference(performanceHistoryForContext(exercisePoints, { exerciseId: selectedExercise.id, asOfDate: workoutDate, loadType: selectedLoadType, machineProfileId: selectedMachineProfileId, sessions }))
      : undefined;
    return calculateSessionPerformance(
      draftSets
        .filter((set) => !set.isWarmup)
        .map((set, index) => ({ reps: Number(set.reps), weight: Number(set.weight), set_number: index + 1 }))
        .map((set) => ({ ...set, weight: weightToStorageUnit(set.weight, unitSystem) }))
        .filter((set) => set.reps > 0 || set.weight > 0),
      reference,
      { loadType: selectedLoadType, bodyWeight: selectedBodyWeight?.weight }
    );
  }, [draftSets, exercisePoints, selectedBodyWeight?.weight, selectedExercise, selectedLoadType, selectedMachineProfileId, sessions, unitSystem, workoutDate]);

  async function handleSave() {
    if (!selectedExercise || !ready || savingRef.current || selectionRef.current || committedRef.current) return;
    const initiatingAccount = currentUser?.id;
    const newAttempt = draftRef.current.pending === null;
    const attempt = draftRef.current.pending ?? quickWorkoutAttempt({ ...draftRef.current, machineProfileId: isMachineLoadType(selectedLoadType) ? selectedMachineProfileId : null }, createRequestId());
    if (newAttempt) {
      try { prepareWorkoutObservations(attempt, useFitnessStore.getState().exercises.find((exercise) => exercise.id === attempt.exerciseId), attempt.unitSystem); }
      catch (error) { setWorkoutError(error instanceof Error ? error.message : "Check the entered observations."); return; }
    }
    savingRef.current = true;
    const frozen = { ...draftRef.current, machineProfileId: attempt.machineProfileId, pending: attempt };
    draftRef.current = frozen;
    setWorkoutSaveState("saving");
    setWorkoutError(null);
    let submitted = false;
    try {
      await recovery.flushDraft(frozen);
      if (useFitnessStore.getState().currentUser?.id !== initiatingAccount) throw new Error("Your account changed. The original account's draft remains recoverable.");
      submitted = true;
      await saveWorkout(attempt);
      if (useFitnessStore.getState().currentUser?.id !== initiatingAccount) return;
      committedRef.current = true;
      setWorkoutSaveState("saved");
      try {
        const next = { ...frozen, sets: [emptySet(), emptySet(), emptySet()], notes: "", pending: null };
        await recovery.clearDraft(next);
        draftRef.current = next;
        if (returnToRecordRef.current) {
          returnToRecordRef.current = false;
          navigation.navigate("Record", { logged: selectedExercise.name });
        }
      } catch (error) {
        setWorkoutError(`Workout saved. Draft cleanup failed: ${error instanceof Error ? error.message : "Retry cleanup before entering another workout."}`);
      }
    } catch (error) {
      if (useFitnessStore.getState().currentUser?.id !== initiatingAccount) return;
      // Only a new pre-write validation rejection can release the attempted ID.
      if (error instanceof WorkoutValidationError && newAttempt && submitted) {
        try { const next = { ...frozen, pending: null }; await recovery.flushDraft(next); draftRef.current = next; } catch { /* Recovery evidence remains frozen if cleanup fails. */ }
      }
      setWorkoutSaveState("idle");
      setWorkoutError(error instanceof Error ? error.message : "Could not save workout.");
    } finally { savingRef.current = false; }
  }

  async function cleanupAcknowledgedDraft() {
    try {
      await recovery.clearDraft({ ...draftRef.current, sets: [emptySet(), emptySet(), emptySet()], notes: "", pending: null });
      setWorkoutError(null);
    } catch (error) { setWorkoutError(`Workout saved. ${error instanceof Error ? error.message : "Draft cleanup failed."}`); }
  }

  function duplicatePrevious() {
    if (!previousSets.length) return;
    editDraft(() => setDraftSets(previousSets.map((set) => ({ reps: String(set.reps), weight: formatWeightInput(set.weight, unitSystem), isWarmup: Boolean(set.is_warmup) }))));
  }

  return (
    <Screen>

      {!ready ? <Panel><Body>Loading your recoverable Quick workout draft…</Body></Panel> : null}
      {recovery.recoveryError ? <Panel><Body accessibilityRole="alert">{recovery.recoveryError}</Body><Pressable accessibilityRole="button" onPress={() => void recovery.reloadDraft().catch((error) => setWorkoutError(error.message))} style={pressableFeedback(styles.primaryButton)}><Body style={styles.primaryButtonText}>Reload saved draft</Body></Pressable></Panel> : null}
      {ready && exerciseId !== null && !selectedExercise ? <Panel><Body accessibilityRole="alert">This draft refers to an unavailable exercise. Its entered values are preserved; choose a valid exercise to continue.</Body></Panel> : null}
      <Panel>
        <SearchableExercisePicker exercises={exercises} selectedId={exerciseId} disabled={locked} onSelect={(id) => {
          const exercise = exercises.find((item) => item.id === id);
          if (exercise) return selectExercise(id, exercise.primary_muscle);
        }} />

      </Panel>

      <Panel>
        <SectionTitle>Workout date</SectionTitle>
        {locked ? <Body>{workoutDate}</Body> : <DatePickerField value={workoutDate} onChange={(value) => editDraft(() => setWorkoutDate(value))} />}
      </Panel>

      {!exercises.length ? (
        <Panel>
          <SectionTitle>No exercises available</SectionTitle>
          <Body>The exercise library is empty.</Body>
        </Panel>
      ) : (
      <Panel>
        <View style={styles.rowBetween}>
          <View>
            <SectionTitle>Working sets</SectionTitle>
            {projectedPerformance ? <Label>Projected e1RM · {projectedPerformance.estimated1RM.toFixed(1)}</Label> : null}
          </View>
          <Pressable accessibilityRole="button" disabled={locked || !previousSets.length} accessibilityLabel="Use previous sets" hitSlop={touchHitSlop} onPress={duplicatePrevious} style={pressableFeedback(styles.reuseButton)}>
            <Copy size={15} color={palette.ink} />
            <Body style={styles.buttonText}>Use previous sets</Body>
          </Pressable>
        </View>

        {isBodyweightLoadType(selectedLoadType) ? <Body style={styles.loadHint}>{loadInstruction(selectedLoadType, selectedBodyWeight?.weight, bodyWeightUnit)}</Body> : null}
        {isBodyweightLoadType(selectedLoadType) ? <Body>{bodyweightLookupMessage(getBodyweightEstimateForDate(workoutDate, bodyWeightLogs), bodyWeightUnit)}</Body> : null}

        {isMachineLoadType(selectedLoadType) && selectedExercise ? (
          <MachineProfilePanel
            profiles={machineProfiles}
            selectedProfileId={selectedMachineProfileId}
            exerciseId={selectedExercise.id}
            exerciseName={selectedExercise.name}
            unitSystem={unitSystem}
            lastLoad={lastMachineLoad}
            onSelectProfile={(profileId) => editDraft(() => setSelectedMachineProfileId(profileId))}
            onSaveProfile={saveMachineProfile}
            onDeleteProfile={deleteMachineProfile}
          />
        ) : null}

        <VisualSetComposer
          sets={draftSets}
          loadType={selectedLoadType}
          unitSystem={unitSystem}
          supportsBarbell={showBarbellCalculator}
          barWeight={barWeight}
          plateCounts={plateCounts}
          targets={composerTargets}
          disabled={locked}
          onBarWeightChange={(value) => editDraft(() => setBarWeight(value))}
          onPlateCountsChange={(value) => editDraft(() => setPlateCounts(value))}
          onSetsChange={(value) => editDraft(() => setDraftSets(value))}
        />

        {pendingSave ? <Body>A save is pending. Its values use {unitSystem} and stay unchanged while you retry.</Body> : null}
        {committedRef.current && pendingSave ? <Pressable accessibilityRole="button" onPress={() => void cleanupAcknowledgedDraft()} style={pressableFeedback(styles.primaryButton)}><Body style={styles.primaryButtonText}>Retry draft cleanup</Body></Pressable> : null}
        {workoutError ? <Body accessibilityRole="alert" style={styles.errorText}>{workoutError}</Body> : null}
        <Pressable accessibilityRole="button" disabled={!ready || !selectedExercise || workoutSaveState === "saving" || workoutSaveState === "saved"} hitSlop={touchHitSlop} style={pressableFeedback(styles.primaryButton)} onPress={handleSave}>
          {workoutSaveState === "saving" ? <ActivityIndicator color={palette.surface} /> : workoutSaveState === "saved" ? <Check size={19} color={palette.surface} /> : <Save size={19} color={palette.surface} />}
          <Body style={styles.primaryButtonText}>{workoutSaveState === "saving" ? "Saving" : workoutSaveState === "saved" ? "Added" : pendingSave ? "Retry save" : "Save workout"}</Body>
        </Pressable>

        <DetailsDisclosure title="Add workout notes">
          <TextInput accessibilityLabel="Workout notes" style={[styles.input, styles.notes]} value={notes} editable={!locked} onChangeText={(value) => editDraft(() => setNotes(value))} multiline placeholder="Optional context" />
        </DetailsDisclosure>
        {projectedPerformance ? (
          <View style={styles.performanceSummary}>
            <Label>Current estimate</Label>
            <View style={styles.performanceValues}>
              <Body>e1RM {projectedPerformance.estimated1RM.toFixed(1)}</Body>
              <Body>Volume {projectedPerformance.failureVolume.toFixed(1)}</Body>
              <Body>Resistance {(projectedPerformance.fatigueResistance * 100).toFixed(0)}%</Body>
            </View>
            <DetailsDisclosure title="About these estimates">
              <Body>Estimates update from entered working sets. They are feedback, not recorded results or prescribed targets.</Body>
            </DetailsDisclosure>
          </View>
        ) : isBodyweightLoadType(selectedLoadType) && !selectedBodyWeight ? <Body>Bodyweight is unavailable for this date.</Body> : null}
      </Panel>
      )}
    </Screen>
  );

}

function loadInstruction(loadType: ExerciseLoadType, bodyWeight: number | undefined, bodyWeightUnit: "lb" | "kg") {
  const basis = bodyWeight ? `Body weight ${formatBodyWeight(bodyWeight, bodyWeightUnit)} is included in feedback.` : "Record recent bodyweight to calculate feedback. Sets can still be saved.";
  if (loadType === "bodyweight_plus_load") return `Enter added weight only; use 0 for bodyweight reps. ${basis}`;
  return `Enter assistance weight; use 0 for unassisted reps. ${basis}`;
}

function storageWeightToMachineLoad(weight: number | undefined, profile: MachineProfile | null, unitSystem: "lb" | "kg") {
  if (!Number.isFinite(weight)) return null;
  if (profile?.stackUnit === "kg") return Number((Number(weight) / 2.2046226218).toFixed(1));
  if (profile?.stackUnit === "plate") return Number(weightFromStorageUnit(Number(weight), unitSystem).toFixed(1));
  return Number(Number(weight).toFixed(1));
}

function blankWorkoutSets(previousSets: WorkoutSet[]) {
  if (!previousSets.length) return [emptySet(), emptySet(), emptySet()];
  return previousSets.map((set) => ({
    reps: "",
    weight: "",
    isWarmup: Boolean(set.is_warmup)
  }));
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  exerciseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  exerciseButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  exerciseButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  exerciseText: {
    color: palette.ink,
    fontWeight: "800"
  },
  exerciseTextActive: {
    color: palette.surface
  },
  rowBetween: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0
  },
  performanceSummary: { gap: spacing.xs, backgroundColor: palette.surfaceAlt, borderRadius: 8, padding: spacing.md },
  performanceValues: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  reuseButton: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: 999, backgroundColor: palette.surfaceAlt,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    width: "100%",
    minWidth: 0
  },
  setNumber: {
    width: 18,
    textAlign: "center",
    flexShrink: 0
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  setInput: {
    flexBasis: 0,
    paddingHorizontal: spacing.sm
  },
  kindButton: {
    minHeight: 40,
    flexShrink: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    justifyContent: "center",
    paddingHorizontal: spacing.xs
  },
  kindButtonActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent
  },
  kindText: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "800"
  },
  kindTextActive: {
    color: palette.accent
  },
  loadHint: {
    color: palette.muted
  },
  barCalculator: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt
  },
  resetButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  barWeightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  barWeightInput: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 88,
    minWidth: 88,
    width: 88,
    paddingHorizontal: spacing.sm
  },
  loadedBar: {
    minHeight: 58,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center"
  },
  barShaft: {
    width: 84,
    height: 6,
    backgroundColor: palette.muted
  },
  barSleeve: {
    width: 16,
    height: 10,
    backgroundColor: palette.ink
  },
  plateStack: {
    minWidth: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2
  },
  rightPlateStack: {
    justifyContent: "flex-start"
  },
  plate: {
    borderRadius: 3
  },
  plateControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  plateControl: {
    flexGrow: 1,
    minWidth: 94,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: spacing.xs,
    gap: spacing.xs,
    alignItems: "center",
    backgroundColor: palette.surface
  },
  plateText: {
    fontWeight: "900"
  },
  plateLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  plateSwatch: {
    width: 11,
    height: 11,
    borderRadius: 6
  },
  countControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  countButton: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  countText: {
    minWidth: 12,
    textAlign: "center",
    fontWeight: "900"
  },
  applySetButtons: {
    gap: spacing.sm
  },
  notes: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: spacing.md
  },
  iconButton: {
    width: 42,
    height: 42,
    flexShrink: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    ...fastTouchStyle
  },
  removeButton: {
    width: 40,
    height: 40
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle,
    backgroundColor: palette.surfaceAlt
  },
  buttonText: {
    color: palette.ink,
    fontWeight: "800"
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
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
}));
