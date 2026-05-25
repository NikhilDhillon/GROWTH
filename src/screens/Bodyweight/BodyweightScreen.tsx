import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Check, Pencil, Plus, Save, Trash2, X } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BodyWeightLog } from "@/types";
import { formatShortDate, todayIso } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { bodyWeightDisplayUnit, bodyWeightFromStorageUnit, formatBodyWeight, formatBodyWeightInput } from "@/utils/units";

type BodyweightRange = "week" | "month" | "year" | "all";
type SaveState = "idle" | "saving" | "saved";

const ranges: Array<{ key: BodyweightRange; label: string }> = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All" }
];

export function BodyweightScreen() {
  const { width } = useWindowDimensions();
  const logs = useFitnessStore((state) => state.bodyWeightLogs);
  const saveBodyWeightLog = useFitnessStore((state) => state.saveBodyWeightLog);
  const updateBodyWeightLog = useFitnessStore((state) => state.updateBodyWeightLog);
  const deleteBodyWeightLog = useFitnessStore((state) => state.deleteBodyWeightLog);
  const [editing, setEditing] = useState<BodyWeightLog | null>(null);
  const [loggedDate, setLoggedDate] = useState(todayIso());
  const [weight, setWeight] = useState("");
  const [range, setRange] = useState<BodyweightRange>("month");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const latest = logs[0];
  const isCompact = width < 430;
  const sortedLogs = [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at));
  const filteredLogs = filterLogsByRange(sortedLogs, range);
  const graphPoints = range === "year" || range === "all"
    ? buildMonthlyAveragePoints(filteredLogs)
    : filteredLogs.map((log) => ({
        key: String(log.id),
        label: formatShortDate(log.logged_at.slice(0, 10)),
        value: displayWeight(log.weight),
        details: [log.logged_at.slice(0, 10)]
      }));

  async function handleSave() {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      if (editing) {
        await updateBodyWeightLog({ id: editing.id, loggedDate, weight, unitSystem: bodyWeightDisplayUnit });
      } else {
        await saveBodyWeightLog({ loggedDate, weight, unitSystem: bodyWeightDisplayUnit });
      }
      clearForm();
      showSaved(setSaveState);
    } catch (error) {
      setSaveState("idle");
      throw error;
    }
  }

  function startEdit(log: BodyWeightLog) {
    setEditing(log);
    setLoggedDate(log.logged_at.slice(0, 10));
    setWeight(formatBodyWeightInput(log.weight));
  }

  function clearForm() {
    setEditing(null);
    setLoggedDate(todayIso());
    setWeight("");
  }

  function displayWeight(value: number) {
    return bodyWeightFromStorageUnit(value);
  }

  async function handleDelete(id: number) {
    if (deletingId !== null) return;
    setDeletingId(id);
    try {
      await deleteBodyWeightLog(id);
    } finally {
      setDeletingId(null);
    }
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
            <SectionTitle>{latest ? formatBodyWeight(latest.weight) : "--"}</SectionTitle>
          </View>
          <Body>{latest ? formatShortDate(latest.logged_at.slice(0, 10)) : "Bodyweight data required"}</Body>
        </View>
        <View style={styles.chipRow}>
          {ranges.map((item) => (
            <Pressable key={item.key} onPress={() => setRange(item.key)} style={[styles.chip, range === item.key && styles.chipActive]}>
              <Body style={[styles.chipText, range === item.key && styles.chipTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
        </View>
        <LineGraph points={graphPoints} maxPoints={graphPoints.length || 1} suffix={` ${bodyWeightDisplayUnit}`} emptyMessage={`Bodyweight data required for this ${rangeLabel(range)}.`} />
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
        <View style={[styles.inputRow, isCompact && styles.inputRowCompact]}>
          <View style={styles.inputControls}>
            <TextInput style={styles.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" inputMode="decimal" placeholder={bodyWeightDisplayUnit} />
            <View style={styles.unitBadge}>
              <Body style={styles.unitBadgeText}>{bodyWeightDisplayUnit}</Body>
            </View>
          </View>
          <Pressable disabled={saveState === "saving"} hitSlop={touchHitSlop} style={pressableFeedback([styles.primaryButton, isCompact && styles.primaryButtonCompact])} onPress={handleSave}>
            {saveState === "saving" ? <ActivityIndicator color={palette.surface} /> : saveState === "saved" ? <Check size={18} color={palette.surface} /> : editing ? <Save size={18} color={palette.surface} /> : <Plus size={18} color={palette.surface} />}
            <Body style={styles.primaryButtonText}>{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : editing ? "Update" : "Add"}</Body>
          </Pressable>
        </View>
      </Panel>

      <Panel>
        <SectionTitle>History</SectionTitle>
        {logs.length ? logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.logText}>
              <Body style={styles.logDate}>{formatShortDate(log.logged_at.slice(0, 10))}</Body>
              <SectionTitle>{formatBodyWeight(log.weight)}</SectionTitle>
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityLabel={`Edit bodyweight from ${log.logged_at.slice(0, 10)}`} hitSlop={touchHitSlop} onPress={() => startEdit(log)} style={pressableFeedback(styles.iconButton)}>
                <Pencil size={17} color={palette.ink} />
              </Pressable>
              <Pressable disabled={deletingId === log.id} accessibilityLabel={`Delete bodyweight from ${log.logged_at.slice(0, 10)}`} hitSlop={touchHitSlop} onPress={() => void handleDelete(log.id)} style={pressableFeedback(styles.iconButton)}>
                {deletingId === log.id ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={17} color={palette.danger} />}
              </Pressable>
            </View>
          </View>
        )) : <Body>No bodyweight entries yet.</Body>}
      </Panel>
    </Screen>
  );
}

function filterLogsByRange(logs: BodyWeightLog[], range: BodyweightRange) {
  if (range === "all") return logs;

  const today = new Date(`${todayIso()}T00:00:00`);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - rangeDays(range) + 1);

  return logs.filter((log) => {
    const loggedDate = new Date(`${log.logged_at.slice(0, 10)}T00:00:00`);
    return loggedDate >= cutoff && loggedDate <= today;
  });
}

function rangeDays(range: Exclude<BodyweightRange, "all">) {
  if (range === "week") return 7;
  if (range === "month") return 30;
  return 365;
}

function rangeLabel(range: BodyweightRange) {
  if (range === "all") return "range";
  return range;
}

function buildMonthlyAveragePoints(logs: BodyWeightLog[]) {
  const buckets = logs.reduce<Map<string, BodyWeightLog[]>>((groups, log) => {
    const key = log.logged_at.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), log]);
    return groups;
  }, new Map());

  return [...buckets.entries()].map(([month, monthLogs]) => {
    const average = monthLogs.reduce((total, log) => total + log.weight, 0) / monthLogs.length;
    return {
      key: month,
      label: formatMonthLabel(month),
      value: bodyWeightFromStorageUnit(average),
      details: [`${monthLogs.length} ${monthLogs.length === 1 ? "entry" : "entries"} averaged`]
    };
  });
}

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function showSaved(setState: (state: SaveState) => void) {
  setState("saved");
  setTimeout(() => setState("idle"), 900);
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: palette.surface
  },
  chipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  chipText: {
    color: palette.ink,
    fontWeight: "800"
  },
  chipTextActive: {
    color: palette.surface
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "stretch"
  },
  inputRowCompact: {
    flexDirection: "column"
  },
  inputControls: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "stretch"
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800"
  },
  unitBadge: {
    minWidth: 48,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: palette.ink,
    ...fastTouchStyle
  },
  unitBadgeText: {
    color: palette.surface,
    fontWeight: "900"
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
  primaryButtonCompact: {
    width: "100%"
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
