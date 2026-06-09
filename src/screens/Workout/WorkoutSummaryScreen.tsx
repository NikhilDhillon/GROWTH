import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowRight, CheckCircle2, Dumbbell, Flame, ListChecks, Sparkles } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { guidedCategoryLabels } from "@/constants/guidedWorkout";
import { buildGuidedSessionOutcome } from "@/services/guidedWorkout/guidedWorkoutService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { ActiveWorkout, CompletedWorkoutExercise, ExerciseScorePoint } from "@/types";
import { palette, spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

type SummaryParams = { workout: ActiveWorkout; finishedAt: string };
const celebrationColors = [palette.accent, palette.success, palette.warning, palette.blue, "#c28f2c", "#8d4d95"];

export function WorkoutSummaryScreen() {
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const route = useRoute<{ key: string; name: string; params: SummaryParams }>();
  const { workout, finishedAt } = route.params;
  const exercises = useFitnessStore((state) => state.exercises);
  const preferences = useFitnessStore((state) => state.guidedWorkoutPreferences);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const intro = useRef(new Animated.Value(0)).current;
  const confetti = useRef(celebrationColors.map(() => new Animated.Value(0))).current;

  const summaries = useMemo(() => workout.completedExercises.map((exercise) => {
    const catalogExercise = exercises.find((item) => item.id === exercise.exerciseId);
    const outcome = exercise.guidedOutcome ?? (catalogExercise ? buildGuidedSessionOutcome({
      exercise: catalogExercise,
      preferences,
      sets: exercise.sets
    }) : undefined);
    const scored = performanceForExercise(exercise, workout.workoutDate, exercisePoints);
    return { exercise, outcome, scored };
  }), [exercisePoints, exercises, preferences, workout.completedExercises, workout.workoutDate]);
  const achievements = summaries.filter((summary) => summary.outcome?.celebrated).length;
  const personalBests = summaries.filter((summary) => summary.scored?.newBest).length;
  const workingSets = workout.completedExercises.flatMap((exercise) => exercise.sets).filter((set) => !set.isWarmup && hasData(set));
  const warmups = workout.completedExercises.flatMap((exercise) => exercise.sets).filter((set) => set.isWarmup && hasData(set)).length;
  const volume = workingSets.reduce((total, set) => total + Number(set.weight) * Number(set.reps), 0);
  const extraMuscles = [...new Set(workout.completedExercises
    .map((exercise) => exercise.muscle === "Core" ? "Abs" : exercise.muscle)
    .filter((muscle) => !workout.plannedMuscles.includes(muscle)))];
  const celebrated = achievements > 0 || personalBests > 0;

  useEffect(() => {
    Animated.spring(intro, { toValue: 1, damping: 13, stiffness: 110, useNativeDriver: true }).start();
    if (!celebrated) return;
    Animated.stagger(55, confetti.map((value) => Animated.timing(value, { toValue: 1, duration: 850, useNativeDriver: true }))).start();
  }, [celebrated, confetti, intro]);

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
        <Label>{celebrated ? "Progress earned" : "Session complete"}</Label>
        <Title>{celebrated ? achievements ? "Targets cleared." : "New best." : "Work logged."}</Title>
        <Body style={styles.heroMessage}>
          {celebrated
            ? achievementMessage(achievements, personalBests)
            : "Showing up and recording the work matters. Keep building toward the next target."}
        </Body>
      </Animated.View>

      <Panel>
        <SectionTitle>Workout summary</SectionTitle>
        <View style={styles.metrics}>
          <Metric label="Duration" value={formatDuration(workout.startedAt, finishedAt)} />
          <Metric label="Exercises" value={String(workout.completedExercises.length)} />
          <Metric label="Working sets" value={String(workingSets.length)} />
          <Metric label="Logged volume" value={`${formatVolume(volume)} ${unitSystem}`} />
        </View>
        {warmups ? <Body>{warmups} warm-up {warmups === 1 ? "set" : "sets"} recorded and excluded from progression.</Body> : null}
        {workout.sourceDayKey !== workout.todayDayKey ? <Body>This session followed an alternate scheduled training day.</Body> : null}
        {extraMuscles.length ? <Body>Off-plan muscle groups trained: {extraMuscles.join(", ")}.</Body> : null}
        {workout.scheduleChanges.map((change) => <Body key={change}>{change}</Body>)}
      </Panel>

      {summaries.map(({ exercise, outcome, scored }, index) => (
        <Panel key={`${exercise.exerciseId}-${exercise.completedAt}`}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseTitle}>
              {outcome?.celebrated ? <CheckCircle2 size={20} color={palette.success} /> : <Dumbbell size={20} color={palette.accent} />}
              <SectionTitle>{exercise.exerciseName}</SectionTitle>
            </View>
            {outcome ? <Label>{guidedCategoryLabels[outcome.category]}</Label> : null}
          </View>
          <Body>{formatSets(exercise, unitSystem)}</Body>
          {exercise.machineProfileLabel ? <Label>{exercise.machineProfileLabel}</Label> : null}
          {outcome?.messages.map((message) => (
            <Body key={message} style={outcome.celebrated ? styles.achievedText : undefined}>{message}</Body>
          ))}
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
  return (
    <View style={styles.metric}>
      <Label>{label}</Label>
      <SectionTitle>{value}</SectionTitle>
    </View>
  );
}

function PerformanceLine({ result, unitSystem }: { result: PerformanceResult; unitSystem: string }) {
  const details = result.isFirst
    ? "First scored session."
    : result.newBest
      ? "New best estimated 1RM."
      : result.pointChange > 0
        ? `Performance improved by ${result.pointChange.toFixed(1)} points.`
        : "Performance score recorded.";
  return <Body style={result.newBest || result.pointChange > 0 ? styles.achievedText : undefined}>Performance: {result.current.performancePoints.toFixed(1)} points | e1RM {formatLoad(result.current.estimated1RM, unitSystem)}. {details}</Body>;
}

type PerformanceResult = { current: ExerciseScorePoint; isFirst: boolean; newBest: boolean; pointChange: number };

function performanceForExercise(exercise: CompletedWorkoutExercise, date: string, points: ExerciseScorePoint[]): PerformanceResult | null {
  const matching = points.filter((point) => point.exerciseId === exercise.exerciseId);
  const current = exercise.sessionId
    ? matching.find((point) => point.sessionId === exercise.sessionId)
    : matching.filter((point) => point.date === date).sort((a, b) => a.sessionId - b.sessionId).at(-1);
  if (!current) return null;
  const prior = matching.filter((point) => point.date < current.date || (point.date === current.date && point.sessionId < current.sessionId));
  const latestPrior = [...prior].sort((a, b) => a.date.localeCompare(b.date) || a.sessionId - b.sessionId).at(-1);
  const priorBest = prior.reduce((best, point) => Math.max(best, point.estimated1RM), 0);
  return {
    current,
    isFirst: !prior.length,
    newBest: Boolean(prior.length) && current.estimated1RM > priorBest,
    pointChange: latestPrior ? current.performancePoints - latestPrior.performancePoints : 0
  };
}

function hasData(set: CompletedWorkoutExercise["sets"][number]) {
  return Boolean(set.reps.trim() || set.weight.trim());
}

function formatSets(exercise: CompletedWorkoutExercise, unitSystem: string) {
  return exercise.sets.filter(hasData).map((set) => `${set.isWarmup ? "Warm-up: " : ""}${set.weight} ${unitSystem} x ${set.reps}`).join(" | ");
}

function formatDuration(startedAt: string, finishedAt: string) {
  const minutes = Math.max(1, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatVolume(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function achievementMessage(achievements: number, personalBests: number) {
  const parts = [];
  if (achievements) parts.push(`${achievements} ${achievements === 1 ? "exercise is" : "exercises are"} ready to progress`);
  if (personalBests) parts.push(`${personalBests} new performance ${personalBests === 1 ? "best" : "bests"}`);
  return `${parts.join(" and ")}. Strong session.`;
}

function formatLoad(value: number, unitSystem: string) {
  return unitSystem === "kg" ? `${(value / 2.2046226218).toFixed(1)} kg` : `${Math.round(value)} lb`;
}

const styles = StyleSheet.create({
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
    backgroundColor: "#f4e6d5"
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
    borderRadius: 8
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
});
