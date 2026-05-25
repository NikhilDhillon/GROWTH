import { StyleSheet, View } from "react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { calculateEstimated1RM, calculateSessionPerformance } from "@/services/strength/strengthService";
import { palette, spacing } from "@/utils/theme";

const baselineExample = buildFormulaExample("Baseline session", [
      { weight: 185, reps: 6, set_number: 1 },
      { weight: 185, reps: 6, set_number: 2 },
      { weight: 185, reps: 6, set_number: 3 }
  ]);
const formulaExamples = [
  baselineExample,
  buildFormulaExample("Later session", [
      { weight: 185, reps: 7, set_number: 1 },
      { weight: 185, reps: 6, set_number: 2 },
      { weight: 185, reps: 5, set_number: 3 }
  ], baselineExample.metrics)
];

function buildFormulaExample(label: string, sets: { weight: number; reps: number; set_number: number }[], reference?: { estimated1RM: number; failureVolume: number; fatigueResistance: number }) {
  const rows = sets.map((set) => {
    const estimated1RM = calculateEstimated1RM(set.weight, set.reps);
    return { ...set, estimated1RM };
  });
  const metrics = calculateSessionPerformance(sets, reference)!;

  return {
    label,
    work: sets.map((set) => `${set.weight} lb x ${set.reps}`).join(", "),
    rows,
    metrics
  };
}

export function HomeScreen() {
  return (
    <Screen>
      <View>
        <Label>Strength scoring</Label>
        <Title>GROWTH</Title>
      </View>

      <Panel>
        <SectionTitle>Performance Points formula</SectionTitle>
        <Body>Estimated 1RM = weight x (1 + reps / 30)</Body>
        <Body>Strength = best estimated 1RM; volume = sum(weight x reps)</Body>
        <Body>Resistance = min(1, final set e1RM / first set e1RM)</Body>
        <Body>Points = 100 x (0.45 normalized strength + 0.35 normalized volume + 0.20 normalized resistance)</Body>
        <View style={styles.exampleList}>
          <View style={styles.exampleRow}>
            <Body style={styles.exampleLabel}>{formulaExamples[0].label}</Body>
            <Body style={styles.exampleWork}>{formulaExamples[0].work}</Body>
            {formulaExamples[0].rows.map((row) => (
              <Body key={`${formulaExamples[0].label}-${row.set_number}`}>
                Set {row.set_number}: {row.weight} x (1 + {row.reps} / 30) = {row.estimated1RM.toFixed(1)} e1RM
              </Body>
            ))}
            <Body>Volume = {formulaExamples[0].metrics.failureVolume.toFixed(1)}; resistance = {(formulaExamples[0].metrics.fatigueResistance * 100).toFixed(1)}%</Body>
            <Body style={styles.exampleScore}>Performance Points = {formulaExamples[0].metrics.performancePoints.toFixed(1)}</Body>
          </View>
          <View style={styles.exampleRow}>
            <Body style={styles.exampleLabel}>{formulaExamples[1].label}</Body>
            <Body style={styles.exampleWork}>{formulaExamples[1].work}</Body>
            <Body style={styles.exampleScore}>Performance Points = {formulaExamples[1].metrics.performancePoints.toFixed(1)}</Body>
          </View>
        </View>
      </Panel>
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
  }
});
