import { ReactNode, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Save, Trash2, X } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { LineGraph } from "@/components/LineGraph";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { BodyLimbMeasurement, BodyMeasurementLog, BodyMeasurementValues } from "@/types";
import {
  BodyMeasurementKey,
  bodyMeasurementDefinitions,
  bodyMeasurementValuesFromStorage,
  formatCircumference,
  formatCircumferenceInput
} from "@/utils/bodyMeasurements";
import { formatShortDate, todayIso } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";

type BodyRange = "week" | "month" | "year" | "all";
type SaveState = "idle" | "saving" | "saved";
type MetricKey = BodyMeasurementKey;
type FieldDraft = {
  mode: "single" | "sides";
  value: string;
  left: string;
  right: string;
};

const ranges: Array<{ key: BodyRange; label: string }> = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All" }
];

const metricOptions: Array<{ key: MetricKey; label: string }> = [
  ...bodyMeasurementDefinitions.map((definition) => ({ key: definition.key, label: definition.label }))
];

export function BodyMeasurementsScreen({ progressTabs }: { progressTabs?: ReactNode }) {
  const { width } = useWindowDimensions();
  const allLogs = useFitnessStore((state) => state.bodyMeasurementLogs);
  const preferences = useFitnessStore((state) => state.bodyUnitPreferences);
  const saveBodyMeasurementLog = useFitnessStore((state) => state.saveBodyMeasurementLog);
  const updateBodyMeasurementLog = useFitnessStore((state) => state.updateBodyMeasurementLog);
  const deleteBodyMeasurementLog = useFitnessStore((state) => state.deleteBodyMeasurementLog);
  const [editing, setEditing] = useState<BodyMeasurementLog | null>(null);
  const [loggedDate, setLoggedDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState<Record<BodyMeasurementKey, FieldDraft>>(emptyFields);
  const [showAll, setShowAll] = useState(false);
  const [range, setRange] = useState<BodyRange>("month");
  const [metric, setMetric] = useState<MetricKey>("waist");
  const [showTrendLine, setShowTrendLine] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCompact = width < 520;
  const logs = useMemo(
    () => allLogs.filter((log) => Object.keys(log.measurements).length > 0),
    [allLogs]
  );
  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => a.logged_date.localeCompare(b.logged_date) || a.created_at.localeCompare(b.created_at)),
    [logs]
  );
  const rangedLogs = filterLogsByRange(sortedLogs, range);
  const series = buildMetricSeries(rangedLogs, metric, preferences.circumference, range);
  const latest = logs[0] ?? null;
  const recentlyUsed = new Set<BodyMeasurementKey>(latest ? Object.keys(latest.measurements) as BodyMeasurementKey[] : []);
  recentlyUsed.add("waist");
  const visibleDefinitions = showAll || editing
    ? bodyMeasurementDefinitions
    : bodyMeasurementDefinitions.filter((definition) => recentlyUsed.has(definition.key));
  const groups = ["Torso", "Arms", "Legs"] as const;

  async function handleSave() {
    if (saveState === "saving") return;
    const validationError = validateDraftFields(fields);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaveState("saving");
    setError(null);
    const measurements = draftToMeasurements(fields);
    try {
      if (editing) {
        await updateBodyMeasurementLog({ id: editing.id, loggedDate, weight: "", measurements, notes });
      } else {
        await saveBodyMeasurementLog({ loggedDate, weight: "", measurements, notes });
      }
      clearForm();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 900);
    } catch (saveError) {
      setSaveState("idle");
      setError(saveError instanceof Error ? saveError.message : "Could not save this body check-in.");
    }
  }

  function startEdit(log: BodyMeasurementLog) {
    setEditing(log);
    setLoggedDate(log.logged_date);
    setNotes(log.notes ?? "");
    setFields(fieldsFromLog(log, preferences.circumference));
    setShowAll(true);
    setError(null);
  }

  function clearForm() {
    setEditing(null);
    setLoggedDate(todayIso());
    setNotes("");
    setFields(emptyFields());
    setShowAll(false);
    setError(null);
  }

  function confirmDelete(log: BodyMeasurementLog) {
    Alert.alert(
      "Delete measurements?",
      "This removes the tape measurements saved for this date. A bodyweight entry on the same date will be preserved.",
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
      await deleteBodyMeasurementLog(id);
      if (editing?.id === id) clearForm();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Screen>
      <View>
        <Label>Tape-measure trends</Label>
        <Title>Body measurements</Title>
      </View>
      {progressTabs}

      <View style={styles.summaryGrid}>
        <LatestMetricCard title="Waist" metric="waist" logs={sortedLogs} preferences={preferences} />
        <LatestMetricCard title="Abdomen" metric="abdomen" logs={sortedLogs} preferences={preferences} />
        <LatestMetricCard title="Arm (flexed)" metric="arm_flexed" logs={sortedLogs} preferences={preferences} />
        <LatestMetricCard title="Thigh" metric="thigh" logs={sortedLogs} preferences={preferences} />
      </View>

      <Panel>
        <View style={styles.rowBetween}>
          <SectionTitle>Trend</SectionTitle>
          <Pressable
            accessibilityLabel="Toggle trendline"
            onPress={() => setShowTrendLine((value) => !value)}
            style={pressableFeedback([styles.secondaryButton, showTrendLine && styles.secondaryButtonActive])}
          >
            <Body style={[styles.secondaryButtonText, showTrendLine && styles.secondaryButtonTextActive]}>Trendline</Body>
          </Pressable>
        </View>
        <View style={styles.chipRow}>
          {metricOptions.map((item) => (
            <Pressable key={item.key} onPress={() => setMetric(item.key)} style={pressableFeedback([styles.chip, metric === item.key && styles.chipActive])}>
              <Body style={[styles.chipText, metric === item.key && styles.chipTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
        </View>
        <View style={styles.chipRow}>
          {ranges.map((item) => (
            <Pressable key={item.key} onPress={() => setRange(item.key)} style={pressableFeedback([styles.rangeChip, range === item.key && styles.rangeChipActive])}>
              <Body style={[styles.rangeText, range === item.key && styles.rangeTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
        </View>
        {series.length ? series.map((item) => (
          <View key={item.label} style={styles.graphSection}>
            {series.length > 1 ? <Label>{item.label}</Label> : null}
            <LineGraph
              points={item.points}
              maxPoints={item.points.length || 1}
              suffix={` ${item.unit}`}
              emptyMessage={`No ${item.label.toLowerCase()} data for this range.`}
              showTrendLine={showTrendLine}
            />
          </View>
        )) : <LineGraph points={[]} emptyMessage="Add a matching body check-in to draw this trend." />}
      </Panel>

      <Panel>
        <View style={styles.rowBetween}>
          <View>
            <Label>{editing ? "Editing check-in" : "New check-in"}</Label>
            <SectionTitle>{editing ? formatShortDate(editing.logged_date) : "Add measurements"}</SectionTitle>
          </View>
          {editing ? (
            <Pressable accessibilityLabel="Cancel edit" hitSlop={touchHitSlop} onPress={clearForm} style={pressableFeedback(styles.iconButton)}>
              <X size={18} color={palette.ink} />
            </Pressable>
          ) : null}
        </View>

        <DatePickerField value={loggedDate} onChange={setLoggedDate} />

        {groups.map((group) => {
          const definitions = visibleDefinitions.filter((definition) => definition.group === group);
          if (!definitions.length) return null;
          return (
            <View key={group} style={styles.measurementGroup}>
              <Label>{group}</Label>
              <View style={styles.inputGrid}>
                {definitions.map((definition) => {
                  const draft = fields[definition.key];
                  return (
                    <View key={definition.key} style={[styles.fieldCard, isCompact && styles.fieldCardCompact]}>
                      <View style={styles.fieldHeader}>
                        <Label style={styles.fieldLabel}>{definition.label}</Label>
                        {definition.sided ? (
                          <Pressable
                            accessibilityLabel={`${draft.mode === "single" ? "Track left and right" : "Track one value"} for ${definition.label}`}
                            onPress={() => setFields((current) => ({
                              ...current,
                              [definition.key]: { ...current[definition.key], mode: current[definition.key].mode === "single" ? "sides" : "single" }
                            }))}
                            style={pressableFeedback([styles.modeButton, draft.mode === "sides" && styles.modeButtonActive])}
                          >
                            <Body style={[styles.modeText, draft.mode === "sides" && styles.modeTextActive]}>{draft.mode === "sides" ? "L / R" : "Single"}</Body>
                          </Pressable>
                        ) : null}
                      </View>
                      {"hint" in definition && definition.hint ? <Body style={styles.hint}>{definition.hint}</Body> : null}
                      {definition.sided && draft.mode === "sides" ? (
                        <View style={styles.sideRow}>
                          <SmallMeasurementInput
                            label="Left"
                            value={draft.left}
                            unit={preferences.circumference}
                            onChange={(left) => updateField(setFields, definition.key, { left })}
                          />
                          <SmallMeasurementInput
                            label="Right"
                            value={draft.right}
                            unit={preferences.circumference}
                            onChange={(right) => updateField(setFields, definition.key, { right })}
                          />
                        </View>
                      ) : (
                        <TextInput
                          style={styles.input}
                          value={draft.value}
                          onChangeText={(value) => updateField(setFields, definition.key, { value })}
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                          placeholder={`e.g. ${preferences.circumference === "in" ? "14.5" : "37"}`}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        <Pressable onPress={() => setShowAll((value) => !value)} style={pressableFeedback(styles.expandButton)}>
          {showAll ? <ChevronUp size={18} color={palette.ink} /> : <ChevronDown size={18} color={palette.ink} />}
          <Body style={styles.expandText}>{showAll ? "Show quick fields" : "Show all measurements"}</Body>
        </Pressable>

        <View>
          <Label>Notes</Label>
          <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline placeholder="Optional context, measurement conditions, or routine" />
        </View>
        {error ? <Body style={styles.error}>{error}</Body> : null}
        <Pressable disabled={saveState === "saving"} onPress={() => void handleSave()} style={pressableFeedback(styles.primaryButton)}>
          {saveState === "saving" ? <ActivityIndicator color={palette.surface} /> : saveState === "saved" ? <Check size={18} color={palette.surface} /> : editing ? <Save size={18} color={palette.surface} /> : <Plus size={18} color={palette.surface} />}
          <Body style={styles.primaryButtonText}>{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : editing ? "Update check-in" : "Save check-in"}</Body>
        </Pressable>
      </Panel>

      <Panel>
        <SectionTitle>Check-in history</SectionTitle>
        {logs.length ? logs.map((log) => (
          <View key={log.id} style={styles.historyRow}>
            <View style={styles.historyCopy}>
              <Body style={styles.historyDate}>{formatShortDate(log.logged_date)}</Body>
              <Body>{summarizeLog(log, preferences.circumference)}</Body>
              {log.notes ? <Body style={styles.hint}>{log.notes}</Body> : null}
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityLabel={`Edit body check-in from ${log.logged_date}`} onPress={() => startEdit(log)} style={pressableFeedback(styles.iconButton)}>
                <Pencil size={17} color={palette.ink} />
              </Pressable>
              <Pressable disabled={deletingId === log.id} accessibilityLabel={`Delete body check-in from ${log.logged_date}`} onPress={() => confirmDelete(log)} style={pressableFeedback(styles.iconButton)}>
                {deletingId === log.id ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={17} color={palette.danger} />}
              </Pressable>
            </View>
          </View>
        )) : <Body>No body measurement entries yet.</Body>}
      </Panel>
    </Screen>
  );
}

function LatestMetricCard({
  title,
  metric,
  logs,
  preferences
}: {
  title: string;
  metric: MetricKey;
  logs: BodyMeasurementLog[];
  preferences: { circumference: "in" | "cm" };
}) {
  const points = metricValues(logs, metric);
  const latest = points.at(-1);
  const previous = points.at(-2);
  const value = latest
    ? formatCircumference(latest.value, preferences.circumference)
    : "--";
  const delta = latest && previous
    ? latest.value - previous.value
    : null;
  const formattedDelta = delta === null
    ? "No prior entry"
    : `${delta >= 0 ? "+" : ""}${(delta / (preferences.circumference === "in" ? 2.54 : 1)).toFixed(1)} ${preferences.circumference}`;

  return (
    <Panel style={styles.summaryCard}>
      <Label>{title}</Label>
      <SectionTitle>{value}</SectionTitle>
      <Body style={styles.hint}>{latest ? `${formattedDelta} · ${formatShortDate(latest.date)}` : "No entries"}</Body>
    </Panel>
  );
}

function SmallMeasurementInput({ label, value, unit, onChange }: { label: string; value: string; unit: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.smallInput}>
      <Body style={styles.hint}>{label} ({unit})</Body>
      <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" inputMode="decimal" placeholder="0" />
    </View>
  );
}

function emptyFields() {
  return bodyMeasurementDefinitions.reduce((output, definition) => {
    output[definition.key] = { mode: "single", value: "", left: "", right: "" };
    return output;
  }, {} as Record<BodyMeasurementKey, FieldDraft>);
}

function updateField(
  setFields: React.Dispatch<React.SetStateAction<Record<BodyMeasurementKey, FieldDraft>>>,
  key: BodyMeasurementKey,
  patch: Partial<FieldDraft>
) {
  setFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
}

function draftToMeasurements(fields: Record<BodyMeasurementKey, FieldDraft>): BodyMeasurementValues {
  const output: BodyMeasurementValues = {};
  for (const definition of bodyMeasurementDefinitions) {
    const draft = fields[definition.key];
    if (definition.sided) {
      if (draft.mode === "single") {
        const value = parsePositive(draft.value);
        if (value !== null) Object.assign(output, { [definition.key]: { mode: "single", value } });
      } else {
        const left = parsePositive(draft.left);
        const right = parsePositive(draft.right);
        if (left !== null || right !== null) {
          Object.assign(output, {
            [definition.key]: {
              mode: "sides",
              ...(left !== null ? { left } : {}),
              ...(right !== null ? { right } : {})
            }
          });
        }
      }
    } else {
      const value = parsePositive(draft.value);
      if (value !== null) Object.assign(output, { [definition.key]: value });
    }
  }
  return output;
}

function fieldsFromLog(log: BodyMeasurementLog, unit: "in" | "cm") {
  const fields = emptyFields();
  const values = bodyMeasurementValuesFromStorage(log.measurements, unit);
  for (const definition of bodyMeasurementDefinitions) {
    const value = values[definition.key];
    if (definition.sided && value && typeof value === "object") {
      const limb = value as BodyLimbMeasurement;
      fields[definition.key] = limb.mode === "single"
        ? { mode: "single", value: String(limb.value), left: "", right: "" }
        : { mode: "sides", value: "", left: limb.left === undefined ? "" : String(limb.left), right: limb.right === undefined ? "" : String(limb.right) };
    } else if (typeof value === "number") {
      fields[definition.key].value = formatCircumferenceInput(value, "cm");
    }
  }
  return fields;
}

function buildMetricSeries(logs: BodyMeasurementLog[], metric: MetricKey, circumferenceUnit: "in" | "cm", range: BodyRange) {
  const definition = bodyMeasurementDefinitions.find((item) => item.key === metric);
  if (!definition) return [];
  if (!definition.sided) {
    const points = metricValues(logs, metric).map((point) => ({
      date: point.date,
      label: formatShortDate(point.date),
      value: point.value / (circumferenceUnit === "in" ? 2.54 : 1)
    }));
    return points.length ? [{ label: definition.label, unit: circumferenceUnit, points: aggregatePoints(points, range) }] : [];
  }

  const variants = [
    { key: "single" as const, label: `${definition.label} · single` },
    { key: "left" as const, label: `${definition.label} · left` },
    { key: "right" as const, label: `${definition.label} · right` }
  ];
  return variants.flatMap((variant) => {
    const points = logs.flatMap((log) => {
      const limb = log.measurements[metric] as BodyLimbMeasurement | undefined;
      const value = limb?.mode === "single"
        ? variant.key === "single" ? limb.value : undefined
        : variant.key === "single" ? undefined : limb?.[variant.key];
      return typeof value === "number"
        ? [{ date: log.logged_date, label: formatShortDate(log.logged_date), value: value / (circumferenceUnit === "in" ? 2.54 : 1) }]
        : [];
    });
    return points.length ? [{ label: variant.label, unit: circumferenceUnit, points: aggregatePoints(points, range) }] : [];
  });
}

function metricValues(logs: BodyMeasurementLog[], metric: MetricKey) {
  return logs.flatMap((log) => {
    const measurement = log.measurements[metric];
    if (typeof measurement === "number") return [{ date: log.logged_date, value: measurement }];
    if (measurement?.mode === "single") return [{ date: log.logged_date, value: measurement.value }];
    if (measurement?.mode === "sides") {
      const values = [measurement.left, measurement.right].filter((value): value is number => typeof value === "number");
      return values.length ? [{ date: log.logged_date, value: values.reduce((sum, value) => sum + value, 0) / values.length }] : [];
    }
    return [];
  });
}

function aggregatePoints(points: Array<{ date: string; label: string; value: number }>, range: BodyRange) {
  if (range !== "year" && range !== "all") return points;
  const buckets = points.reduce<Map<string, number[]>>((groups, point) => {
    const key = point.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), point.value]);
    return groups;
  }, new Map());
  return [...buckets.entries()].map(([month, values]) => ({
    date: month,
    label: new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    value: values.reduce((sum, value) => sum + value, 0) / values.length
  }));
}

function filterLogsByRange(logs: BodyMeasurementLog[], range: BodyRange) {
  if (range === "all") return logs;
  const today = new Date(`${todayIso()}T00:00:00`);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - (range === "week" ? 7 : range === "month" ? 30 : 365) + 1);
  return logs.filter((log) => {
    const date = new Date(`${log.logged_date}T00:00:00`);
    return date >= cutoff && date <= today;
  });
}

function summarizeLog(log: BodyMeasurementLog, circumferenceUnit: "in" | "cm") {
  const values: string[] = [];
  for (const definition of bodyMeasurementDefinitions) {
    const value = log.measurements[definition.key];
    if (typeof value === "number") values.push(`${definition.label} ${formatCircumference(value, circumferenceUnit)}`);
    else if (value?.mode === "single") values.push(`${definition.label} ${formatCircumference(value.value, circumferenceUnit)}`);
    else if (value?.mode === "sides") {
      const sides = [
        value.left !== undefined ? `L ${formatCircumference(value.left, circumferenceUnit)}` : null,
        value.right !== undefined ? `R ${formatCircumference(value.right, circumferenceUnit)}` : null
      ].filter(Boolean).join(" · ");
      values.push(`${definition.label} ${sides}`);
    }
  }
  return values.join(" · ") || "Empty check-in";
}

function parsePositive(value: string) {
  if (!value.trim()) return null;
  const number = Number(value.trim().replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validateDraftFields(fields: Record<BodyMeasurementKey, FieldDraft>) {
  for (const definition of bodyMeasurementDefinitions) {
    const draft = fields[definition.key];
    const entered = definition.sided && draft.mode === "sides"
      ? [draft.left, draft.right]
      : [draft.value];
    if (entered.some((value) => value.trim() && parsePositive(value) === null)) {
      return `${definition.label} values must be numbers greater than zero.`;
    }
  }
  return null;
}

const styles = StyleSheet.create({
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 116
  },
  rowBetween: {
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
  chipText: {
    color: palette.ink,
    fontWeight: "800"
  },
  chipTextActive: {
    color: palette.surface
  },
  rangeChip: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt
  },
  rangeChipActive: {
    backgroundColor: palette.blue
  },
  rangeText: {
    fontWeight: "800"
  },
  rangeTextActive: {
    color: palette.surface
  },
  graphSection: {
    gap: spacing.xs
  },
  measurementGroup: {
    gap: spacing.sm
  },
  inputGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  fieldCard: {
    flexGrow: 1,
    flexBasis: 280,
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    backgroundColor: palette.surfaceAlt
  },
  fieldCardCompact: {
    flexBasis: "100%"
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  fieldLabel: {
    flex: 1
  },
  modeButton: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 7,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center"
  },
  modeButtonActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent
  },
  modeText: {
    fontWeight: "800"
  },
  modeTextActive: {
    color: palette.accent
  },
  sideRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  smallInput: {
    flex: 1,
    minWidth: 0
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
  notes: {
    minHeight: 78,
    textAlignVertical: "top",
    paddingTop: spacing.md
  },
  expandButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    ...fastTouchStyle
  },
  expandText: {
    fontWeight: "900"
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  secondaryButton: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  secondaryButtonActive: {
    backgroundColor: palette.blue,
    borderColor: palette.blue
  },
  secondaryButtonText: {
    fontWeight: "800"
  },
  secondaryButtonTextActive: {
    color: palette.surface
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md
  },
  historyCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs
  },
  historyDate: {
    fontWeight: "900"
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
  },
  hint: {
    color: palette.muted
  },
  error: {
    color: palette.danger,
    fontWeight: "800"
  }
});
