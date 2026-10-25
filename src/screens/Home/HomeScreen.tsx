import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ChevronRight, Dumbbell, Pencil, Timer } from "lucide-react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { Button } from "@/components/Button";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { createActiveWorkout } from "@/constants/activeWorkout";
import { workoutRoute } from "@/navigation/appNavigation";
import { useFitnessStore } from "@/store/useFitnessStore";
import { WorkoutTemplate } from "@/domain/types";
import type { ActiveWorkout, SplitMuscle, TrainingSplitDay } from "@/types";
import { projectTrainingPlan } from "@/domain/planning";
import { todaySplitDay } from "@/constants/activeWorkout";
import { workoutTemplates } from "@/constants/workoutTemplates";
import { SplitEditorSheet } from "@/screens/Home/SplitEditorSheet";
import { templateExerciseKey } from "@/services/workouts/templateExercises";
import { slotsFromTemplate } from "@/services/workouts/workoutSlots";
import { dateToVancouverIso, formatShortDate } from "@/utils/date";
import { dayName, nextTrainingDay, sameMuscles, scheduledDays } from "@/utils/schedule";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";
import { formatElapsedWorkoutTime } from "@/utils/workout";

export function HomeScreen() {
  const { palette, styles } = useStyles();
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const trainingSplit = useFitnessStore((state) => state.trainingSplit);
  const plannedTemplates = projectTrainingPlan(trainingSplit).templates;
  const today = todaySplitDay(trainingSplit.days);
  const todayTemplate = plannedTemplates.find((template) => template.id === `legacy-weekday:${today?.key}`) ?? null;
  const isRestDay = Boolean(today) && !today?.muscles.length;
  const nextDay = nextTrainingDay(trainingSplit.days, today?.key);
  // The weekly schedule only repeats the three built-in workouts, so offer those once each.
  const suggestedMuscles = today?.muscles.length ? today.muscles : nextDay?.muscles ?? [];
  const suggestedTemplate = workoutTemplates.find((template) => sameMuscles(template.muscles, suggestedMuscles)) ?? null;
  const workoutOptions = suggestedTemplate ? [suggestedTemplate, ...workoutTemplates.filter((template) => template !== suggestedTemplate)] : workoutTemplates;
  const startActiveWorkout = useFitnessStore((state) => state.startActiveWorkout);
  const templateExercises = useFitnessStore((state) => state.templateExercises) ?? {};
  const exercises = useFitnessStore((state) => state.exercises);
  // A friend's exercise that is no longer shared drops out of the plan rather than showing unnamed.
  const plannedExercises = (muscles: readonly SplitMuscle[]) => (templateExercises[templateExerciseKey(muscles)] ?? [])
    .filter((item) => exercises.some((exercise) => exercise.id === item.exerciseId));
  const todayPlanCount = today?.muscles.length ? plannedExercises(today.muscles).length : 0;
  const reloadSavedWorkoutDraft = useFitnessStore((state) => state.reloadSavedWorkoutDraft);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const saveTrainingSplit = useFitnessStore((state) => state.saveTrainingSplit);
  const socialData = useFitnessStore((state) => state.socialData);
  const loadSocial = useFitnessStore((state) => state.loadSocial);
  const syncedFriendNames = socialData.friends
    .filter((friend) => friend.status === "accepted" && socialData.syncMemberIds?.includes(friend.id))
    .map((friend) => friend.name);
  const navigation = useNavigation<{ navigate: (route: string, params?: { checkInId?: number }) => void }>();
  const flowMode = useFitnessStore((state) => state.guidedWorkoutPreferences?.flowMode ?? false);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);
  const [showSplitEditor, setShowSplitEditor] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [startAttempt, setStartAttempt] = useState<{ accountId: string | number; optionId: string; workout: ActiveWorkout } | null>(null);
  const attemptRef = useRef<typeof startAttempt>(null);
  const accountRef = useRef(currentUser?.id);
  accountRef.current = currentUser?.id;
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!activeWorkout) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeWorkout]);

  function openWorkout() {
    if (activeWorkout) {
      navigation.navigate(workoutRoute(flowMode));
      return;
    }
    if (todayTemplate) {
      void startWorkout(todayTemplate);
      return;
    }
    setShowWorkoutPicker(true);
  }

  async function startWorkout(option: WorkoutTemplate) {
    if (startingRef.current) return;
    const accountId = currentUser?.id;
    if (!accountId) return;
    const pending = attemptRef.current;
    if (pending && (pending.accountId !== accountId || pending.optionId !== option.id)) {
      setStartError("Retry the original start or review the saved draft before choosing a different template.");
      return;
    }
    const next = pending ?? { accountId, optionId: option.id, workout: createActiveWorkout({ key: option.id, label: option.label, muscles: option.muscles }, option.label, option.id,
      slotsFromTemplate(plannedExercises(option.muscles))) };
    attemptRef.current = next;
    setStartAttempt(next);
    startingRef.current = true;
    setIsStarting(true);
    setStartError(null);
    try {
      await startActiveWorkout(next.workout);
      if (accountRef.current !== accountId) return;
      attemptRef.current = null;
      setStartAttempt(null);
      setShowWorkoutPicker(false);
      navigation.navigate(workoutRoute(flowMode));
    } catch (failure) {
      if (accountRef.current === accountId) setStartError(failure instanceof Error ? failure.message : "Could not start workout. Try again.");
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }

  function openSplitEditor() {
    // Refresh who receives the split so the editor names the right friends.
    void loadSocial();
    setShowSplitEditor(true);
  }

  async function saveSplit(days: TrainingSplitDay[]) {
    await saveTrainingSplit(days);
    setShowSplitEditor(false);
  }

  async function reviewSavedDraft() {
    if (startingRef.current) return;
    const accountId = currentUser?.id;
    startingRef.current = true;
    setIsStarting(true);
    try {
      await reloadSavedWorkoutDraft();
      if (accountRef.current !== accountId) return;
      attemptRef.current = null;
      setStartAttempt(null);
      setShowWorkoutPicker(false);
      setStartError(null);
    } catch (failure) {
      if (accountRef.current === accountId) setStartError(failure instanceof Error ? failure.message : "Could not load the saved draft. Retry the original start.");
    } finally { startingRef.current = false; setIsStarting(false); }
  }

  return (
    <Screen>
      <View style={styles.intro}>
        <Label>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</Label>
        <Title>Let’s make progress.</Title>
      </View>

      <Panel style={styles.heroPanel}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Label>{activeWorkout ? "In progress" : isRestDay ? "Today" : "Your next session"}</Label>
            <Title style={styles.heroTitle}>{activeWorkout ? activeWorkout.workoutLabel ?? activeWorkout.plannedMuscles.join(" / ") : today?.muscles.length ? today.muscles.join(" / ") : isRestDay ? "Rest day" : "Ready when you are"}</Title>
            <Body>{activeWorkout ? `${formatElapsedWorkoutTime(activeWorkout.startedAt, clock)} elapsed` : today?.muscles.length ? `${today.label} · ${todayPlanCount ? `${todayPlanCount} ${todayPlanCount === 1 ? "exercise" : "exercises"} planned` : "Saved schedule"}` : isRestDay && nextDay ? `Recover today. Next up: ${dayName(nextDay.key)} · ${nextDay.muscles.join(" / ")}` : "Choose a workout to get started"}</Body>
          </View>
          <View style={styles.heroIcon}>{activeWorkout ? <Timer size={26} color={palette.accent} /> : <Dumbbell size={26} color={palette.accent} />}</View>
        </View>
        <Pressable accessibilityRole="button" onPress={openWorkout} style={pressableFeedback(styles.startButton)}>
          <Body style={styles.startText}>{activeWorkout ? "Resume workout" : isRestDay ? "Train anyway" : "Start workout"}</Body>
          <ChevronRight size={21} color={palette.surface} />
        </Pressable>
        {!activeWorkout && todayTemplate ? <Pressable accessibilityRole="button" disabled={isStarting} onPress={() => setShowWorkoutPicker(true)} style={pressableFeedback(styles.chooseWorkoutButton)}><Body style={styles.chooseWorkoutText}>Choose another workout</Body></Pressable> : null}
        {startError ? <Body accessibilityRole="alert">{startError}</Body> : null}
        {startAttempt && startError ? <Pressable accessibilityRole="button" disabled={isStarting} onPress={() => void reviewSavedDraft()} style={pressableFeedback(styles.bodyButton)}><Body style={styles.optionTitle}>Review saved workout draft</Body></Pressable> : null}
      </Panel>

      <View style={styles.shortcuts}>
        <Pressable accessibilityRole="button" accessibilityLabel="Record body check-in" onPress={() => navigation.navigate("BodyCheckIn", { checkInId: undefined })} style={pressableFeedback(styles.shortcut)}>
          <View style={styles.shortcutIcon}><Body style={styles.shortcutGlyph}>＋</Body></View>
          <SectionTitle>Check-in</SectionTitle>
          <Body>Weight &amp; measurements</Body>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Progress" onPress={() => navigation.navigate("Progress")} style={pressableFeedback(styles.shortcut)}>
          <View style={styles.shortcutIcon}><Body style={styles.shortcutGlyph}>↗</Body></View>
          <SectionTitle>Progress</SectionTitle>
          <Body>Your growth at a glance</Body>
        </Pressable>
      </View>

      <Panel>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <SectionTitle>This week</SectionTitle>
            <Body>{trainingSplit.days.filter((day) => day.muscles.length).length} training days{syncedFriendNames.length ? ` · Shared with ${syncedFriendNames.length === 1 ? syncedFriendNames[0] : `${syncedFriendNames.length} friends`}` : ""}</Body>
            {trainingSplit.updated_at && trainingSplit.updated_by ? <Body style={styles.updatedText}>Updated {formatShortDate(dateToVancouverIso(new Date(trainingSplit.updated_at)))} by {trainingSplit.updated_by}</Body> : null}
          </View>
          <Button label="Edit" size="sm" icon={Pencil} accessibilityLabel="Edit weekly split" onPress={openSplitEditor} />
        </View>
        <View style={styles.week}>
          {trainingSplit.days.map((day) => <View key={day.key} style={[styles.weekDay, day.key === today?.key && styles.today]}>
            <Label style={day.key === today?.key ? styles.todayText : undefined}>{day.label.slice(0, 1)}</Label>
            <View style={[styles.dayDot, day.muscles.length ? styles.trainingDot : null, day.key === today?.key ? styles.todayDot : null]} />
          </View>)}
        </View>
        <DetailsDisclosure title="View weekly schedule">
          {trainingSplit.days.map((day) => <View key={day.key} style={styles.previewRow}><Body style={styles.previewTitle}>{day.label}</Body><Body style={styles.scheduleMuscles}>{day.muscles.length ? day.muscles.join(" / ") : "Rest"}</Body></View>)}
        </DetailsDisclosure>
      </Panel>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Logs")} style={pressableFeedback(styles.historyLink)}><Body style={styles.optionTitle}>Workout history</Body><ChevronRight size={18} color={palette.accent} /></Pressable>

      <Modal visible={showSplitEditor} transparent animationType="none" statusBarTranslucent onRequestClose={() => setShowSplitEditor(false)}>
        {showSplitEditor ? (
          <SplitEditorSheet
            days={trainingSplit.days}
            todayKey={today?.key}
            syncedFriendNames={syncedFriendNames}
            onSave={saveSplit}
            onClose={() => setShowSplitEditor(false)}
          />
        ) : null}
      </Modal>

      <Modal visible={showWorkoutPicker} transparent animationType="none" statusBarTranslucent onRequestClose={() => setShowWorkoutPicker(false)}>
        <BottomSheet eyebrow="Start workout" title="What are you training?" closeLabel="Close workout picker" disabled={isStarting} onClose={() => setShowWorkoutPicker(false)}>
          <ScrollView contentContainerStyle={styles.workoutList} style={{ flexShrink: 1 }}>
            {workoutOptions.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`Start ${option.label}`}
                disabled={isStarting || Boolean(startAttempt && startAttempt.optionId !== option.id)}
                onPress={() => void startWorkout(option)}
                style={pressableFeedback(styles.workoutOption)}
              >
                <View style={styles.optionCopy}>
                  <Body style={styles.optionTitle}>{startAttempt?.optionId === option.id ? `Retry ${option.label}` : option.label}</Body>
                  <Body style={styles.optionMeta}>{scheduledDays(trainingSplit.days, option.muscles)}</Body>
                </View>
                {option === suggestedTemplate ? <View style={styles.optionTag}><Body style={styles.optionTagText}>{today?.muscles.length ? "Today" : "Up next"}</Body></View> : null}
                <ChevronRight size={20} color={palette.muted} />
              </Pressable>
            ))}
            {startError ? <Body accessibilityRole="alert">{startError}</Body> : null}
            {startAttempt && startError ? <><Body>Retry preserves the original workout identity. Review the saved draft before choosing another template.</Body><Pressable accessibilityRole="button" disabled={isStarting} onPress={() => void reviewSavedDraft()} style={pressableFeedback(styles.bodyButton)}><Body style={styles.optionTitle}>Review saved workout draft</Body></Pressable></> : null}
          </ScrollView>
        </BottomSheet>
      </Modal>
    </Screen>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  intro: { gap: spacing.sm, paddingVertical: spacing.sm },
  heroPanel: { gap: spacing.xl, borderColor: palette.accentSoft, backgroundColor: palette.surface },
  heroTitle: { fontSize: 27, marginTop: spacing.sm },
  heroIcon: { width: 52, height: 52, backgroundColor: palette.accentSoft, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  shortcuts: { flexDirection: "row", gap: spacing.md },
  shortcut: { flex: 1, minWidth: 0, borderRadius: 18, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, backgroundColor: palette.surface, gap: spacing.sm },
  shortcutIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  shortcutGlyph: { fontSize: 24, lineHeight: 28, color: palette.accent },
  week: { flexDirection: "row", gap: spacing.xs, justifyContent: "space-between" },
  weekDay: { flex: 1, minWidth: 0, minHeight: 60, alignItems: "center", justifyContent: "center", gap: spacing.md, borderRadius: 12 },
  today: { backgroundColor: palette.accent },
  todayText: { color: palette.surface },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.border },
  trainingDot: { backgroundColor: palette.accent },
  todayDot: { backgroundColor: palette.surface },
  scheduleMuscles: { flex: 1, textAlign: "right" },
  updatedText: { fontSize: 12 },
  historyLink: { flexDirection: "row", minHeight: 48, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  bodyButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: 8 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  startButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: palette.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  startText: { color: palette.surface, fontWeight: "900", fontSize: 16 },
  chooseWorkoutButton: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  chooseWorkoutText: { color: palette.accent, fontWeight: "800" },
    previewRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm },
  previewTitle: { color: palette.ink, fontWeight: "900" },
  workoutList: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  workoutOption: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: 14, backgroundColor: palette.surfaceAlt },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  optionMeta: { color: palette.muted, fontSize: 13 },
  optionTag: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.ink },
  optionTagText: { color: palette.surface, fontSize: 12, fontWeight: "800" },
  optionTitle: { color: palette.ink, fontWeight: "900" },
}));
