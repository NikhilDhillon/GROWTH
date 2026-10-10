import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowRight, CheckCircle2, Dumbbell, Flame, ListChecks, Sparkles } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { guidedCategoryLabels } from "@/constants/guidedWorkout";
import { getExerciseLoadType } from "@/constants/exercises";
import { guidanceForRecordedEntry } from "@/services/workouts/recordedGuidance";
import { bodyweightEvidenceMessage } from "@/services/workouts/recordingContext";
import { growthMetricVersion } from "@/services/strength/strengthService";
import { savedWorkoutSummary, SavedWorkoutSummaryParams } from "@/services/workouts/savedWorkoutSummary";
import { ExerciseEntry } from "@/domain/types";
import { useFitnessStore } from "@/store/useFitnessStore";
import { ExerciseScorePoint, UnitSystem } from "@/types";
import { groupSetsForDisplay } from "@/utils/sessionDisplay";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";
import { formatWeight, weightFromStorageUnit } from "@/utils/units";

const celebrationColors = ["#34a878", "#84b5ff", "#ffd079", "#b19bff", "#fb8eac", "#b4b4b4"];

export function WorkoutSummaryScreen() {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const route = useRoute<{ key: string; name: string; params: SavedWorkoutSummaryParams }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const archives = useFitnessStore((state) => state.completedGuidedWorkouts);
  const workoutArchiveEvidence = useFitnessStore((state) => state.workoutArchiveEvidence);
  const workoutRecords = useFitnessStore((state) => state.workoutRecords);
  const workoutReferences = useFitnessStore((state) => state.workoutReferences);
  const preferences = useFitnessStore((state) => state.guidedWorkoutPreferences);
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const machineProfiles = useFitnessStore((state) => state.machineProfiles);
  const dataError = useFitnessStore((state) => state.dataError);
  const hydrate = useFitnessStore((state) => state.hydrate);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const intro = useRef(new Animated.Value(0)).current;
  const confetti = useRef(celebrationColors.map(() => new Animated.Value(0))).current;

  const resolved = useMemo(() => savedWorkoutSummary({
    sessions, sets, exercises, activeWorkout, completedGuidedWorkouts: archives, workoutArchiveEvidence, workoutRecords, workoutReferences
  }, route.params ?? {}),
  [sessions, sets, exercises, activeWorkout, archives, workoutArchiveEvidence, workoutRecords, workoutReferences, route.params]);
  const workout = resolved?.workout;
  const savedArchive = archives.find((archive) => archive.workoutId === workout?.id
    || workoutRecords?.some((record) => record.id === workout?.id && record.legacyId === archive.startedAt));
  const summaries = (resolved?.entries ?? []).map((entry) => ({
    entry,
    catalogExercise: exercises.find((item) => item.id === entry.exerciseId),
    guidance: guidanceForRecordedEntry(entry, workoutReferences?.find((reference) => reference.sessionId === entry.id)?.prescription,
      exercises.find((item) => item.id === entry.exerciseId), preferences)
      ?? savedArchive?.completedExercises.find((item) => item.sessionId === entry.id && item.exerciseId === entry.exerciseId)?.guidedOutcome,
    scored: performanceForEntry(entry, exercisePoints)
  }));
  const personalBests = summaries.filter((summary) => summary.scored?.newBest).length;
  const { workingSets, warmups, volumeLb } = resolved?.totals ?? { workingSets: 0, warmups: 0, volumeLb: 0 };
  const extraMuscles = [...new Set(summaries.flatMap(({ catalogExercise }) => {
    if (!catalogExercise) return [];
    const muscle = catalogExercise.primary_muscle === "Core" ? "Abs" : catalogExercise.primary_muscle;
    return workout?.plannedMuscles.includes(muscle) ? [] : [muscle];
  }))];
  const celebrated = personalBests > 0;

  useEffect(() => {
    Animated.spring(intro, { toValue: 1, damping: 13, stiffness: 110, useNativeDriver: true }).start();
    if (!celebrated) return;
    Animated.stagger(55, confetti.map((value) => Animated.timing(value, { toValue: 1, duration: 850, useNativeDriver: true }))).start();
  }, [celebrated, confetti, intro]);

  if (!resolved || !workout) return <Screen><Panel>
    <Title>Workout unavailable</Title>
    <Body accessibilityRole="alert">This link does not identify a saved workout. Reload recorded data or open History to find it.</Body>
    <Pressable accessibilityRole="button" onPress={() => void hydrate()} style={pressableFeedback(styles.secondaryButton)}><Body style={{ color: palette.ink, fontWeight: "700" }}>Retry loading recorded work</Body></Pressable>
    <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Logs")} style={pressableFeedback(styles.secondaryButton)}><Body style={{ color: palette.ink, fontWeight: "700" }}>View logs</Body></Pressable>
  </Panel></Screen>;

  return (
    <Screen>
      <Animated.View style={[styles.hero, {
        opacity: intro,
        transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }]
      }]}>
        {celebrated ? <CelebrationPieces values={confetti} /> : null}
        <View style={[styles.heroIcon, celebrated ? styles.heroIconAchieved : styles.heroIconProgress]}>
          {celebrated ? <Sparkles size={30} color={palette.success} /> : <Flame size={30} color={palette.warning} />}
        </View>
        <Label>{workout.status === "active" ? "Workout in progress" : celebrated ? "Progress earned" : "Session complete"}</Label>
        <Title>{celebrated ? "New best." : "Work logged."}</Title>
        <Body style={styles.heroMessage}>
          {celebrated
            ? `${personalBests} new ${personalBests === 1 ? "best" : "bests"} recorded.`
            : "Recorded session details below."}
        </Body>
      </Animated.View>

      <Panel>
        <SectionTitle>Workout summary</SectionTitle>
        <View style={styles.metrics}>
          <Metric label="Duration" value={formatDuration(workout.startedAt, workout.finishedAt)} />
          <Metric label="Exercises" value={String(resolved.totals.exercises)} />
          <Metric label="Working sets" value={String(workingSets)} />
          <Metric label="Volume" value={`${formatVolume(weightFromStorageUnit(volumeLb, unitSystem))} ${unitSystem}`} />
        </View>
        <DetailsDisclosure title="How volume is calculated">
          <Body>Totals use entered load, including added weight or assistance. They exclude estimated bodyweight load and are not comparisons between exercises.</Body>
        </DetailsDisclosure>
        {resolved.resolution !== "complete" ? <Body accessibilityRole="alert">Some archived exercises have no verified recording link or contain unresolved observations. Their original values are preserved for review; only verified observations contribute to these totals.</Body> : null}
        {dataError ? <Body accessibilityRole="alert">Recorded data could not refresh. This summary uses the last loaded observations until loading succeeds.</Body> : null}
        {dataError ? <Pressable onPress={() => void hydrate()} style={pressableFeedback(styles.secondaryButton)}><Body style={{ color: palette.ink, fontWeight: "700" }}>Retry loading recorded work</Body></Pressable> : null}
        {resolved.workout.workoutDate === null && resolved.entries.length ? <Body>The recorded entries span different dates or contain an unresolved date. See Logs for the individual entries.</Body> : null}
        {warmups ? <Body>{warmups} warm-up {warmups === 1 ? "set" : "sets"} recorded and excluded from progression.</Body> : null}
        {savedArchive && savedArchive.sourceDayKey !== savedArchive.todayDayKey ? <Body>This session followed an alternate scheduled training day.</Body> : null}
        {extraMuscles.length ? <Body>Off-plan muscle groups trained: {extraMuscles.join(", ")}.</Body> : null}
        {workout.scheduleChanges.map((change) => <Body key={change}>{change}</Body>)}
      </Panel>

      {summaries.map(({ entry, catalogExercise, guidance, scored }, index) => (
        <Panel key={entry.id}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseTitle}>
              {scored?.newBest ? <CheckCircle2 size={20} color={palette.success} /> : <Dumbbell size={20} color={palette.accent} />}
              <SectionTitle>{catalogExercise?.name ?? `Exercise ${entry.exerciseId ?? "unknown"}`}</SectionTitle>
            </View>
            {guidance ? <Label>{guidedCategoryLabels[guidance.category]}</Label> : null}
          </View>
          <Body style={styles.setsText}>{formatSets(entry, unitSystem, catalogExercise?.name)}</Body>
          {entry.machineProfileId ? <Label>{machineProfiles.find((profile) => profile.id === entry.machineProfileId)?.label ?? "Recorded machine"}</Label> : null}
          {guidance?.messages.length ? <View><Label>{workoutReferences?.some((reference) => reference.sessionId === entry.id && reference.prescription) ? "Recorded target comparison" : "Guidance at completion"}</Label>{guidance.messages.map((message) => <Body key={message}>{message}</Body>)}</View> : null}
          {scored ? <PerformanceLine result={scored} unitSystem={unitSystem} /> : null}
          {index < summaries.length - 1 ? null : <Body style={styles.finalEncouragement}>{celebrated ? "Carry that progress into the next session." : "One more rep next time is still progress."}</Body>}
        </Panel>
      ))}

      <View style={styles.actions}>
        <Pressable onPress={() => navigation.navigate("Logs")} style={pressableFeedback(styles.secondaryButton)}>
          <ListChecks size={18} color={palette.ink} />
          <Body style={styles.secondaryText}>View logs</Body>
        </Pressable>
        <Pressable onPress={() => navigation.navigate("Home")} style={pressableFeedback(styles.primaryButton)}>
          <Body style={styles.primaryText}>Done</Body>
          <ArrowRight size={18} color={palette.surface} />
        </Pressable>
      </View>
    </Screen>
  );
}

