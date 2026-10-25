import { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, ChevronRight, FileUp, LogOut } from "lucide-react-native";

import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Avatar } from "@/components/Avatar";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle } from "@/components/Text";
import { categoryForExercise, guidedCategoryLabels } from "@/constants/guidedWorkout";
import { ImportPreview, parseImportData } from "@/services/import/importService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { GuidedExerciseCategory } from "@/types";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback } from "@/utils/touch";

const sampleImportJson = `{
  "schemaVersion": 2,
  "unit": "lb",
  "bodyweightUnit": "kg",
  "bodyMeasurementUnit": "in",
  "bodyweight": [
    { "date": "2026-05-24", "weight": 82.4 }
  ],
  "bodyMeasurements": [
    {
      "date": "2026-05-24",
      "weight": 82.4,
      "notes": "Morning check-in",
      "measurements": {
        "chest": 40.2,
        "waist": 32.4,
        "arm_flexed": { "left": 14.1, "right": 14.3 }
      }
    }
  ],
  "workouts": [
    {
      "date": "2026-05-24",
      "notes": "Imported push day",
      "externalId": "optional-stable-id",
      "exercises": [
        {
          "name": "Barbell Bench Press",
          "sets": [
            { "reps": 5, "weight": 225, "rir": 2 },
            { "reps": 5, "weight": 225 }
          ]
        }
      ]
    }
  ]
}`;

