import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
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
import { bodyWeightFromStorageUnit, formatBodyWeight, formatBodyWeightInput } from "@/utils/units";

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
  const unit = useFitnessStore((state) => state.bodyUnitPreferences.weight);
  const saveBodyWeightLog = useFitnessStore((state) => state.saveBodyWeightLog);
  const updateBodyWeightLog = useFitnessStore((state) => state.updateBodyWeightLog);
  const deleteBodyWeightLog = useFitnessStore((state) => state.deleteBodyWeightLog);
  const [editing, setEditing] = useState<BodyWeightLog | null>(null);
  const [loggedDate, setLoggedDate] = useState(todayIso());
  const [weight, setWeight] = useState("");
  const [range, setRange] = useState<BodyweightRange>("month");
  const [showTrendLine, setShowTrendLine] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = logs[0] ?? null;
  const isCompact = width < 430;
  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at) || a.created_at.localeCompare(b.created_at)),
    [logs]
  );
  const filteredLogs = filterLogsByRange(sortedLogs, range);
  const rangeAverage = averageBodyWeight(filteredLogs);
  const graphPoints = range === "year" || range === "all"
    ? buildMonthlyAveragePoints(filteredLogs, unit)
    : filteredLogs.map((log) => ({
        date: log.logged_at.slice(0, 10),
        label: formatShortDate(log.logged_at.slice(0, 10)),
        value: bodyWeightFromStorageUnit(log.weight, unit),
        details: [formatBodyWeight(log.weight, unit)]
      }));

  async function handleSave() {
    if (saveState === "saving") return;
    setSaveState("saving");
    setError(null);
    try {
      if (editing) {
        await updateBodyWeightLog({ id: editing.id, loggedDate, weight, unitSystem: unit });
      } else {
        await saveBodyWeightLog({ loggedDate, weight, unitSystem: unit });
      }
      clearForm();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 900);
    } catch (saveError) {
      setSaveState("idle");
      setError(saveError instanceof Error ? saveError.message : "Could not save this bodyweight entry.");
    }
  }

  function startEdit(log: BodyWeightLog) {
    setEditing(log);
    setLoggedDate(bodyweightDate(log));
    setWeight(formatBodyWeightInput(log.weight, unit));
    setError(null);
  }

  function clearForm() {
    setEditing(null);
    setLoggedDate(todayIso());
    setWeight("");
    setError(null);
  }

  function confirmDelete(log: BodyWeightLog) {
    Alert.alert(
      "Delete bodyweight entry?",
      "Strength scores that use this bodyweight may change. Tape measurements saved on the same date will be preserved.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void handleDelete(log.id) }
      ]
    );
  }

  async function handleDelete(id: number) {
    if (deletingId !== null) return;
    setDeletingId(id);
    try {
      await deleteBodyWeightLog(id);
      if (editing?.id === id) clearForm();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Screen>
      <View>
        <Label>Weight tracking</Label>
        <Title>Bodyweight</Title>
      </View>

      <Panel>
        <View style={styles.summaryRow}>
          <View>
            <Label>Latest</Label>
            <SectionTitle>{latest ? formatBodyWeight(latest.weight, unit) : "--"}</SectionTitle>
          </View>
          <View style={styles.summaryMetric}>
            <Label>{rangeAverageLabel(range)}</Label>
            <SectionTitle>{rangeAverage !== null ? formatBodyWeight(rangeAverage, unit) : "--"}</SectionTitle>
          </View>
        </View>
        <View style={styles.chipRow}>
          {ranges.map((item) => (
            <Pressable key={item.key} onPress={() => setRange(item.key)} style={pressableFeedback([styles.chip, range === item.key && styles.chipActive])}>
              <Body style={[styles.chipText, range === item.key && styles.chipTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
          <Pressable accessibilityLabel="Toggle bodyweight trendline" onPress={() => setShowTrendLine((value) => !value)} style={pressableFeedback([styles.chip, showTrendLine && styles.trendChipActive])}>
            <Body style={[styles.chipText, showTrendLine && styles.chipTextActive]}>Trendline</Body>
          </Pressable>
        </View>
        <LineGraph
          points={graphPoints}
          maxPoints={graphPoints.length || 1}
          suffix={` ${unit}`}
          emptyMessage={`Add a bodyweight entry to draw this ${rangeLabel(range)} trend.`}
          showTrendLine={showTrendLine}
        />
      </Panel>

      <Panel>
        <View style={styles.summaryRow}>
          <View>
            <Label>{editing ? "Editing entry" : "New entry"}</Label>
            <SectionTitle>{editing ? formatShortDate(bodyweightDate(editing)) : "Add bodyweight"}</SectionTitle>
          </View>
          {editing ? (
            <Pressable accessibilityLabel="Cancel edit" hitSlop={touchHitSlop} onPress={clearForm} style={pressableFeedback(styles.iconButton)}>
              <X size={18} color={palette.ink} />
            </Pressable>
          ) : null}
        </View>
        <DatePickerField value={loggedDate} onChange={setLoggedDate} />
        <View style={[styles.inputRow, isCompact && styles.inputRowCompact]}>
          <View style={styles.inputControls}>
            <TextInput
              accessibilityLabel="Bodyweight"
              style={styles.input}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={unit === "kg" ? "e.g. 80" : "e.g. 175"}
            />
            <View style={styles.unitBadge}>
              <Body style={styles.unitBadgeText}>{unit}</Body>
            </View>
          </View>
          <Pressable disabled={saveState === "saving"} hitSlop={touchHitSlop} style={pressableFeedback([styles.primaryButton, isCompact && styles.primaryButtonCompact])} onPress={() => void handleSave()}>
            {saveState === "saving" ? <ActivityIndicator color={palette.surface} /> : saveState === "saved" ? <Check size={18} color={palette.surface} /> : editing ? <Save size={18} color={palette.surface} /> : <Plus size={18} color={palette.surface} />}
            <Body style={styles.primaryButtonText}>{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : editing ? "Update" : "Add"}</Body>
          </Pressable>
        </View>
        {error ? <Body style={styles.errorText}>{error}</Body> : null}
      </Panel>

      <Panel>
        <SectionTitle>History</SectionTitle>
        {logs.length ? logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.logText}>
              <Body style={styles.logDate}>{formatShortDate(bodyweightDate(log))}</Body>
              <SectionTitle>{formatBodyWeight(log.weight, unit)}</SectionTitle>
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityLabel={`Edit bodyweight from ${bodyweightDate(log)}`} hitSlop={touchHitSlop} onPress={() => startEdit(log)} style={pressableFeedback(styles.iconButton)}>
                <Pencil size={17} color={palette.ink} />
              </Pressable>
              <Pressable disabled={deletingId === log.id} accessibilityLabel={`Delete bodyweight from ${bodyweightDate(log)}`} hitSlop={touchHitSlop} onPress={() => confirmDelete(log)} style={pressableFeedback(styles.iconButton)}>
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
    const loggedDate = new Date(`${bodyweightDate(log)}T00:00:00`);
    return loggedDate >= cutoff && loggedDate <= today;
  });
}

function rangeDays(range: Exclude<BodyweightRange, "all">) {
  if (range === "week") return 7;
  if (range === "month") return 30;
  return 365;
}

function rangeLabel(range: BodyweightRange) {
  return range === "all" ? "all-time" : range;
}

function rangeAverageLabel(range: BodyweightRange) {
  return `${range === "all" ? "All-time" : range[0].toUpperCase() + range.slice(1)} average`;
}

function buildMonthlyAveragePoints(logs: BodyWeightLog[], unit: "lb" | "kg") {
  const buckets = logs.reduce<Map<string, BodyWeightLog[]>>((groups, log) => {
    const key = bodyweightDate(log).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), log]);
    return groups;
  }, new Map());

  return [...buckets.entries()].map(([month, monthLogs]) => {
    const average = averageBodyWeight(monthLogs) ?? 0;
    return {
      date: month,
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      value: bodyWeightFromStorageUnit(average, unit),
      details: [`${monthLogs.length} ${monthLogs.length === 1 ? "entry" : "entries"} averaged`]
    };
  });
}

function averageBodyWeight(logs: BodyWeightLog[]) {
  if (!logs.length) return null;
  return logs.reduce((total, log) => total + log.weight, 0) / logs.length;
}

function bodyweightDate(log: BodyWeightLog) {
  return log.logged_date ?? log.logged_at.slice(0, 10);
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.md
  },
  summaryMetric: {
    alignItems: "flex-end",
    minWidth: 120
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface
  },
  chipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  trendChipActive: {
    backgroundColor: palette.blue,
    borderColor: palette.blue
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
    gap: spacing.sm
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
    minWidth: 52,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md
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
  errorText: {
    color: palette.danger,
    fontWeight: "800"
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