function CelebrationPieces({ values }: { values: Animated.Value[] }) {
  const { palette, styles } = useStyles();
  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {values.map((value, index) => (
        <Animated.View
          key={celebrationColors[index]}
          style={[styles.confetti, {
            left: `${10 + (index * 15)}%`,
            backgroundColor: celebrationColors[index],
            opacity: value.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [30, -54 - (index % 2) * 18] }) },
              { rotate: value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${index % 2 ? -150 : 170}deg`] }) }
            ]
          }]}
        />
      ))}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { palette, styles } = useStyles();
  return (
    <View style={styles.metric}>
      <Label>{label}</Label>
      <SectionTitle>{value}</SectionTitle>
    </View>
  );
}

function PerformanceLine({ result, unitSystem }: { result: PerformanceResult; unitSystem: UnitSystem }) {
  const { palette, styles } = useStyles();
  const details = result.isFirst
    ? "First scored session."
    : result.newBest
      ? "New best estimated 1RM."
      : result.pointChange > 0
        ? `Performance improved by ${result.pointChange.toFixed(1)} points.`
        : "Performance score recorded.";
  return <View style={styles.performanceResult}>
    <Body style={result.newBest || result.pointChange > 0 ? styles.achievedText : undefined}>Growth {result.current.performancePoints.toFixed(1)} · e1RM {formatWeight(result.current.estimated1RM, unitSystem)} · {details}</Body>
    {result.current.metricVersion ? <DetailsDisclosure title="Score method and baseline">
      <Body>{result.current.metricVersion === growthMetricVersion ? "First eligible baseline (v1)" : result.current.metricVersion}. Starting observation: {result.baselineDate ?? "unavailable"}.</Body>
    </DetailsDisclosure> : null}
    {result.current.bodyWeightEstimate ? <Body>{bodyweightEvidenceMessage(result.current.bodyWeightEstimate, unitSystem)}</Body> : null}
  </View>;
}

type PerformanceResult = { current: ExerciseScorePoint; isFirst: boolean; newBest: boolean; pointChange: number; baselineDate: string | null };

function performanceForEntry(entry: ExerciseEntry, points: ExerciseScorePoint[]): PerformanceResult | null {
  const matching = points.filter((point) => point.exerciseId === entry.exerciseId);
  const current = matching.find((point) => point.sessionId === entry.id);
  if (!current) return null;
  const prior = matching.filter((point) => point.comparisonKey === current.comparisonKey && point.metricVersion === current.metricVersion
    && (point.date < current.date || (point.date === current.date && point.sessionId < current.sessionId)));
  const latestPrior = [...prior].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId).at(-1);
  const priorBest = prior.reduce((best, point) => Math.max(best, point.estimated1RM), 0);
  return {
    current,
    baselineDate: matching.find((point) => point.sessionId === current.baselineSessionId && point.comparisonKey === current.comparisonKey)?.date ?? null,
    isFirst: !prior.length,
    newBest: Boolean(prior.length) && current.estimated1RM > priorBest,
    pointChange: latestPrior ? current.performancePoints - latestPrior.performancePoints : 0
  };
}

function formatSets(entry: ExerciseEntry, unitSystem: UnitSystem, exerciseName?: string) {
  const loadType = exerciseName ? getExerciseLoadType(exerciseName) : null;
  const loadLabel = loadType === "bodyweight_plus_load" ? "added " : loadType === "bodyweight_minus_assistance" ? "assistance " : "";
  return groupSetsForDisplay(entry.sets.map((set) => ({ reps: set.reps, weight: set.loadLb, isWarmup: set.isWarmup })), (load) => `${loadLabel}${formatWeight(load, unitSystem)}`)
    .map((group) => `${group.warmup ? "Warm-up " : ""}${group.load} × ${group.reps.join(" · ")}`).join(", ");
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt || !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(finishedAt)) || Date.parse(finishedAt) < Date.parse(startedAt)) return "Unavailable";
  const minutes = Math.max(1, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatVolume(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  setsText: { color: palette.ink, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hero: {
    position: "relative",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: spacing.xl,
    overflow: "hidden"
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs
  },
  heroIconAchieved: {
    backgroundColor: palette.accentSoft
  },
  heroIconProgress: {
    backgroundColor: palette.accentSoft
  },
  heroMessage: {
    maxWidth: 510,
    textAlign: "center",
    color: palette.ink,
    fontWeight: "700"
  },
  confettiLayer: {
    ...StyleSheet.absoluteFillObject
  },
  confetti: {
    position: "absolute",
    top: 62,
    width: 8,
    height: 18,
    borderRadius: 3
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  metric: {
    flex: 1,
    minWidth: 126,
    gap: spacing.xs,
    backgroundColor: palette.surfaceAlt,
    padding: spacing.md,
    borderRadius: 8
  },
  exerciseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  exerciseTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  achievedText: {
    color: palette.success,
    fontWeight: "800"
  },
  performanceResult: { gap: spacing.xs, paddingTop: spacing.xs },
  finalEncouragement: {
    color: palette.ink,
    fontWeight: "800"
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    minWidth: 140,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt
  },
  secondaryText: {
    color: palette.ink,
    fontWeight: "900"
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    minWidth: 140,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: palette.ink,
    borderRadius: 8
  },
  primaryText: {
    color: palette.surface,
    fontWeight: "900"
  }
}));
