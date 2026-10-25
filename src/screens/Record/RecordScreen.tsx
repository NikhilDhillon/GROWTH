import { useEffect, useRef, useState } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, ChevronRight, Minus, Plus, Search, Timer, X } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, SectionTitle } from "@/components/Text";
import { getExerciseLoadType } from "@/constants/exercises";
import { isCalendarDate } from "@/domain/calendar";
import { createBodyCheckInDraft, createBodyCheckInRequest, editedBodyCheckInDraft, type BodyCheckInRecordingInput } from "@/screens/BodyCheckIn/bodyCheckInForm";
import { workoutRoute } from "@/navigation/appNavigation";
import { useFitnessStore } from "@/store/useFitnessStore";
import type { BodyMeasurementLog, Exercise, UnitSystem, WorkoutSession, WorkoutSet } from "@/types";
import { formatCompactDate, todayIso } from "@/utils/date";
import { formatLoggedLoad } from "@/utils/logs";
import { createRequestId } from "@/utils/requestId";
import { groupSetsForDisplay } from "@/utils/sessionDisplay";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { bodyWeightFromStorageUnit, formatBodyWeight } from "@/utils/units";
import { formatElapsedWorkoutTime } from "@/utils/workout";

const recentLimit = 6;

/** Fast capture: a weigh-in or a single exercise in as few taps as possible. Workouts start from Home. */
export function RecordScreen() {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (name: string, params?: { checkInId?: number; exerciseId?: number }) => void; setParams: (params: { logged?: string }) => void }>();
  const flowMode = useFitnessStore((state) => state.guidedWorkoutPreferences?.flowMode ?? false);
  const route = useRoute<{ key: string; name: string; params?: { logged?: string } }>();
  const logged = route.params?.logged;
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const exercises = useFitnessStore((state) => state.exercises) ?? [];
  const sessions = useFitnessStore((state) => state.sessions) ?? [];
  const sets = useFitnessStore((state) => state.sets) ?? [];
  const bodyLogs = useFitnessStore((state) => state.bodyMeasurementLogs) ?? [];
  const bodyUnits = useFitnessStore((state) => state.bodyUnitPreferences);
  const unitSystem = useFitnessStore((state) => state.unitSystem) ?? "lb";
  const recordBodyCheckIn = useFitnessStore((state) => state.recordBodyCheckIn);
  const weightUnit = bodyUnits?.weight ?? "lb";
  const today = todayIso();
  const todayLog = bodyLogs.find((log) => log.logged_date === today) ?? null;
  const lastWeighIn = latestWeighIn(bodyLogs, today);
  const suggestedWeight = lastWeighIn?.weight == null ? "" : bodyWeightFromStorageUnit(lastWeighIn.weight, weightUnit).toFixed(1);
  const [weight, setWeight] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);
  // An unacknowledged save keeps its request identity, so a retry can never record twice.
  const [pending, setPending] = useState<BodyCheckInRecordingInput | null>(null);
  const savingRef = useRef(false);
  const accountRef = useRef(currentUser?.id);
  accountRef.current = currentUser?.id;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!activeWorkout) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeWorkout]);

  const weightValue = weight ?? suggestedWeight;
  const recent = recentExercises(sessions, sets, exercises, unitSystem);

  function changeWeight(next: string) {
    if (savingRef.current) return;
    setWeight(next);
    setSavedValue(null);
    setWeightError(null);
    setPending(null);
  }

  function step(amount: number) {
    const current = Number(weightValue.replace(",", "."));
    const base = Number.isFinite(current) && current > 0 ? current : 0;
    changeWeight(Math.max(0, Math.round((base + amount) * 10) / 10).toFixed(1));
  }

  async function saveWeight() {
    if (savingRef.current || !currentUser || !bodyUnits) return;
    let request = pending;
    if (!request) {
      try {
        const draft = todayLog ? editedBodyCheckInDraft(todayLog, bodyUnits) : createBodyCheckInDraft(today, bodyUnits);
        request = createBodyCheckInRequest({ ...draft, weight: weightValue }, createRequestId());
      } catch (error) {
        setWeightError(error instanceof Error ? error.message : "Enter your bodyweight.");
        return;
      }
    }
    const accountId = currentUser.id;
    savingRef.current = true;
    setSaving(true);
    setWeightError(null);
    setPending(request);
    try {
      await recordBodyCheckIn({ ...request, accountId });
      if (accountRef.current !== accountId) return;
      setPending(null);
      setSavedValue(request.weight);
      setWeight(null);
    } catch (error) {
      if (accountRef.current === accountId) setWeightError(error instanceof Error ? error.message : "Could not save. Tap Save to retry the same weigh-in.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const todayWeight = todayLog?.weight == null ? null : formatBodyWeight(todayLog.weight, weightUnit);
  const disabled = saving || !weightValue.trim();
  return (
    <Screen>
      {activeWorkout ? (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate(workoutRoute(flowMode))} style={pressableFeedback(styles.resume)}>
          <Timer size={20} color={palette.surface} />
          <View style={styles.flex}>
            <Body style={styles.resumeTitle}>Resume guided workout</Body>
            <Body style={styles.resumeMeta}>{activeWorkout.workoutLabel ?? activeWorkout.plannedMuscles.join(" / ")} · {formatElapsedWorkoutTime(activeWorkout.startedAt, clock)}</Body>
          </View>
          <ChevronRight size={20} color={palette.surface} />
        </Pressable>
      ) : null}

      {logged ? (
        <View accessibilityRole="alert" style={styles.loggedBanner}>
          <Check size={18} color={palette.surface} />
          <Body style={styles.loggedText}>{logged} logged</Body>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss confirmation" hitSlop={touchHitSlop} onPress={() => navigation.setParams({ logged: undefined })} style={pressableFeedback(styles.dismiss)}>
            <X size={16} color={palette.surface} />
          </Pressable>
        </View>
      ) : null}

      <Panel>
        <View style={styles.cardHeader}>
          <SectionTitle style={styles.flex}>Weigh-in</SectionTitle>
          <Body style={styles.meta}>{todayWeight ? `Today ${todayWeight}` : lastWeighIn ? `Last ${formatBodyWeight(lastWeighIn.weight!, weightUnit)} · ${formatCompactDate(lastWeighIn.logged_date)}` : "First weigh-in"}</Body>
        </View>
        <View style={styles.weightRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Decrease by 0.1 ${weightUnit}`} disabled={saving} hitSlop={touchHitSlop} onPress={() => step(-0.1)} style={pressableFeedback(styles.stepButton)}>
            <Minus size={18} color={palette.ink} />
          </Pressable>
          <View style={styles.weightField}>
            <TextInput accessibilityLabel={`Bodyweight in ${weightUnit}`} value={weightValue} onChangeText={changeWeight} editable={!saving}
              keyboardType="decimal-pad" inputMode="decimal" placeholder="0.0" placeholderTextColor={palette.muted} selectTextOnFocus style={styles.weightInput} />
            <Body style={styles.weightUnit}>{weightUnit}</Body>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Increase by 0.1 ${weightUnit}`} disabled={saving} hitSlop={touchHitSlop} onPress={() => step(0.1)} style={pressableFeedback(styles.stepButton)}>
            <Plus size={18} color={palette.ink} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={todayLog?.weight != null ? "Update today's weight" : "Save today's weight"} disabled={disabled}
          onPress={() => void saveWeight()} style={pressableFeedback([styles.primaryButton, disabled && styles.disabled, savedValue !== null && styles.savedButton])}>
          {saving ? <ActivityIndicator color={palette.surface} /> : savedValue !== null ? <Check size={18} color={palette.surface} /> : null}
          <Body style={styles.primaryText}>{saving ? "Saving" : savedValue !== null ? `Saved ${savedValue} ${weightUnit}` : todayLog?.weight != null ? "Update today" : "Save"}</Body>
        </Pressable>
        {weightError ? <Body accessibilityRole="alert" style={styles.error}>{weightError}</Body> : null}
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("BodyCheckIn", { checkInId: undefined })} style={pressableFeedback(styles.linkRow)}>
          <Body style={styles.linkText}>Record weight or measurements</Body>
          <ChevronRight size={16} color={palette.muted} />
        </Pressable>
      </Panel>

      <Panel style={styles.exercisePanel}>
        <View style={styles.cardHeader}>
          <SectionTitle style={styles.flex}>Log an exercise</SectionTitle>
          <Body style={styles.meta}>Repeats your last session</Body>
        </View>
        {recent.map((item, index) => (
          <Pressable key={item.exerciseId} accessibilityRole="button" accessibilityLabel={`Log ${item.name}`} onPress={() => navigation.navigate("Log", { exerciseId: item.exerciseId })}
            style={pressableFeedback([styles.exerciseRow, index > 0 && styles.divided])}>
            <View style={styles.flex}>
              <Body numberOfLines={1} style={styles.exerciseName}>{item.name}</Body>
              <Body numberOfLines={1} style={styles.meta}>{item.summary} · {formatCompactDate(item.date)}</Body>
            </View>
            <View style={styles.logPill}><Body style={styles.logPillText}>Log</Body></View>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Record completed sets" onPress={() => navigation.navigate("Log")} style={pressableFeedback([styles.exerciseRow, recent.length > 0 && styles.divided])}>
          <View style={styles.searchIcon}><Search size={16} color={palette.ink} /></View>
          <Body style={[styles.flex, styles.exerciseName]}>{recent.length ? "Another exercise" : "Choose an exercise"}</Body>
          <ChevronRight size={18} color={palette.muted} />
        </Pressable>
      </Panel>
    </Screen>
  );
}

function latestWeighIn(logs: BodyMeasurementLog[], asOf: string) {
  return logs.filter((log) => log.weight != null && isCalendarDate(log.logged_date) && log.logged_date <= asOf)
    .reduce<BodyMeasurementLog | null>((latest, log) => !latest || log.logged_date > latest.logged_date ? log : latest, null);
}

/** Most recently trained exercises, each with a compact summary of its last session. */
export function recentExercises(sessions: WorkoutSession[], sets: WorkoutSet[], exercises: Exercise[], unitSystem: UnitSystem, limit = recentLimit) {
  const today = todayIso();
  const ordered = sessions.filter((session) => isCalendarDate(session.workout_date) && session.workout_date <= today)
    .sort((a, b) => b.workout_date.localeCompare(a.workout_date) || b.id - a.id);
  const seen = new Set<number>();
  const result: Array<{ exerciseId: number; name: string; date: string; summary: string }> = [];
  for (const session of ordered) {
    const sessionSets = sets.filter((set) => set.session_id === session.id).sort((a, b) => a.set_number - b.set_number);
    const exerciseId = sessionSets[0]?.exercise_id;
    if (exerciseId === undefined || seen.has(exerciseId)) continue;
    const exercise = exercises.find((item) => item.id === exerciseId);
    if (!exercise) continue;
    seen.add(exerciseId);
    const loadType = getExerciseLoadType(exercise);
    const working = sessionSets.filter((set) => !set.is_warmup).map((set) => ({ reps: set.reps, weight: set.weight, isWarmup: false }));
    const summary = groupSetsForDisplay(working, (value) => formatLoggedLoad(value, loadType, unitSystem))
      .map((group) => `${group.load} × ${group.reps.join(" · ")}`).join(", ");
    result.push({ exerciseId, name: exercise.name, date: session.workout_date, summary: summary || `${sessionSets.length} sets` });
    if (result.length >= limit) break;
  }
  return result;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  intro: { gap: spacing.sm, paddingVertical: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  cardHeader: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  meta: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  loggedBanner: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.xs, borderRadius: 14, backgroundColor: palette.success },
  loggedText: { flex: 1, minWidth: 0, color: palette.surface, fontWeight: "800" },
  dismiss: { width: 40, height: 40, alignItems: "center", justifyContent: "center", ...fastTouchStyle },
  resume: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: 18, backgroundColor: palette.ink, ...fastTouchStyle },
  resumeTitle: { color: palette.surface, fontWeight: "800" },
  resumeMeta: { color: palette.surface, opacity: 0.75, fontSize: 13 },
  weightRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepButton: { width: 52, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt, ...fastTouchStyle },
  weightField: { flex: 1, minWidth: 0, height: 64, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: spacing.md },
  weightInput: { flexShrink: 1, minWidth: 0, width: 120, color: palette.ink, fontSize: 30, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"], paddingVertical: 0 },
  weightUnit: { color: palette.muted, fontSize: 16, fontWeight: "700" },
  primaryButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: 14, backgroundColor: palette.ink, ...fastTouchStyle },
  savedButton: { backgroundColor: palette.success },
  disabled: { opacity: 0.45 },
  primaryText: { color: palette.surface, fontWeight: "800", fontSize: 16 },
  error: { color: palette.danger, fontWeight: "700" },
  linkRow: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, ...fastTouchStyle },
  linkText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  exercisePanel: { gap: 0 },
  exerciseRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, ...fastTouchStyle },
  divided: { borderTopWidth: 1, borderTopColor: palette.border },
  exerciseName: { color: palette.ink, fontWeight: "700", fontSize: 15 },
  logPill: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt },
  logPillText: { color: palette.ink, fontWeight: "800", fontSize: 13 },
  searchIcon: { width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt }
}));
