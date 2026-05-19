import { StyleSheet, View } from "react-native";

import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { calculateEstimated1RM, calculateExerciseScore, calculateWeightedContribution, getRepQualityMultiplier, getSetImportanceWeight } from "@/services/strength/strengthService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatShortDate } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";

const formulaExamples = [
  buildFormulaExample("Example 1", [
      { weight: 185, reps: 6, set_number: 1 },
      { weight: 185, reps: 6, set_number: 2 },
      { weight: 185, reps: 6, set_number: 3 }
  ]),
  buildFormulaExample("Example 2", [
      { weight: 185, reps: 7, set_number: 1 },
      { weight: 185, reps: 6, set_number: 2 },
      { weight: 185, reps: 5, set_number: 3 }
  ])
];

function buildFormulaExample(label: string, sets: { weight: number; reps: number; set_number: number }[]) {
  const rows = sets.map((set) => {
    const estimated1RM = calculateEstimated1RM(set.weight, set.reps);
    const repQuality = getRepQualityMultiplier(set.reps);
    const importance = getSetImportanceWeight(set.set_number);
    const contribution = calculateWeightedContribution({ weight: set.weight, reps: set.reps, setNumber: set.set_number });
    return { ...set, estimated1RM, repQuality, importance, contribution };
  });
  const weightedTotal = rows.reduce((total, row) => total + row.contribution, 0);
  const score = calculateExerciseScore(sets);

  return {
    label,
    work: sets.map((set) => `${set.weight} lb x ${set.reps}`).join(", "),
    rows,
    weightedTotal,
    divisor: Math.sqrt(sets.length),
    score
  };
}

export function HomeScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const exercisePoints = useFitnessStore((state) => state.exercisePoints);
  const strengthExercises = exercises.filter((exercise) => exercise.is_strength_exercise);
  const strengthExercisesWithData = strengthExercises
    .map((exercise) => ({
      exercise,
      points: exercisePoints
        .filter((point) => point.exerciseId === exercise.id)
        .map((point) => ({ label: formatShortDate(point.date), value: point.score }))
    }))
    .filter((item) => item.points.length > 0);

  return (
    <Screen>
      <View>
        <Label>Strength exercise graphs</Label>
        <Title>GROWTH</Title>
      </View>

      <Panel>
        <SectionTitle>Score formula</SectionTitle>
        <Body>Estimated 1RM = weight x (1 + reps / 30)</Body>
        <Body>Set contribution = estimated 1RM x rep quality x set importance</Body>
        <Body>Exercise score = sum(set contributions) / sqrt(number of sets)</Body>
        <View style={styles.exampleList}>
          <View style={styles.exampleRow}>
            <Body style={styles.exampleLabel}>{formulaExamples[0].label}</Body>
            <Body style={styles.exampleWork}>{formulaExamples[0].work}</Body>
            {formulaExamples[0].rows.map((row) => (
              <Body key={`${formulaExamples[0].label}-${row.set_number}`}>
                Set {row.set_number}: {row.weight} x (1 + {row.reps} / 30) = {row.estimated1RM.toFixed(1)}; {row.estimated1RM.toFixed(1)} x {row.repQuality.toFixed(3)} x {row.importance.toFixed(2)} = {row.contribution.toFixed(1)}
              </Body>
            ))}
            <Body>Weighted total = {formulaExamples[0].weightedTotal.toFixed(1)}</Body>
            <Body>Normalize = {formulaExamples[0].weightedTotal.toFixed(1)} / sqrt({formulaExamples[0].rows.length}) = {formulaExamples[0].weightedTotal.toFixed(1)} / {formulaExamples[0].divisor.toFixed(3)}</Body>
            <Body style={styles.exampleScore}>Final score = {formulaExamples[0].score.toFixed(1)} pts</Body>
          </View>
          <View style={styles.exampleRow}>
            <Body style={styles.exampleLabel}>{formulaExamples[1].label}</Body>
            <Body style={styles.exampleWork}>{formulaExamples[1].work}</Body>
            <Body style={styles.exampleScore}>Final score = {formulaExamples[1].score.toFixed(1)} pts</Body>
          </View>
        </View>
      </Panel>

      {strengthExercisesWithData.length ? (
        strengthExercisesWithData.map(({ exercise, points }) => (
          <View key={exercise.id} style={styles.graphSection}>
            <SectionTitle>{exercise.name}</SectionTitle>
            <LineGraph points={points} suffix=" pts" />
          </View>
        ))
      ) : (
        <Panel>
          <Body>No strength exercise logs yet.</Body>
        </Panel>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  exampleList: {
    gap: spacing.sm
  },
  exampleRow: {
    gap: 2
  },
  exampleLabel: {
    fontWeight: "900"
  },
  exampleWork: {
    color: palette.ink,
    fontWeight: "900"
  },
  exampleScore: {
    fontWeight: "900"
  },
  graphSection: {
    gap: spacing.sm
  }
});
