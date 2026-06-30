import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ChevronRight, Dumbbell, Timer, X } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { createActiveWorkout } from "@/constants/activeWorkout";
import { useFitnessStore } from "@/store/useFitnessStore";
import { SplitMuscle } from "@/types";
import { palette, spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

type WorkoutOption = {
  key: string;
  label: string;
  muscles: SplitMuscle[];
};

const workoutOptions: WorkoutOption[] = [
  { key: "chest-triceps", label: "Chest / Triceps", muscles: ["Chest", "Triceps"] },
  { key: "back-biceps-traps", label: "Back / Biceps / Traps", muscles: ["Back", "Biceps", "Traps"] },
  { key: "legs-shoulders", label: "Legs / Shoulders", muscles: ["Legs", "Shoulders"] }
];

export function HomeScreen() {
  const activeWorkout = useFitnessStore((state) => state.activeWorkout);
  const startActiveWorkout = useFitnessStore((state) => state.startActiveWorkout);
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!activeWorkout) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeWorkout]);

  function openWorkout() {
    if (activeWorkout) {
      navigation.navigate("ActiveWorkout");
      return;
    }
    setShowWorkoutPicker(true);
  }

  async function startWorkout(option: WorkoutOption) {
    if (isStarting) return;
    setIsStarting(true);
    try {
      await startActiveWorkout(createActiveWorkout({
        key: option.key,
        label: option.label,
        muscles: option.muscles
      }, option.label));
      setShowWorkoutPicker(false);
      navigation.navigate("ActiveWorkout");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Screen>
      <View>
        <Label>Guided training</Label>
        <Title>Ready to train?</Title>
      </View>

      <Panel style={styles.heroPanel}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <SectionTitle>{activeWorkout ? "Workout in progress" : "Choose your workout when you start"}</SectionTitle>
            <Body>
              {activeWorkout
                ? `${activeWorkout.workoutLabel ?? activeWorkout.plannedMuscles.join(" / ")} · ${formatElapsed(activeWorkout.startedAt, clock)} elapsed`
                : "Pick one of your four sessions, then add another muscle group whenever you want."}
            </Body>
          </View>
          {activeWorkout ? <Timer size={24} color={palette.accent} /> : <Dumbbell size={24} color={palette.accent} />}
        </View>

        <Pressable onPress={openWorkout} style={pressableFeedback(styles.startButton)}>
          <Body style={styles.startText}>{activeWorkout ? "Resume workout" : "Start workout"}</Body>
          <ChevronRight size={21} color={palette.surface} />
        </Pressable>
      </Panel>

      {!activeWorkout ? (
        <View style={styles.preview}>
          <Label>Your split</Label>
          {workoutOptions.map((option) => (
            <View key={option.key} style={styles.previewRow}>
              <Body style={styles.previewTitle}>{option.label}</Body>
            </View>
          ))}
        </View>
      ) : null}

      <Modal visible={showWorkoutPicker} transparent animationType="fade" onRequestClose={() => setShowWorkoutPicker(false)}>
        <View style={styles.modalLayer}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.headerCopy}>
                <Label>Start workout</Label>
                <SectionTitle>What are you training?</SectionTitle>
              </View>
              <Pressable accessibilityLabel="Close workout picker" onPress={() => setShowWorkoutPicker(false)} style={pressableFeedback(styles.closeButton)}>
                <X size={20} color={palette.ink} />
              </Pressable>
            </View>

            <View style={styles.workoutList}>
              {workoutOptions.map((option) => (
                  <Pressable
                    key={option.key}
                    disabled={isStarting}
                    onPress={() => void startWorkout(option)}
                    style={pressableFeedback(styles.workoutOption)}
                  >
                    <View style={styles.optionCopy}>
                      <Body style={styles.optionTitle}>{option.label}</Body>
                    </View>
                    <ChevronRight size={20} color={palette.muted} />
                  </Pressable>
                ))}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  heroPanel: { gap: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  startButton: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  startText: { color: palette.surface, fontWeight: "900", fontSize: 16 },
  preview: { gap: spacing.sm },
  previewRow: { borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: spacing.sm },
  previewTitle: { color: palette.ink, fontWeight: "900" },
  modalLayer: { flex: 1, backgroundColor: "rgba(23, 32, 28, 0.48)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 560, maxHeight: "92%", backgroundColor: palette.surface, borderRadius: 12, padding: spacing.lg, gap: spacing.md },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  closeButton: { width: 42, height: 42, borderRadius: 8, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  workoutList: { gap: spacing.sm },
  workoutOption: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: 9, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt },
  optionCopy: { flex: 1 },
  optionTitle: { color: palette.ink, fontWeight: "900" },
});
