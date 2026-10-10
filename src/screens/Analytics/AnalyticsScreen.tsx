import { ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Scale } from "lucide-react-native";
import { Button } from "@/components/Button";
import { LineGraph } from "@/components/LineGraph";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { SearchableExercisePicker } from "@/components/SearchableExercisePicker";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SessionRow } from "@/components/SessionRow";
import { Body, Label, SectionTitle } from "@/components/Text";
import { addCalendarDays, isCalendarDate } from "@/domain/calendar";
import { useReportContext } from "@/hooks/useReportContext";
import { buildExerciseScoreReport } from "@/services/strength/strengthService";
import { exerciseGrowthReport, pointContextKey } from "@/services/analytics/growthReport";
import { useFitnessStore } from "@/store/useFitnessStore";
import { formatCompactDate, formatWeekdayShort, todayIso } from "@/utils/date";
import { buildPreviousLogs, formatLoggedLoad } from "@/utils/logs";
import { annotateSessionProgress } from "@/utils/sessionDisplay";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";
import { formatBodyWeight, formatWeight } from "@/utils/units";

type StrengthRange = "month" | "quarter" | "half" | "year" | "all";
type Preferences = { exerciseId: number; comparisonKey: string; range: StrengthRange; view: "progress" | "comparison"; averages: boolean };
const defaults: Preferences = { exerciseId: 0, comparisonKey: "", range: "quarter", view: "progress", averages: false };
const rangeOptions: Array<{ key: StrengthRange; label: string; accessibilityLabel: string; days?: number }> = [
  { key: "month", label: "1M", accessibilityLabel: "30 days", days: 30 },
  { key: "quarter", label: "3M", accessibilityLabel: "90 days", days: 90 },
  { key: "half", label: "6M", accessibilityLabel: "180 days", days: 180 },
  { key: "year", label: "1Y", accessibilityLabel: "365 days", days: 365 },
  { key: "all", label: "All", accessibilityLabel: "All time" }
];
function isStrengthRange(value: unknown): value is StrengthRange {
  return rangeOptions.some((option) => option.key === value);
}
function valid(value: unknown): value is Preferences {
  const item = value as Preferences | null;
  return !!item && Number.isSafeInteger(item.exerciseId) && typeof item.comparisonKey === "string" && isStrengthRange(item.range)
    && ["progress", "comparison"].includes(item.view) && typeof item.averages === "boolean";
}
export function AnalyticsScreen({ progressTabs, initialExerciseId, initialRange, initialComparisonKey, onContextChange, onCompare }: {
  progressTabs?: ReactNode; initialExerciseId?: number; initialRange?: string; initialComparisonKey?: string; onContextChange?: (context: { exerciseId: number; range: string; comparisonKey: string }) => void; onCompare?: (context: { exerciseId: number; comparisonKey: string }) => void;
}) {
  const { palette, styles } = useStyles();
  const exercises = useFitnessStore((s) => s.exercises);
  const sessions = useFitnessStore((s) => s.sessions);
  const sets = useFitnessStore((s) => s.sets);
  const points = useFitnessStore((s) => s.exercisePoints);
  const weights = useFitnessStore((s) => s.bodyWeightLogs);
  const account = useFitnessStore((s) => s.currentUser?.id);
  const profiles = useFitnessStore((s) => s.machineProfiles);
  const unit = useFitnessStore((s) => s.unitSystem);
  const bodyUnit = useFitnessStore((s) => s.bodyUnitPreferences.weight);
  const preferences = useReportContext(account, "strength", defaults, valid);
  const selection = preferences.value;
  function update(next: Preferences) { preferences.update(next); onContextChange?.({ exerciseId: next.exerciseId, range: next.range, comparisonKey: next.comparisonKey }); }
  const exclusions = useMemo(() => buildExerciseScoreReport(exercises, sessions, sets, weights).exclusions, [exercises, sessions, sets, weights]);
  const [allLogs, setAllLogs] = useState(false);
  const [chartMetric, setChartMetric] = useState<"estimated1RM" | "points">("estimated1RM");
  useEffect(() => {
    if (initialExerciseId === undefined && initialRange === undefined && initialComparisonKey === undefined) return;
    preferences.update({ ...selection, exerciseId: initialExerciseId ?? selection.exerciseId, comparisonKey: initialComparisonKey ?? selection.comparisonKey,
      range: isStrengthRange(initialRange) ? initialRange : selection.range });
  }, [initialExerciseId, initialRange, initialComparisonKey]);
  const available = exercises;
  // Without a saved choice, open on the exercise trained most recently rather than the alphabetical first.
  const recentExerciseId = useMemo(() => {
    const latestSession = [...sessions].filter((session) => isCalendarDate(session.workout_date)).sort((a, b) => b.workout_date.localeCompare(a.workout_date) || b.id - a.id)
      .find((session) => sets.some((set) => set.session_id === session.id));
    return latestSession ? sets.find((set) => set.session_id === latestSession.id)?.exercise_id : undefined;
  }, [sessions, sets]);
  const selected = available.find((e) => e.id === selection.exerciseId) ?? available.find((e) => e.id === recentExerciseId) ?? available[0];
  const asOf = todayIso();
  // Keys saved before untagged machine entries shared one context named a single entry; open the default instead.
  const requestedContext = selection.comparisonKey.includes(":unknown-machine:") ? "" : selection.comparisonKey;
  const report = exerciseGrowthReport(points, selected?.id ?? 0, requestedContext, asOf);
  const rangeDays = rangeOptions.find((option) => option.key === selection.range)?.days;
  const cutoff = rangeDays === undefined ? "0001-01-01" : addCalendarDays(asOf, -(rangeDays - 1));
  const ranged = report.points.filter((point) => point.date >= cutoff);
  const sessionIds = new Set(report.points.map((point) => point.sessionId));
  const knownSessions = sessions.filter((session) => isCalendarDate(session.workout_date) && session.workout_date <= asOf
    && (!selected || !report.current?.machineProfileId || session.machine_profile_id === report.current.machineProfileId));
  const logs = buildPreviousLogs({ exerciseId: selected?.id, exercises, sessions: knownSessions, sets: sets.filter((set) => knownSessions.some((s) => s.id === set.session_id)),
    points: report.points, unitSystem: unit, machineProfiles: profiles }).filter((log) => log.date >= cutoff
      && (sessionIds.has(log.sessionId) || !report.current || knownSessions.find((s) => s.id === log.sessionId)?.machine_profile_id === report.current.machineProfileId));
  const chart = ranged.map((point) => ({ key: String(point.sessionId), date: point.date, label: formatCompactDate(point.date), value: chartMetric === "estimated1RM" ? point.estimated1RM : point.score,
    details: [`Estimated 1RM ${formatWeight(point.estimated1RM, unit)}`, `Performance ${point.score.toFixed(1)} points`, `Working volume ${formatWeight(point.failureVolume, unit)} × reps`,
      `Set retention ${(point.fatigueResistance * 100).toFixed(0)}%`,
      point.bodyWeightEstimate ? `Bodyweight ${formatBodyWeight(point.bodyWeightEstimate.weightLb, bodyUnit)} observed ${point.bodyWeightEstimate.observationDate}${point.bodyWeightEstimate.isEstimated ? `; carried forward ${point.bodyWeightEstimate.ageCalendarDays} days` : ""}` : "External load; no bodyweight estimate used",
      ...(logs.find((log) => log.sessionId === point.sessionId)?.sets ?? [])] }));
  const sessionProgress = useMemo(() => annotateSessionProgress(report.points), [report.points]);
  const bestE1RMPoint = report.points.reduce<(typeof report.points)[number] | null>((best, point) => !best || point.estimated1RM > best.estimated1RM ? point : best, null);
  const e1RMChangeFromStart = report.start && report.current
    ? (report.current.estimated1RM / report.start.estimated1RM - 1) * 100
    : null;
  function contextLabel(key: string) {
    const point = report.points.find((p) => pointContextKey(p) === key) ?? points.find((p) => p.exerciseId === selected?.id && pointContextKey(p) === key);
    const sessions = report.points.length && pointContextKey(report.points[0]) === key ? report.points.length : points.filter((p) => p.exerciseId === selected?.id && pointContextKey(p) === key).length;
    const name = key.endsWith(":machine:untagged") ? "No machine tag" : point?.machineProfileId ? profiles.find((p) => p.id === point.machineProfileId)?.label ?? `Equipment ${point.machineProfileId}` : "Free weights / bodyweight";
    return `${name} · ${sessions} ${sessions === 1 ? "session" : "sessions"}`;
  }
  return <Screen>
    {progressTabs}
    {preferences.error ? <Body>{preferences.error}</Body> : null}
    <Panel><SearchableExercisePicker exercises={available} selectedId={selected?.id} onSelect={(exerciseId) => update({ ...selection, exerciseId, comparisonKey: "" })} />
      {!available.length ? <Body>Record working sets to begin a growth history.</Body> : null}
      {report.contexts.length > 1 ? <View style={styles.group}><Label>Equipment context</Label>{report.contexts.map((key) => {
        const active = report.comparisonKey === key;
        return <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => update({ ...selection, comparisonKey: key })}
          style={pressableFeedback([styles.contextOption, active && styles.contextOptionActive])}>
          <Body numberOfLines={2} style={[styles.contextText, active && styles.contextTextActive]}>{contextLabel(key)}</Body>
          {active ? <Check size={16} color={palette.ink} /> : null}
        </Pressable>;
      })}</View> : null}
      {report.excludedContextCount ? <Body style={styles.hint}>Loads differ between machines, so each one has its own trend. {report.excludedContextCount} {report.excludedContextCount === 1 ? "session is" : "sessions are"} on other equipment.</Body> : null}
    </Panel>
    <Panel>
      <SectionTitle>Trend</SectionTitle>
      <SegmentedControl accessibilityLabel="Chart metric" value={chartMetric} onChange={setChartMetric}
        options={[{ key: "estimated1RM", label: "Estimated 1RM" }, { key: "points", label: "Performance points" }]} />
      <LineGraph points={chart} suffix={chartMetric === "estimated1RM" ? ` ${unit}` : " pts"} height={210}
        emptyMessage={report.points.length ? "No sessions in this range. Pick a longer range." : "Log this exercise twice to draw a trend."} />
      <SegmentedControl variant="pills" accessibilityLabel="Chart range" value={selection.range} onChange={(range) => update({ ...selection, range })} options={rangeOptions} />
      {report.current ? <View style={styles.statGrid}>
        <Stat label="Best e1RM" value={formatWeight((bestE1RMPoint ?? report.current).estimated1RM, unit)} detail={formatCompactDate((bestE1RMPoint ?? report.current).date)} />
        <Stat label="Latest" value={formatWeight(report.current.estimated1RM, unit)} detail={formatCompactDate(report.current.date)} />
        <Stat label="Vs start" value={signed(e1RMChangeFromStart)} detail={report.start ? `since ${formatCompactDate(report.start.date)}` : "No baseline"} tone={e1RMChangeFromStart === null ? undefined : e1RMChangeFromStart >= 0 ? "up" : "down"} />
      </View> : <Body>{selection.comparisonKey && !report.contexts.includes(selection.comparisonKey) ? "No eligible history in this equipment context. Choose another context or range." : "No eligible observations yet. All recordings remain in History."}</Body>}
      {report.stale ? <Body style={styles.notice}>Last trained {report.ageCalendarDays} days ago · historical value.</Body> : null}
      {onCompare && selected ? <Button label="Compare with bodyweight" icon={Scale} fullWidth onPress={() => onCompare({ exerciseId: selected.id, comparisonKey: report.comparisonKey ?? "" })} /> : null}
      {report.current ? <DetailsDisclosure title="How performance points work">
        <Body>{report.current.score.toFixed(1)} points · {signed(report.changeFromStartPercent)} from start · {signed(report.changeFromPreviousPercent)} vs previous.</Body>
        <Body>First eligible entry = 100. This version weights estimated strength at 45%, working volume at 35%, and set retention at 20%. The baseline uses eligible history, independent of chart range; historical corrections can change it. Points describe recorded performance in this equipment context, not muscle growth.</Body>
        <Body>Bodyweight lifts need an observation on or before training, no older than 14 days. Two valid working sets establish a score. Version {report.current.metricVersion ?? "unavailable"}.</Body>
      </DetailsDisclosure> : null}
    </Panel>
    {exclusions.some((issue) => issue.exerciseId === selected?.id && (issue.date === null || issue.date <= asOf)) ? <Panel><DetailsDisclosure title="Recorded entries excluded from points">
      {exclusions.filter((issue) => issue.exerciseId === selected?.id && (issue.date === null || issue.date <= asOf)).map((issue) => <Body key={issue.sessionId}>{issue.date ?? "Date unverified"}: {issue.reason}</Body>)}
      <Body>These entries remain in History.</Body>
    </DetailsDisclosure></Panel> : null}
    <Panel>
      <View style={styles.entriesHeader}><SectionTitle>Sessions</SectionTitle><Body style={styles.countText}>{logs.length} in range</Body></View>
      {(allLogs ? logs : logs.slice(0, 6)).map((log, index) => <View key={log.sessionId} style={index ? styles.divided : undefined}>
        <SessionRow title={formatWeekdayShort(log.date)} caption={log.machineProfileLabel} sets={log.rawSets}
          formatLoad={(weight) => formatLoggedLoad(weight, log.loadType, unit)} estimated1RM={log.point?.estimated1RM}
          progress={sessionProgress.get(log.sessionId)} formatMetric={(value) => formatWeight(value, unit)} />
      </View>)}
      {logs.length > 6 ? <Button variant="ghost" label={allLogs ? "Show fewer sessions" : `Show all ${logs.length} sessions`} icon={allLogs ? ChevronUp : ChevronDown} onPress={() => setAllLogs(!allLogs)} style={styles.centered} /> : null}
      {!logs.length ? <Body>No entries in this range/context. Change the range to inspect older records.</Body> : null}
    </Panel>
  </Screen>;
}
function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "up" | "down" }) {
  const { styles } = useStyles();
  return <View style={styles.stat}>
    <Label numberOfLines={1}>{label}</Label>
    <Body numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, tone === "up" && styles.positive, tone === "down" && styles.negative]}>{value}</Body>
    <Body numberOfLines={1} style={styles.statDetail}>{detail}</Body>
  </View>;
}
function signed(value: number | null) { return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
const useStyles = createThemedStyles((palette) => StyleSheet.create({
  statGrid: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, minWidth: 0, gap: 2, padding: spacing.md, borderRadius: 12, backgroundColor: palette.surfaceAlt },
  statValue: { color: palette.ink, fontSize: 17, lineHeight: 22, fontWeight: "800", fontVariant: ["tabular-nums"] },
  statDetail: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  notice: { color: palette.warning, fontWeight: "700" }, hint: { color: palette.muted, fontSize: 13, lineHeight: 18 }, positive: { color: palette.success }, negative: { color: palette.danger },
  contextOption: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: "transparent" },
  contextOptionActive: { borderColor: palette.ink },
  contextText: { flex: 1, color: palette.muted, fontWeight: "600" },
  contextTextActive: { color: palette.ink },
  entriesHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  countText: { color: palette.muted, fontSize: 13 },
  divided: { borderTopWidth: 1, borderColor: palette.border },
  centered: { alignSelf: "center" },
  group: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderColor: palette.border }
}));
