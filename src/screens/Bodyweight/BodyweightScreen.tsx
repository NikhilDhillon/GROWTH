import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BodyWeightLog, UnitSystem } from "@/types";
import { formatShortDate, todayIso } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatWeight, formatWeightInput } from "@/utils/units";

export function BodyweightScreen() {
  const logs = useFitnessStore((state) => state.bodyWeightLogs);
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const saveBodyWeightLog = useFitnessStore((state) => state.saveBodyWeightLog);
  const updateBodyWeightLog = useFitnessStore((state) => state.updateBodyWeightLog);
  const deleteBodyWeightLog = useFitnessStore((state) => state.deleteBodyWeightLog);
  const [editing, setEditing] = useState<BodyWeightLog | null>(null);
  const [loggedDate, setLoggedDate] = useState(todayIso());
  const [weight, setWeight] = useState("");
  const [entryUnit, setEntryUnit] = useState<UnitSystem>(unitSystem);
  const latest = logs[0];
  const sortedLogs = [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at));
  const graphPoints = sortedLogs.map((log) => ({
    key: String(log.id),
    label: formatShortDate(log.logged_at.slice(0, 10)),
    value: displayWeight(log.weight),
    details: [log.logged_at.slice(0, 10)]
  }));

  useEffect(() => {
    if (!editing) setEntryUnit(unitSystem);
  }, [editing, unitSystem]);

  async function handleSave() {
    if (editing) {
      await updateBodyWeightLog({ id: editing.id, loggedDate, weight, unitSystem: entryUnit });
    } else {
      await saveBodyWeightLog({ loggedDate, weight, unitSystem: entryUnit });
    }
    clearForm();
  }

  function startEdit(log: BodyWeightLog) {
    setEditing(log);
    setLoggedDate(log.logged_at.slice(0, 10));
    setEntryUnit(log.unit);
    setWeight(formatWeightInput(log.weight, log.unit));
  }

  function clearForm() {
    setEditing(null);
    setLoggedDate(todayIso());
    setWeight("");
    setEntryUnit(unitSystem);
  }

  function displayWeight(value: number) {
    return Number(formatWeightInput(value, unitSystem));
  }

  return (
    <Screen>
      <View>
        <Label>Bodyweight tracking</Label>
        <Title>Bodyweight</Title>
      </View>

      <Panel>
        <View style={styles.summaryRow}>
          <View>
            <Label>Latest</Label>
            <SectionTitle>{latest ? formatWeight(latest.weight, unitSystem) : "--"}</SectionTitle>
          </View>
          <Body>{latest ? formatShortDate(latest.logged_at.slice(0, 10)) : "Bodyweight data required"}</Body>
        </View>
        <LineGraph points={graphPoints} suffix={` ${unitSystem}`} emptyMessage="Add bodyweight entries to draw a trend." />
      </Panel>

      <Panel>
        <View style={styles.summaryRow}>
          <SectionTitle>{editing ? "Edit entry" : "Add entry"}</SectionTitle>
          {editing ? (
            <Pressable accessibilityLabel="Cancel edit" hitSlop={touchHitSlop} onPress={clearForm} style={pressableFeedback(styles.iconButton)}>
              <X size={18} color={palette.ink} />
            </Pressable>
          ) : null}
        </View>
        <DatePickerField value={loggedDate} onChange={setLoggedDate} />
        <View style={styles.inputRow}>
          <TextInput style={styles.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" inputMode="decimal" placeholder={entryUnit} />
          <View style={styles.unitToggle}>
            {(["lb", "kg"] as UnitSystem[]).map((unit) => (
              <Pressable
                key={unit}
                hitSlop={touchHitSlop}
                onPress={() => setEntryUnit(unit)}
                style={pressableFeedback([styles.unitButton, entryUnit === unit && styles.unitButtonActive])}
              >
                <Body style={[styles.unitButtonText, entryUnit === unit && styles.unitButtonTextActive]}>{unit}</Body>
              </Pressable>
            ))}
          </View>
          <Pressable hitSlop={touchHitSlop} style={pressableFeedback(styles.primaryButton)} onPress={handleSave}>
            {editing ? <Save size={18} color={palette.surface} /> : <Plus size={18} color={palette.surface} />}
            <Body style={styles.primaryButtonText}>{editing ? "Update" : "Add"}</Body>
          </Pressable>
        </View>
      </Panel>

      <Panel>
        <SectionTitle>History</SectionTitle>
        {logs.length ? logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.logText}>
              <Body style={styles.logDate}>{formatShortDate(log.logged_at.slice(0, 10))}</Body>
              <SectionTitle>{formatWeight(log.weight, unitSystem)}</SectionTitle>
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityLabel={`Edit bodyweight from ${log.logged_at.slice(0, 10)}`} hitSlop={touchHitSlop} onPress={() => startEdit(log)} style={pressableFeedback(styles.iconButton)}>
                <Pencil size={17} color={palette.ink} />
              </Pressable>
              <Pressable accessibilityLabel={`Delete bodyweight from ${log.logged_at.slice(0, 10)}`} hitSlop={touchHitSlop} onPress={() => void deleteBodyWeightLog(log.id)} style={pressableFeedback(styles.iconButton)}>
                <Trash2 size={17} color={palette.danger} />
              </Pressable>
            </View>
          </View>
        )) : <Body>No bodyweight entries yet.</Body>}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "stretch"
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontWeight: "800"
  },
  unitToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: palette.surfaceAlt
  },
  unitButton: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  unitButtonActive: {
    backgroundColor: palette.ink
  },
  unitButtonText: {
    color: palette.muted,
    fontWeight: "900"
  },
  unitButtonTextActive: {
    color: palette.surface
  },
  primaryButton: {
    minHeight: 44,
    minWidth: 104,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  logRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md
  },
  logText: {
    flex: 1,
    minWidth: 0
  },
  logDate: {
    color: palette.muted
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  }
});
