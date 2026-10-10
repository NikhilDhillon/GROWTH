import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { MachineProfilePanel } from "@/components/MachineProfilePanel";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SessionRow } from "@/components/SessionRow";
import { Body, Label, SectionTitle } from "@/components/Text";
import { ExerciseLoadType, getExerciseLoadType, isMachineLoadType } from "@/constants/exercises";
import { addCalendarDays, isCalendarDate } from "@/domain/calendar";
import { useFitnessStore } from "@/store/useFitnessStore";
import { projectWorkoutHistory } from "@/domain/workoutHistory";
import { Exercise, LoggedSetDraft, MuscleGroup } from "@/types";
import { formatCompactDate, formatWeekdayDate, formatWeekdayShort, todayIso } from "@/utils/date";
import { deleteWithConfirmation } from "@/utils/deletion";
import { buildPreviousLogs, formatLoggedLoad, PreviousLog } from "@/utils/logs";
import { annotateSessionProgress } from "@/utils/sessionDisplay";
import { createThemedStyles } from "@/utils/themedStyles";
import { muscles, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { formatWeight, formatWeightInput } from "@/utils/units";

type EditingWorkout = {
  sessionId: number;
  exerciseId: number;
  workoutDate: string;
  notes: string;
  unitSystem: "lb" | "kg";
  machineProfileId?: string | null;
  sets: LoggedSetDraft[];
};

type HistoryView = "workouts" | "exercises";
type RecordedWorkout = ReturnType<typeof projectWorkoutHistory>["workouts"][number];

const emptySet = (): LoggedSetDraft => ({ reps: "", weight: "" });
const dayPageSize = 10;
const calendarWeeks = 12;
type SaveState = "idle" | "saving" | "saved";

export function LogsScreen() {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();
  const exercises = useFitnessStore((state) => state.exercises);
  const sessions = useFitnessStore((state) => state.sessions);
  const sets = useFitnessStore((state) => state.sets);
  const machineProfiles = useFitnessStore((state) => state.machineProfiles);
  const points = useFitnessStore((state) => state.exercisePoints);
  const completedGuidedWorkouts = useFitnessStore((state) => state.completedGuidedWorkouts);
  const workoutArchiveEvidence = useFitnessStore((state) => state.workoutArchiveEvidence);
  const workoutRecords = useFitnessStore((state) => state.workoutRecords);
  const workoutReferences = useFitnessStore((state) => state.workoutReferences);
  const history = useMemo(() => projectWorkoutHistory({ sessions, sets, exercises, completedGuidedWorkouts, workoutArchiveEvidence, workoutRecords, workoutReferences }),
    [sessions, sets, exercises, completedGuidedWorkouts, workoutArchiveEvidence, workoutRecords, workoutReferences]);
  const completedWorkouts = history.workouts.filter((workout) => workout.kind === "guided" && workout.status === "completed");
  const unitSystem = useFitnessStore((state) => state.unitSystem);
  const deleteWorkoutLog = useFitnessStore((state) => state.deleteWorkoutLog);
  const updateWorkoutLog = useFitnessStore((state) => state.updateWorkoutLog);
  const updateWorkoutMachineProfile = useFitnessStore((state) => state.updateWorkoutMachineProfile);
  const saveMachineProfile = useFitnessStore((state) => state.saveMachineProfile);
  const deleteMachineProfile = useFitnessStore((state) => state.deleteMachineProfile);
  const logs = buildPreviousLogs({ exercises, sessions, sets, points, unitSystem, machineProfiles });
  const progress = useMemo(() => annotateSessionProgress(points ?? []), [points]);
  const days = useMemo(() => groupLogsByDay(logs, completedWorkouts, progress), [logs, completedWorkouts, progress]);
  const exerciseGroups = useMemo(() => groupLogsByExercise(logs, exercises), [exercises, logs]);
  const [view, setView] = useState<HistoryView>("workouts");
  const [visibleDays, setVisibleDays] = useState(dayPageSize);
  const [query, setQuery] = useState("");
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | "All">("All");
  const [expandedExercises, setExpandedExercises] = useState<Record<number, boolean>>({});
  const [editingWorkout, setEditingWorkout] = useState<EditingWorkout | null>(null);
  const [updateSaveState, setUpdateSaveState] = useState<SaveState>("idle");
  const [machineSaveState, setMachineSaveState] = useState<SaveState>("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingWorkoutId, setDeletingWorkoutId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletionPending = useRef(false);
  const currentEdit = useRef(editingWorkout);
  currentEdit.current = editingWorkout;

  const trainingDates = new Set(days.filter((day) => day.date && day.logs.length).map((day) => day.date as string));
  const totalWorkingSets = logs.reduce((total, log) => total + log.rawSets.filter((set) => !set.isWarmup).length, 0);
  const presentMuscles = muscles.filter((muscle) => exerciseGroups.some((group) => group.muscle === muscle));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredExercises = exerciseGroups.filter((group) => (muscleFilter === "All" || group.muscle === muscleFilter)
    && (!normalizedQuery || `${group.exerciseName} ${group.muscle}`.toLowerCase().includes(normalizedQuery)));
  const formatMetric = (value: number) => formatWeight(value, unitSystem);

  function startEditWorkout(log: PreviousLog) {
    const session = sessions.find((item) => item.id === log.sessionId);
    const sessionSets = sets
      .filter((set) => set.session_id === log.sessionId)
      .sort((a, b) => a.set_number - b.set_number)
      .map((set) => ({ reps: String(set.reps), weight: formatWeightInput(set.weight, unitSystem), isWarmup: Boolean(set.is_warmup) }));
    setUpdateSaveState("idle");
    setMachineSaveState("idle");
    setUpdateError(null);
    setEditingWorkout({
      sessionId: log.sessionId,
      exerciseId: log.exerciseId,
      workoutDate: session?.workout_date ?? log.date,
      notes: session?.notes ?? "",
      unitSystem,
      machineProfileId: session?.machine_profile_id ?? null,
      sets: sessionSets.length ? sessionSets : [emptySet()]
    });
  }

  function clearEditWorkout() {
    setEditingWorkout(null);
  }

  async function handleUpdateWorkout() {
    if (!editingWorkout || updateSaveState === "saving" || deletionPending.current) return;
    setUpdateSaveState("saving");
    setUpdateError(null);
    try {
      await updateWorkoutLog(editingWorkout);
      setUpdateSaveState("saved");
      setTimeout(() => {
        clearEditWorkout();
        setUpdateSaveState("idle");
      }, 900);
    } catch (error) {
      setUpdateSaveState("idle");
      setUpdateError(error instanceof Error ? error.message : "Could not update scored workout.");
    }
  }

  async function handleUpdateMachineTag() {
    if (!editingWorkout || machineSaveState === "saving" || deletionPending.current) return;
    setMachineSaveState("saving");
    setUpdateError(null);
    try {
      await updateWorkoutMachineProfile({
        sessionId: editingWorkout.sessionId,
        exerciseId: editingWorkout.exerciseId,
        machineProfileId: editingWorkout.machineProfileId ?? null
      });
      setMachineSaveState("saved");
      setTimeout(() => {
        clearEditWorkout();
        setMachineSaveState("idle");
      }, 900);
    } catch (error) {
      setMachineSaveState("idle");
      setUpdateError(error instanceof Error ? error.message : "Could not update machine tag.");
    }
  }

  async function handleDeleteWorkout(sessionId: number) {
    if (deletionPending.current || updateSaveState === "saving" || machineSaveState === "saving") return;
    deletionPending.current = true;
    setDeletingWorkoutId(sessionId);
    setDeleteError(null);
    try {
      const result = await deleteWithConfirmation({
        title: "Delete workout log?",
        message: "This removes this exercise entry and its sets from workout history. Progress calculations may change.",
        deleteRecord: () => deleteWorkoutLog(sessionId),
        fallbackError: "Could not delete this workout log. Please retry."
      });
      if (result.status === "deleted" && currentEdit.current?.sessionId === sessionId) clearEditWorkout();
      if (result.status === "failed") setDeleteError(result.error);
    } finally {
      deletionPending.current = false;
      setDeletingWorkoutId(null);
    }
  }

  function renderLog(log: PreviousLog, title: string) {
    if (editingWorkout?.sessionId === log.sessionId) return <View key={log.sessionId} style={styles.logItem}>{renderEditForm(log)}</View>;
    const loadType = log.loadType;
    return (
      <View key={log.sessionId} style={styles.logItem}>
        <SessionRow
          title={title}
          caption={isMachineLoadType(loadType) ? log.machineProfileLabel ?? "No machine tag" : null}
          sets={log.rawSets}
          formatLoad={(weight) => formatLoggedLoad(weight, loadType, unitSystem)}
          estimated1RM={log.point?.estimated1RM}
          progress={progress.get(log.sessionId)}
          formatMetric={formatMetric}
          metricPlacement="inline"
        >
          <Pressable accessibilityLabel={`Edit workout log from ${log.date}`} hitSlop={touchHitSlop} onPress={() => startEditWorkout(log)} style={pressableFeedback(styles.rowAction)}>
            <Pencil size={16} color={palette.muted} />
          </Pressable>
          <Pressable disabled={deletingWorkoutId !== null || updateSaveState === "saving" || machineSaveState === "saving"} accessibilityLabel={`Delete workout log from ${log.date}`} hitSlop={touchHitSlop} onPress={() => void handleDeleteWorkout(log.sessionId)} style={pressableFeedback(styles.rowAction)}>
            {deletingWorkoutId === log.sessionId ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={16} color={palette.danger} />}
          </Pressable>
        </SessionRow>
      </View>
    );
  }

  function renderEditForm(log: PreviousLog) {
    if (!editingWorkout) return null;
    const loadType = getExerciseLoadType(log.exerciseName);
    return (
      <View style={styles.editForm}>
        <View style={styles.summaryRow}>
          <View style={styles.flex}>
            <Label>Edit log</Label>
            <SectionTitle numberOfLines={1}>{log.exerciseName}</SectionTitle>
          </View>
          <Pressable accessibilityLabel="Cancel workout edit" hitSlop={touchHitSlop} onPress={clearEditWorkout} style={pressableFeedback(styles.iconButton)}>
            <X size={17} color={palette.ink} />
          </Pressable>
        </View>
        <DatePickerField value={editingWorkout.workoutDate} onChange={(workoutDate) => setEditingWorkout((current) => current ? { ...current, workoutDate } : current)} />
        {loadType !== "external" ? <Body style={styles.hintText}>{loadType === "machine_stack" ? "Enter the stack/load number shown on the machine." : loadType === "bodyweight_plus_load" ? "Enter added weight only; body weight is included in scoring." : "Enter assistance weight; it is subtracted from body weight for scoring."}</Body> : null}
        {isMachineLoadType(loadType) ? (
          <View style={styles.machineEdit}>
            <MachineProfilePanel
              profiles={machineProfiles}
              selectedProfileId={editingWorkout.machineProfileId}
              exerciseId={editingWorkout.exerciseId}
              exerciseName={log.exerciseName}
              unitSystem={editingWorkout.unitSystem}
              onSelectProfile={(machineProfileId) => setEditingWorkout((current) => current ? { ...current, machineProfileId } : current)}
              onSaveProfile={saveMachineProfile}
              onDeleteProfile={deleteMachineProfile}
            />
            {editingWorkout.machineProfileId ? (
              <Pressable
                hitSlop={touchHitSlop}
                onPress={() => setEditingWorkout((current) => current ? { ...current, machineProfileId: null } : current)}
                style={pressableFeedback(styles.secondaryButton)}
              >
                <X size={17} color={palette.ink} />
                <Body style={styles.secondaryButtonText}>Clear machine tag</Body>
              </Pressable>
            ) : (
              <Body style={styles.hintText}>Select a machine tag to attach this old log to that machine's future history.</Body>
            )}
            <Pressable
              disabled={machineSaveState === "saving" || deletingWorkoutId !== null}
              hitSlop={touchHitSlop}
              onPress={() => void handleUpdateMachineTag()}
              style={pressableFeedback(styles.primaryButton)}
            >
              {machineSaveState === "saving" ? <ActivityIndicator color={palette.surface} /> : machineSaveState === "saved" ? <Check size={18} color={palette.surface} /> : <Save size={18} color={palette.surface} />}
              <Body style={styles.primaryButtonText}>{machineSaveState === "saving" ? "Saving" : machineSaveState === "saved" ? "Saved" : "Save machine tag"}</Body>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.setHeader}>
          <Label style={styles.setNumber}>#</Label>
          <Label style={styles.setHeaderCell}>Load</Label>
          <Label style={styles.setHeaderCell}>Reps</Label>
          <Label style={styles.setHeaderKind}>Type</Label>
          <View style={styles.setHeaderAction} />
        </View>
        {editingWorkout.sets.map((set, index) => (
          <View key={index} style={styles.setRow}>
            <Label style={styles.setNumber}>{index + 1}</Label>
            <TextInput
              style={[styles.input, styles.setInput]}
              value={set.weight}
              onChangeText={(weight) => updateEditingSet(index, "weight", weight)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={loadPlaceholder(loadType, editingWorkout.unitSystem)}
            />
            <TextInput
              style={[styles.input, styles.setInput]}
              value={set.reps}
              onChangeText={(reps) => updateEditingSet(index, "reps", reps)}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="reps"
            />
            <Pressable accessibilityRole="button" accessibilityLabel={`Set ${index + 1} is ${set.isWarmup ? "a warm-up" : "a working set"}`} onPress={() => setEditingWorkout((current) => current ? { ...current, sets: current.sets.map((item, itemIndex) => itemIndex === index ? { ...item, isWarmup: !item.isWarmup } : item) } : current)} style={pressableFeedback([styles.kindButton, set.isWarmup && styles.kindButtonActive])}>
              <Body style={[styles.kindText, set.isWarmup && styles.kindTextActive]}>{set.isWarmup ? "Warm-up" : "Working"}</Body>
            </Pressable>
            <Pressable
              accessibilityLabel="Remove set"
              hitSlop={touchHitSlop}
              onPress={() => setEditingWorkout((current) => current ? { ...current, sets: current.sets.filter((_, itemIndex) => itemIndex !== index) } : current)}
              style={pressableFeedback(styles.rowAction)}
            >
              <Trash2 size={16} color={palette.danger} />
            </Pressable>
          </View>
        ))}
        <Pressable hitSlop={touchHitSlop} onPress={() => setEditingWorkout((current) => current ? { ...current, sets: [...current.sets, emptySet()] } : current)} style={pressableFeedback(styles.secondaryButton)}>
          <Plus size={17} color={palette.ink} />
          <Body style={styles.secondaryButtonText}>Add set</Body>
        </Pressable>
        <TextInput
          style={[styles.input, styles.notes]}
          value={editingWorkout.notes}
          onChangeText={(notes) => setEditingWorkout((current) => current ? { ...current, notes } : current)}
          multiline
          placeholder="Notes"
        />
        {updateError ? <Body style={styles.errorText}>{updateError}</Body> : null}
        <Pressable disabled={updateSaveState === "saving" || deletingWorkoutId !== null} hitSlop={touchHitSlop} onPress={() => void handleUpdateWorkout()} style={pressableFeedback(styles.primaryButton)}>
          {updateSaveState === "saving" ? <ActivityIndicator color={palette.surface} /> : updateSaveState === "saved" ? <Check size={18} color={palette.surface} /> : <Save size={18} color={palette.surface} />}
          <Body style={styles.primaryButtonText}>{updateSaveState === "saving" ? "Saving" : updateSaveState === "saved" ? "Updated" : "Save changes"}</Body>
        </Pressable>
      </View>
    );
  }

  function renderGuidedLink(recorded: RecordedWorkout) {
    return (
      <Pressable
        key={recorded.id}
        accessibilityLabel={`View workout summary from ${recorded.workoutDate ?? "an unresolved date"}`}
        onPress={() => navigation.navigate("WorkoutSummary", { workoutId: recorded.id })}
        style={pressableFeedback(styles.guidedLink)}
      >
        <View style={styles.flex}>
          <Body style={styles.guidedTitle}>Guided workout · {recorded.startedAt && recorded.finishedAt ? formatCompletedDuration(recorded.startedAt, recorded.finishedAt) : "duration unavailable"}</Body>
          <Body style={styles.guidedMeta}>{recorded.entryIds.length} recorded exercises{history.issues.some((issue) => issue.workoutId === recorded.id) ? " · recording links need review" : ""}</Body>
        </View>
        <Body style={styles.guidedAction}>Summary</Body>
        <ChevronRight size={16} color={palette.ink} />
      </Pressable>
    );
  }

  let lastMonth = "";
  return (
    <Screen>
      <View style={styles.pageHeader}>
        <Body>{logs.length ? `${trainingDates.size} training days · ${totalWorkingSets} working sets` : "Your recorded workouts appear here."}</Body>
      </View>

      {logs.length ? <TrainingCalendar trainedDates={trainingDates} /> : null}

      <SegmentedControl accessibilityLabel="History view" value={view} onChange={setView}
        options={[{ key: "workouts", label: "Workouts" }, { key: "exercises", label: "Exercises" }]} />

      {history.issues.some((issue) => issue.code === "invalid_archive_metadata") ? <Body accessibilityRole="alert">Some archived details need review. Their originals have been preserved.</Body> : null}
      {deleteError ? <Body accessibilityRole="alert" style={styles.errorText}>{deleteError}</Body> : null}

      {!logs.length && !completedWorkouts.length ? (
        <Panel><SectionTitle>No workouts yet</SectionTitle><Body>Record a quick or guided workout and it will show up here, grouped by day.</Body></Panel>
      ) : view === "workouts" ? (
        <>
          {days.slice(0, visibleDays).map((day) => {
            const month = day.date ? day.date.slice(0, 7) : "unresolved";
            const monthHeader = month !== lastMonth ? <View key={`month-${month}`} style={styles.monthHeader}>
              <Label>{day.date ? monthLabel(day.date) : "Date unresolved"}</Label>
              <Body style={styles.monthCount}>{days.filter((item) => (item.date ? item.date.slice(0, 7) : "unresolved") === month).length} workouts</Body>
            </View> : null;
            lastMonth = month;
            const workingSets = day.logs.reduce((total, log) => total + log.rawSets.filter((set) => !set.isWarmup).length, 0);
            return [
              monthHeader,
              <Panel key={day.key} style={styles.dayCard}>
                <View style={styles.dayHeader}>
                  <View style={styles.flex}>
                    <SectionTitle numberOfLines={1}>{day.date ? formatWeekdayDate(day.date) : "Date unresolved"}</SectionTitle>
                    <Body style={styles.dayMeta}>{day.logs.length ? `${day.logs.length} ${day.logs.length === 1 ? "exercise" : "exercises"} · ${workingSets} working sets` : "No exercise entries"}{day.date ? ` · ${relativeDay(day.date)}` : ""}</Body>
                  </View>
                  {day.prCount ? <View style={styles.prPill}><Body style={styles.prPillText}>{day.prCount} PR{day.prCount === 1 ? "" : "s"}</Body></View> : null}
                </View>
                {day.guided.map(renderGuidedLink)}
                <View>{day.logs.map((log) => renderLog(log, log.exerciseName))}</View>
              </Panel>
            ];
          })}
          {days.length > visibleDays ? (
            <Pressable accessibilityRole="button" onPress={() => setVisibleDays((count) => count + dayPageSize)} style={pressableFeedback(styles.secondaryButton)}>
              <ChevronDown size={17} color={palette.ink} />
              <Body style={styles.secondaryButtonText}>Show older workouts ({days.length - visibleDays} more)</Body>
            </Pressable>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.searchField}>
            <Search size={17} color={palette.muted} />
            <TextInput accessibilityLabel="Search exercise history" value={query} onChangeText={setQuery} placeholder="Search exercises" placeholderTextColor={palette.muted}
              autoCapitalize="none" autoCorrect={false} style={styles.searchInput} />
            {query ? <Pressable accessibilityLabel="Clear search" hitSlop={touchHitSlop} onPress={() => setQuery("")} style={pressableFeedback(styles.rowAction)}><X size={16} color={palette.muted} /></Pressable> : null}
          </View>
          <View style={styles.chipRow}>
            {(["All", ...presentMuscles] as Array<MuscleGroup | "All">).map((muscle) => {
              const selected = muscleFilter === muscle;
              return <Pressable key={muscle} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setMuscleFilter(muscle)} style={pressableFeedback([styles.chip, selected && styles.chipActive])}>
                <Body style={[styles.chipText, selected && styles.chipTextActive]}>{muscle}</Body>
              </Pressable>;
            })}
          </View>
          {filteredExercises.length ? <Panel style={styles.exerciseList}>
            {filteredExercises.map((group, index) => {
              const expanded = expandedExercises[group.exerciseId] ?? false;
              const Icon = expanded ? ChevronDown : ChevronRight;
              return (
                <View key={group.exerciseId} style={index ? styles.divided : undefined}>
                  <Pressable
                    accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${group.exerciseName} logs`}
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedExercises((current) => ({ ...current, [group.exerciseId]: !expanded }))}
                    style={pressableFeedback(styles.exerciseHeader)}
                  >
                    <View style={styles.flex}>
                      <Body numberOfLines={1} style={styles.exerciseName}>{group.exerciseName}</Body>
                      <Body numberOfLines={1} style={styles.dayMeta}>{group.muscle} · {group.logs.length} {group.logs.length === 1 ? "session" : "sessions"} · last {formatCompactDate(group.logs[0].date)}</Body>
                    </View>
                    {group.bestE1RM ? <View style={styles.bestColumn}><Body style={styles.bestValue}>{formatMetric(group.bestE1RM)}</Body><Label style={styles.bestLabel}>Best e1RM</Label></View> : null}
                    <Icon size={18} color={palette.muted} />
                  </Pressable>
                  {expanded ? <View style={styles.exerciseLogs}>{group.logs.map((log) => renderLog(log, formatWeekdayShort(log.date)))}</View> : null}
                </View>
              );
            })}
          </Panel> : <Body>No exercises match this filter.</Body>}
        </>
      )}
    </Screen>
  );

  function updateEditingSet(index: number, field: "weight" | "reps", value: string) {
    setEditingWorkout((current) =>
      current
        ? {
            ...current,
            sets: current.sets.map((set, itemIndex) => (itemIndex === index ? { ...set, [field]: value } : set))
          }
        : current
    );
  }
}

/** Last 12 weeks, one square per day, so gaps in training are visible at a glance. */
function TrainingCalendar({ trainedDates }: { trainedDates: Set<string> }) {
  const { styles } = useStyles();
  const today = todayIso();
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = addCalendarDays(today, -(calendarWeeks * 7 - 1) - (6 - weekday));
  const weeks = Array.from({ length: calendarWeeks }, (_, week) => Array.from({ length: 7 }, (_, day) => addCalendarDays(start, week * 7 + day)));
  const recentCount = weeks.flat().filter((date) => trainedDates.has(date)).length;
  const lastSevenCount = Array.from({ length: 7 }, (_, offset) => addCalendarDays(today, -offset)).filter((date) => trainedDates.has(date)).length;
  return (
    <Panel style={styles.calendarPanel}>
      <View style={styles.calendarHeader}>
        <View style={styles.flex}>
          <Label>Last {calendarWeeks} weeks</Label>
          <Body style={styles.calendarStat}>{recentCount} training days</Body>
        </View>
        <View style={styles.calendarSide}>
          <Body style={styles.calendarStat}>{lastSevenCount}</Body>
          <Label>This week</Label>
        </View>
      </View>
      <View style={styles.calendarGrid} accessibilityLabel={`${recentCount} training days in the last ${calendarWeeks} weeks`}>
        {weeks.map((week, index) => (
          <View key={index} style={styles.calendarWeek}>
            {week.map((date) => (
              <View key={date} style={[styles.calendarDay, trainedDates.has(date) && styles.calendarDayTrained, date === today && styles.calendarDayToday, date > today && styles.calendarDayFuture]} />
            ))}
          </View>
        ))}
      </View>
    </Panel>
  );
}

type HistoryDay = { key: string; date: string | null; logs: PreviousLog[]; guided: RecordedWorkout[]; prCount: number };

function groupLogsByDay(logs: PreviousLog[], guided: RecordedWorkout[], progress: Map<number, { isPR: boolean }>): HistoryDay[] {
  const byDate = new Map<string, HistoryDay>();
  for (const log of logs) {
    const key = isCalendarDate(log.date) ? log.date : "unresolved";
    const day = byDate.get(key) ?? { key, date: key === "unresolved" ? null : key, logs: [], guided: [], prCount: 0 };
    day.logs.push(log);
    byDate.set(key, day);
  }
  for (const workout of guided) {
    const key = workout.workoutDate && isCalendarDate(workout.workoutDate) ? workout.workoutDate : "unresolved";
    const day = byDate.get(key) ?? { key, date: key === "unresolved" ? null : key, logs: [], guided: [], prCount: 0 };
    day.guided.push(workout);
    byDate.set(key, day);
  }
  return [...byDate.values()]
    .map((day) => ({ ...day, logs: [...day.logs].sort((a, b) => a.sessionId - b.sessionId), prCount: day.logs.filter((log) => progress.get(log.sessionId)?.isPR).length }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function groupLogsByExercise(logs: PreviousLog[], exercises: Exercise[]) {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const groups = new Map<number, { exerciseId: number; exerciseName: string; muscle: MuscleGroup; logs: PreviousLog[]; bestE1RM: number | null }>();
  for (const log of logs) {
    const group = groups.get(log.exerciseId) ?? { exerciseId: log.exerciseId, exerciseName: log.exerciseName, muscle: exerciseById.get(log.exerciseId)?.primary_muscle ?? "Chest", logs: [], bestE1RM: null };
    group.logs.push(log);
    if (log.point && log.point.comparability !== "self_context") group.bestE1RM = Math.max(group.bestE1RM ?? 0, log.point.estimated1RM);
    groups.set(log.exerciseId, group);
  }
  return [...groups.values()].sort((a, b) => b.logs[0].date.localeCompare(a.logs[0].date) || a.exerciseName.localeCompare(b.exerciseName));
}

function monthLabel(date: string) {
  return new Date(`${date.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function relativeDay(date: string) {
  const today = todayIso();
  if (date === today) return "today";
  if (date === addCalendarDays(today, -1)) return "yesterday";
  const days = Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${date}T12:00:00Z`).getTime()) / 86400000);
  if (days < 0) return "upcoming";
  if (days < 7) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  return `${Math.round(days / 30)} mo ago`;
}

function loadPlaceholder(loadType: ExerciseLoadType, unitSystem: string) {
  if (loadType === "machine_stack") return "stack";
  if (loadType === "bodyweight_plus_load") return `added ${unitSystem}`;
  if (loadType === "bodyweight_minus_assistance") return `assist ${unitSystem}`;
  return unitSystem;
}

function formatCompletedDuration(startedAt: string, finishedAt: string) {
  const minutes = Math.max(1, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  pageHeader: {
    gap: 2
  },
  flex: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    marginBottom: -spacing.sm
  },
  monthCount: {
    fontSize: 12
  },
  dayCard: {
    gap: spacing.xs,
    paddingVertical: spacing.md
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.xs
  },
  dayMeta: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18
  },
  prPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: palette.success
  },
  prPillText: {
    color: palette.surface,
    fontSize: 12,
    fontWeight: "800"
  },
  guidedLink: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  guidedTitle: {
    color: palette.ink,
    fontWeight: "700",
    fontSize: 14
  },
  guidedMeta: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16
  },
  guidedAction: {
    color: palette.ink,
    fontWeight: "700",
    fontSize: 13
  },
  logItem: {
    borderTopWidth: 1,
    borderTopColor: palette.border
  },
  rowAction: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...fastTouchStyle
  },
  calendarPanel: {
    gap: spacing.sm
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md
  },
  calendarSide: {
    alignItems: "flex-end"
  },
  calendarStat: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  calendarGrid: {
    flexDirection: "row",
    gap: 4
  },
  calendarWeek: {
    flex: 1,
    gap: 4
  },
  calendarDay: {
    aspectRatio: 1,
    borderRadius: 4,
    backgroundColor: palette.surfaceAlt
  },
  calendarDayTrained: {
    backgroundColor: palette.success
  },
  calendarDayToday: {
    borderWidth: 1.5,
    borderColor: palette.ink
  },
  calendarDayFuture: {
    opacity: 0.35
  },
  searchField: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    color: palette.ink,
    fontSize: 16
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  chipActive: {
    backgroundColor: palette.ink
  },
  chipText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700"
  },
  chipTextActive: {
    color: palette.surface
  },
  exerciseList: {
    gap: 0,
    paddingVertical: spacing.xs
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: palette.border
  },
  exerciseHeader: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    ...fastTouchStyle
  },
  exerciseName: {
    color: palette.ink,
    fontWeight: "700",
    fontSize: 15
  },
  bestColumn: {
    alignItems: "flex-end"
  },
  bestValue: {
    color: palette.ink,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  bestLabel: {
    fontSize: 9
  },
  exerciseLogs: {
    paddingBottom: spacing.sm
  },
  editForm: {
    gap: spacing.md,
    paddingVertical: spacing.md
  },
  machineEdit: {
    gap: spacing.sm
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  setHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: -spacing.sm
  },
  setHeaderCell: {
    flex: 1,
    paddingLeft: spacing.sm
  },
  setHeaderKind: {
    width: 72,
    textAlign: "center"
  },
  setHeaderAction: {
    width: 34
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    width: "100%",
    minWidth: 0
  },
  setNumber: {
    width: 18,
    textAlign: "center",
    flexShrink: 0
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  setInput: {
    flexBasis: 0,
    paddingHorizontal: spacing.sm
  },
  kindButton: {
    width: 72,
    minHeight: 40,
    flexShrink: 0,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  kindButtonActive: {
    backgroundColor: palette.warning
  },
  kindText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "700"
  },
  kindTextActive: {
    color: palette.surface
  },
  notes: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: spacing.md
  },
  iconButton: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    ...fastTouchStyle
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    ...fastTouchStyle
  },
  secondaryButtonText: {
    color: palette.ink,
    fontWeight: "700"
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "800"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  hintText: {
    color: palette.muted
  }
}));