export function SettingsScreen() {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const logout = useFitnessStore((state) => state.logout);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const setUnitSystem = useFitnessStore((state) => state.setUnitSystem);
  const bodyUnitPreferences = useFitnessStore((state) => state.bodyUnitPreferences);
  const setBodyUnitPreferences = useFitnessStore((state) => state.setBodyUnitPreferences);
  const importTrainingData = useFitnessStore((state) => state.importTrainingData);
  const guidedWorkoutPreferences = useFitnessStore((state) => state.guidedWorkoutPreferences);
  const saveGuidedWorkoutPreferences = useFitnessStore((state) => state.saveGuidedWorkoutPreferences);
  const [loggingError, setLoggingError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedFileText, setSelectedFileText] = useState("");
  const [previewAccountId, setPreviewAccountId] = useState<string | number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const guidedCounts = (Object.keys(guidedCategoryLabels) as GuidedExerciseCategory[]).map((category) => ({
    category,
    count: exercises.filter((exercise) => categoryForExercise(exercise.name, guidedWorkoutPreferences) === category).length
  }));

  function validateImport(text: string) {
    setImportError(null);
    setImportMessage(null);
    try {
      const nextPreview = parseImportData(text, exercises);
      setPreview(nextPreview);
      setPreviewAccountId(currentUser?.id ?? null);
      setImportMessage(`Preview · ${nextPreview.bodyWeightCount} weights · ${nextPreview.bodyMeasurementCount} check-ins · ${nextPreview.workoutCount} workouts · ${nextPreview.setCount} sets`);
    } catch (error) {
      setPreview(null);
      setPreviewAccountId(null);
      setImportError(error instanceof Error ? error.message : "Could not validate import data.");
    }
  }

  async function handleImport() {
    setIsImporting(true);
    setImportError(null);
    try {
      const selectedPreview = preview ?? parseImportData(selectedFileText, exercises);
      const importInput = { ...selectedPreview, expectedAccountId: previewAccountId ?? undefined };
      const result = await importTrainingData(importInput);
      setSelectedFileText("");
      setPreview(null);
      setPreviewAccountId(null);
      setImportMessage(
        `Imported ${result.inserted.bodyCheckIns} check-ins · ${result.inserted.workouts} workouts · ${result.inserted.sets} sets. Skipped ${result.skipped.bodyCheckIns} check-ins · ${result.skipped.workouts} workouts. Failed ${result.failed}.`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not import data.";
      setImportError(`Import failed; no records were committed. ${detail}`);
    } finally {
      setIsImporting(false);
    }
  }

  function chooseImportFile() {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setSelectedFileText(text);
        validateImport(text);
      };
      reader.onerror = () => {
        setImportError("Could not read import file.");
      };
      reader.readAsText(file);
    };
    input.click();
  }

  return (
    <Screen>

      <Panel>
        <SectionTitle>Account</SectionTitle>
        <View style={styles.accountRow}>
          <Avatar name={currentUser?.name.trim() || currentUser?.email || "?"} size={44} />
          <View style={styles.accountText}>
            <Body numberOfLines={1} style={styles.accountName}>{currentUser ? currentUser.name.trim() || currentUser.email.split("@")[0] : "Not signed in"}</Body>
            {currentUser ? <Body numberOfLines={1}>{currentUser.email}</Body> : null}
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={() => void logout()} style={pressableFeedback(styles.logoutButton)}>
          <LogOut size={16} color={palette.danger} />
          <Body style={styles.logoutText}>Log out</Body>
        </Pressable>
      </Panel>

      <Panel>
        <DetailsDisclosure title="Performance Points formula">
          <View style={styles.formulaDetails}>
            <Body>Eligible sessions use two or more working sets with positive whole-number reps; warm-up sets are excluded.</Body>
            <Body>Estimated 1RM = weight x (1 + min(reps, 10) / 30)</Body>
            <Body>Strength = best estimated 1RM; volume = sum(weight x reps)</Body>
            <Body>Resistance = min(1, final set e1RM / first set e1RM)</Body>
            <Body>Points = 100 x (0.45 normalized strength + 0.35 normalized volume + 0.20 normalized resistance)</Body>
            <Body>Each session is normalized against the exercise's prior best-strength session.</Body>
          </View>
        </DetailsDisclosure>
      </Panel>

      <Panel>
        <SectionTitle>Exercise tracking</SectionTitle>
        <Body>{exercises.length} exercises available to record.</Body>
      </Panel>

      <Panel>
        <View style={styles.panelHeading}>
          <SectionTitle>Guided workout</SectionTitle>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("GuidedWorkoutSettings")} style={pressableFeedback(styles.editButton)}>
            <Body style={styles.editButtonText}>Edit</Body>
            <ChevronRight size={17} color={palette.ink} />
          </Pressable>
        </View>
        <Body style={styles.importNotice}>Set rep targets and progression rules for guided sessions.</Body>
        <DetailsDisclosure title="Current targets and categories">
          <View style={styles.summaryGrid}>
            <Body>Hypertrophy: {guidedWorkoutPreferences.hypertrophyTargetReps} reps, -{guidedWorkoutPreferences.hypertrophyRepDecrement} per set</Body>
            <Body>Strength: {guidedWorkoutPreferences.strengthTargetReps} reps</Body>
            <Body>Top-set: {guidedWorkoutPreferences.topSetTargetReps} reps</Body>
            <Body>Back-off start: {guidedWorkoutPreferences.backoffPercentage}%</Body>
            <Body>Progression pause: {guidedWorkoutPreferences.inactivityDays} days</Body>
          </View>
          <Body>{guidedCounts.map(({ category, count }) => `${guidedCategoryLabels[category]}: ${count}`).join(" | ")}</Body>
          <Body>Warm-up sets never count toward progression or best sessions.</Body>
        </DetailsDisclosure>
      </Panel>

      <Panel>
        <SectionTitle>Workout logging</SectionTitle>
        <Body style={styles.importNotice}>
          {guidedWorkoutPreferences.flowMode
            ? "Flow mode: each set starts from your last session. Turn the dial to change weight or reps, then tap Done; rest starts on its own."
            : "Classic: edit every set in a list, then save the exercise."}
        </Body>
        <View accessibilityRole="radiogroup" style={styles.unitRow}>
          {([[true, "Flow mode"], [false, "Classic list"]] as const).map(([flowMode, label]) => (
            <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: guidedWorkoutPreferences.flowMode === flowMode }}
              onPress={() => {
                if (guidedWorkoutPreferences.flowMode === flowMode) return;
                setLoggingError(null);
                void saveGuidedWorkoutPreferences({ ...guidedWorkoutPreferences, flowMode }).catch((error) => setLoggingError(error instanceof Error ? error.message : "Your logging choice could not be saved. Try again."));
              }}
              style={[styles.unitButton, guidedWorkoutPreferences.flowMode === flowMode && styles.unitButtonActive]}>
              <Body style={[styles.unitText, guidedWorkoutPreferences.flowMode === flowMode && styles.unitTextActive]}>{label}</Body>
            </Pressable>
          ))}
        </View>
        {loggingError ? <Body accessibilityRole="alert">{loggingError}</Body> : null}
      </Panel>

      <Panel>
        <SectionTitle>Import</SectionTitle>
        <Body style={styles.importNotice}>Import workouts and body check-ins from a JSON backup.</Body>
        <DetailsDisclosure title="JSON format and import rules">
          <Body style={styles.importNotice}>Exercise names must match the app catalog. Existing workout sources are skipped. Body check-ins fill empty dates; occupied dates are preserved.</Body>
          <TextInput
            style={[styles.importInput, styles.sampleInput]}
            value={sampleImportJson}
            multiline
            editable={false}
            textAlignVertical="top"
          />
        </DetailsDisclosure>
        <View style={styles.importActions}>
          {Platform.OS === "web" ? (
            <Pressable onPress={chooseImportFile} style={pressableFeedback(styles.secondaryButton)}>
              <FileUp size={18} color={palette.ink} />
              <Body style={styles.secondaryButtonText}>Choose JSON</Body>
            </Pressable>
          ) : null}
          <Pressable disabled={!preview || isImporting} onPress={() => void handleImport()} style={pressableFeedback([styles.importButton, (!preview || isImporting) && styles.importButtonDisabled])}>
            <Check size={18} color={palette.surface} />
            <Body style={styles.importButtonText}>{isImporting ? "Importing" : "Import"}</Body>
          </Pressable>
        </View>
        {importMessage ? <Body style={styles.importNotice}>{importMessage}</Body> : null}
        {preview?.warnings.length ? <Body style={styles.importNotice}>{preview.warnings.slice(0, 3).join(" ")}</Body> : null}
        {importError ? <Body style={styles.importError}>{importError}</Body> : null}
      </Panel>

      <Panel>
        <SectionTitle>Workout load units</SectionTitle>
        <View style={styles.unitRow}>
          {(["lb", "kg"] as const).map((unit) => (
            <Pressable key={unit} onPress={() => void setUnitSystem(unit)} style={[styles.unitButton, unitSystem === unit && styles.unitButtonActive]}>
              <Body style={[styles.unitText, unitSystem === unit && styles.unitTextActive]}>{unit}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>

      <Panel>
        <SectionTitle>Body units</SectionTitle>
        <Body style={styles.importNotice}>Body weight and tape measurements can use independent units.</Body>
        <Label>Body weight</Label>
        <View style={styles.unitRow}>
          {(["kg", "lb"] as const).map((unit) => (
            <Pressable
              key={unit}
              onPress={() => void setBodyUnitPreferences({ ...bodyUnitPreferences, weight: unit })}
              style={[styles.unitButton, bodyUnitPreferences.weight === unit && styles.unitButtonActive]}
            >
              <Body style={[styles.unitText, bodyUnitPreferences.weight === unit && styles.unitTextActive]}>{unit}</Body>
            </Pressable>
          ))}
        </View>
        <Label>Tape measurements</Label>
        <View style={styles.unitRow}>
          {(["in", "cm"] as const).map((unit) => (
            <Pressable
              key={unit}
              onPress={() => void setBodyUnitPreferences({ ...bodyUnitPreferences, circumference: unit })}
              style={[styles.unitButton, bodyUnitPreferences.circumference === unit && styles.unitButtonActive]}
            >
              <Body style={[styles.unitText, bodyUnitPreferences.circumference === unit && styles.unitTextActive]}>{unit}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>
    </Screen>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  formulaDetails: {
    gap: spacing.sm
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  accountText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  accountName: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  logoutButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  logoutText: {
    color: palette.danger,
    fontWeight: "700"
  },
  importInput: {
    minHeight: 132,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surfaceAlt,
    color: palette.ink,
    padding: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700"
  },
  sampleInput: {
    minHeight: 300,
    color: palette.muted,
    fontFamily: "monospace"
  },
  importActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
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
    paddingHorizontal: spacing.md,
    ...fastTouchStyle,
    backgroundColor: palette.surfaceAlt
  },
  secondaryButtonText: {
    color: palette.ink,
    fontWeight: "900"
  },
  importButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  importButtonDisabled: {
    opacity: 0.45
  },
  importButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  importNotice: {
    color: palette.muted,
    fontWeight: "700"
  },
  importError: {
    color: palette.danger,
    fontWeight: "800"
  },
  panelHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  editButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.sm
  },
  editButtonText: {
    color: palette.ink,
    fontWeight: "900"
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.lg,
    rowGap: spacing.xs
  },
  unitRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  unitButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center"
  },
  unitButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  unitText: {
    color: palette.ink,
    fontWeight: "900"
  },
  unitTextActive: {
    color: palette.surface
  }
}));
