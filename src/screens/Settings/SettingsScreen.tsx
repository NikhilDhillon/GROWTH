import { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, FileUp, LogOut } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { ImportPreview, parseImportData } from "@/services/import/importService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback } from "@/utils/touch";

const sampleImportJson = `{
  "schemaVersion": 1,
  "unit": "lb",
  "bodyweightUnit": "kg",
  "bodyweight": [
    { "date": "2026-05-24", "weight": 82.4 }
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
            { "reps": 5, "weight": 225 },
            { "reps": 5, "weight": 225 }
          ]
        }
      ]
    }
  ]
}`;

export function SettingsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const logout = useFitnessStore((state) => state.logout);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const setUnitSystem = useFitnessStore((state) => state.setUnitSystem);
  const importTrainingData = useFitnessStore((state) => state.importTrainingData);
  const strengthCount = exercises.filter((exercise) => exercise.is_strength_exercise).length;
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedFileText, setSelectedFileText] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  function validateImport(text: string) {
    setImportError(null);
    setImportMessage(null);
    try {
      const nextPreview = parseImportData(text, exercises);
      setPreview(nextPreview);
      setImportMessage(`Ready: ${nextPreview.bodyWeightCount} bodyweight, ${nextPreview.workoutCount} workout logs, ${nextPreview.setCount} sets.`);
    } catch (error) {
      setPreview(null);
      setImportError(error instanceof Error ? error.message : "Could not validate import data.");
    }
  }

  async function handleImport() {
    const selectedPreview = preview ?? parseImportData(selectedFileText, exercises);
    setIsImporting(true);
    setImportError(null);
    try {
      await importTrainingData(selectedPreview);
      setSelectedFileText("");
      setPreview(null);
      setImportMessage(`Imported ${selectedPreview.bodyWeightCount} bodyweight entries and ${selectedPreview.workoutCount} workout logs.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import data.");
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
      <View>
        <Label>Account configuration</Label>
        <Title>Settings</Title>
      </View>

      <Panel>
        <SectionTitle>Account</SectionTitle>
        <Body>{currentUser ? `${currentUser.name} (${currentUser.email})` : "Not signed in"}</Body>
        <Pressable style={styles.logoutButton} onPress={() => void logout()}>
          <LogOut size={18} color={palette.surface} />
          <Body style={styles.logoutText}>Logout</Body>
        </Pressable>
      </Panel>

      <Panel>
        <SectionTitle>Performance Points formula</SectionTitle>
        <Body>Eligible sessions use two or more externally loaded sets of 1 to 10 reps. Points combine best estimated 1RM (45%), failure-set volume (35%), and fatigue resistance (20%) against the exercise's prior best-strength session.</Body>
      </Panel>

      <Panel>
        <SectionTitle>Exercise tracking</SectionTitle>
        <Body>{exercises.length} standard exercises available. {strengthCount} selected for logging and scoring.</Body>
      </Panel>

      <Panel>
        <SectionTitle>Import</SectionTitle>
        <Body style={styles.importNotice}>Paste JSON matching this structure. Exercise names must match the app exercise catalog.</Body>
        <TextInput
          style={[styles.importInput, styles.sampleInput]}
          value={sampleImportJson}
          multiline
          editable={false}
          textAlignVertical="top"
        />
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
        <SectionTitle>Units</SectionTitle>
        <View style={styles.unitRow}>
          {(["lb", "kg"] as const).map((unit) => (
            <Pressable key={unit} onPress={() => void setUnitSystem(unit)} style={[styles.unitButton, unitSystem === unit && styles.unitButtonActive]}>
              <Body style={[styles.unitText, unitSystem === unit && styles.unitTextActive]}>{unit}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoutButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  logoutText: {
    color: palette.surface,
    fontWeight: "900"
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
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
});
