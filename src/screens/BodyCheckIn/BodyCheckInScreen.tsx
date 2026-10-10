import { useEffect, useRef, useState } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { DetailsDisclosure } from "@/components/DetailsDisclosure";
import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle } from "@/components/Text";
import { BodyCheckInConflictError, BodyCheckInValidationError } from "@/domain/bodyCheckInRecording";
import { CaptureDraftConflictError } from "@/database/captureDrafts.shared";
import { useBodyCheckInDraft } from "@/hooks/useBodyCheckInDraft";
import { useFitnessStore } from "@/store/useFitnessStore";
import type { BodyMeasurementLog } from "@/types";
import { bodyMeasurementDefinitions, formatCircumference, type BodyMeasurementKey } from "@/utils/bodyMeasurements";
import { formatShortDate, todayIso } from "@/utils/date";
import { deleteWithConfirmation } from "@/utils/deletion";
import { createRequestId } from "@/utils/requestId";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";
import { formatBodyWeight } from "@/utils/units";
import {
  createBodyCheckInDraft, createBodyCheckInRequest, editedBodyCheckInDraft, hasBodyCheckInInput,
  latestBodyObservations, tapeFieldCount, type BodyCheckInDraft, type BodyCheckInField
} from "./bodyCheckInForm";

export function BodyCheckInScreen() {
  const { palette, styles } = useStyles();
  const navigation = useNavigation<{ setParams: (params: { checkInId?: number }) => void }>();
  const route = useRoute<{ key: string; name: string; params?: { checkInId?: number } }>();
  const logs = useFitnessStore((state) => state.bodyMeasurementLogs);
  const preferences = useFitnessStore((state) => state.bodyUnitPreferences);
  const accountId = useFitnessStore((state) => state.currentUser?.id ?? null);
  const recordBodyCheckIn = useFitnessStore((state) => state.recordBodyCheckIn);
  const deleteBodyCheckIn = useFitnessStore((state) => state.deleteBodyCheckIn);
  const hydrate = useFitnessStore((state) => state.hydrate);
  const { draft, setDraft, ready, recoveryError, flushDraft, clearDraft, reloadDraft } = useBodyCheckInDraft(accountId, createBodyCheckInDraft(todayIso(), preferences));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [replacement, setReplacement] = useState<BodyCheckInDraft | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [showTapeRecency, setShowTapeRecency] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const draftRef = useRef(draft);
  const accountRef = useRef(accountId);
  const handledRoute = useRef<{ accountId: typeof accountId; id: number } | null>(null);
  accountRef.current = accountId;
  draftRef.current = draft;
  const requestedId = route.params?.checkInId;
  const requestedLog = requestedId === undefined ? null : logs.find((log) => log.id === requestedId);
  const requestedUnavailable = requestedId !== undefined && !requestedLog;
  const locked = !ready || requestedUnavailable || saving || deletingId !== null || draft.pending !== null;
  const conflicting = logs.find((log) => log.logged_date === draft.loggedDate && log.id !== draft.expected?.id);
  const recency = latestBodyObservations(logs, todayIso());
  const sortedLogs = [...logs].sort((left, right) => right.logged_date.localeCompare(left.logged_date) || right.created_at.localeCompare(left.created_at) || right.id - left.id);
  const enteredTapeFields = tapeFieldCount(draft.fields);

  useEffect(() => {
    if (requestedId === undefined) { handledRoute.current = null; return; }
    if (!ready || !requestedLog || (handledRoute.current?.id === requestedId && handledRoute.current.accountId === accountId)) return;
    if (draft.pending) { setError("A recovered save is pending. Retry its unchanged observations before opening another check-in."); return; }
    handledRoute.current = { accountId, id: requestedId };
    if (draft.expected?.id !== requestedId) startEdit(requestedLog);
  }, [ready, accountId, requestedId, requestedLog, draft.pending]);

  // Today's saved check-in (often a weigh-in from Record) opens ready to extend with tape,
  // instead of a blank form that then reports the date as taken.
  const autoOpenedToday = useRef(false);
  useEffect(() => {
    if (autoOpenedToday.current || !ready || requestedId !== undefined || saved) return;
    const current = draftRef.current;
    if (current.pending || current.expected || hasBodyCheckInInput(current) || current.loggedDate !== todayIso()) return;
    const todays = logs.find((log) => log.logged_date === current.loggedDate);
    if (!todays) return;
    autoOpenedToday.current = true;
    applyReplacement(editedBodyCheckInDraft(todays, preferences));
  }, [ready, requestedId, logs, saved]);

  function change(patch: Partial<BodyCheckInDraft>) {
    if (!ready || requestedUnavailable || savingRef.current || deletingRef.current || draftRef.current.pending) return;
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setSaved(false);
  }

  function updateField(key: BodyMeasurementKey, patch: Partial<BodyCheckInField>) {
    change({ fields: { ...draftRef.current.fields, [key]: { ...draftRef.current.fields[key], ...patch } } });
  }

  function replace(next: BodyCheckInDraft) {
    if (!ready || draftRef.current.pending || savingRef.current || deletingRef.current) return;
    if (hasBodyCheckInInput(draftRef.current)) setReplacement(next);
    else applyReplacement(next);
  }

  function applyReplacement(next: BodyCheckInDraft) {
    setDraft(next);
    if (requestedId !== next.expected?.id) navigation.setParams({ checkInId: next.expected?.id });
    setError(null);
    setSaved(false);
  }

  function startEdit(log: BodyMeasurementLog) { replace(editedBodyCheckInDraft(log, preferences)); }

  async function save() {
    if (!ready || requestedUnavailable || savingRef.current || deletingRef.current) return;
    const current = draftRef.current;
    if (!current.pending && conflicting) {
      setError("A check-in already exists for this date. Edit that saved check-in or choose another date. Your unfinished values are preserved.");
      return;
    }
    let attempted;
    try { attempted = current.pending ?? createBodyCheckInRequest(current, createRequestId()); }
    catch (caught) { setError(message(caught)); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    const savingAccount = accountId;
    let committed = false;
    let didAttemptRecord = false;
    try {
      // Persist the unchanged attempt before sending it. Browser suspension or a
      // lost acknowledgement must leave enough information for an explicit retry.
      await flushDraft({ ...current, pending: attempted });
      if (accountRef.current !== savingAccount) return;
      didAttemptRecord = true;
      await recordBodyCheckIn(attempted);
      committed = true;
      if (accountRef.current !== savingAccount) return;
      setSaved(true);
      await clearDraft(createBodyCheckInDraft(todayIso(), preferences));
      if (requestedId !== undefined) navigation.setParams({ checkInId: undefined });
    } catch (caught) {
      if (accountRef.current !== savingAccount) return;
      // Unknown failures retain the operation identity and frozen payload. A retry
      // can acknowledge the original write without creating a second check-in.
      if ((!didAttemptRecord && caught instanceof CaptureDraftConflictError)
        || (!committed && (caught instanceof BodyCheckInConflictError || (!current.pending && caught instanceof BodyCheckInValidationError)))) {
        setDraft((value) => value.pending?.requestId === attempted.requestId ? { ...value, pending: null } : value);
      }
      setError(committed ? `Check-in saved. Its recovery draft could not be cleared; retry acknowledges the same recorded check-in. ${message(caught)}` : message(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove(log: BodyMeasurementLog) {
    if (!ready || savingRef.current || deletingRef.current || draftRef.current.pending) return;
    deletingRef.current = true;
    setDeletingId(log.id);
    setDeleteError(null);
    const expected = JSON.parse(JSON.stringify(log)) as BodyMeasurementLog;
    const deletingAccount = accountId;
    try {
      const result = await deleteWithConfirmation({
        title: "Delete this whole check-in?",
        message: `This removes bodyweight, all tape measurements and notes recorded for ${log.logged_date}. Other dates are preserved.`,
        deleteRecord: () => {
          if (accountRef.current !== deletingAccount) throw new Error("The account changed. Return to the original account before deleting this check-in.");
          return deleteBodyCheckIn(log.id, expected);
        },
        fallbackError: "Could not confirm deletion of this check-in. Reload its saved state and retry."
      });
      if (accountRef.current !== deletingAccount) return;
      if (result.status === "failed") setDeleteError(result.error);
      if (result.status === "deleted" && draftRef.current.expected?.id === log.id) {
        try {
          await clearDraft(createBodyCheckInDraft(todayIso(), preferences));
          if (requestedId !== undefined) navigation.setParams({ checkInId: undefined });
        }
        catch (caught) { setDeleteError(`Check-in deleted. Its unfinished form could not be cleared; the saved observation will not be restored. ${message(caught)}`); }
      }
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  }

  async function reload() {
    if (savingRef.current || deletingRef.current || draftRef.current.pending) return;
    try { await reloadDraft(); setError(null); }
    catch (caught) { setError(message(caught)); }
    setConfirmReload(false);
  }

  const saveControls = (
    <View style={{ gap: spacing.sm }}>
        {conflicting && !draft.pending ? <View style={styles.conflict}><Body>A saved check-in already uses this date.</Body><Pressable accessibilityRole="button" disabled={!ready || saving || deletingId !== null} accessibilityLabel={`Edit existing check-in from ${conflicting.logged_date}`} onPress={() => startEdit(conflicting)} style={pressableFeedback(styles.secondary)}><Pencil size={16} color={palette.ink} /><Body style={styles.secondaryText}>Edit existing check-in</Body></Pressable></View> : null}
        {draft.pending ? <Body>A save is pending. Retry its unchanged observations to confirm the result.</Body> : null}
        {error ? <Body accessibilityRole="alert" style={styles.error}>{error}</Body> : null}
        {saved ? <Body accessibilityLiveRegion="polite">Check-in saved.</Body> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Save body check-in" disabled={!ready || requestedUnavailable || saving || deletingId !== null} onPress={() => void save()} style={pressableFeedback(styles.primary)}>
          {saving ? <ActivityIndicator color={palette.surface} /> : null}<Body style={styles.primaryText}>{saving ? "Saving…" : draft.pending ? "Retry save" : draft.expected ? "Save changes" : "Save check-in"}</Body>
        </Pressable>
    </View>
  );

  return (
    <Screen>
      {requestedUnavailable ? <Panel><Body accessibilityRole="alert">This saved check-in is unavailable. It may have been deleted or its data has not loaded. Your unfinished form is preserved.</Body><Pressable accessibilityRole="button" onPress={() => void hydrate()} style={pressableFeedback(styles.secondary)}><Body>Retry loading check-ins</Body></Pressable></Panel> : null}
      {!ready || recoveryError ? <Panel>
        <Body accessibilityRole={recoveryError ? "alert" : undefined}>{recoveryError ?? "Loading your saved body-entry draft…"}</Body>
        {recoveryError ? <Body>Saved observations and unreadable draft data are preserved. Recording waits until its recovery state can be read and saved safely.</Body> : null}
        {recoveryError ? <Pressable accessibilityRole="button" disabled={saving || deletingId !== null || draft.pending !== null} onPress={() => { if (hasBodyCheckInInput(draft)) setConfirmReload(true); else void reload(); }} style={pressableFeedback(styles.secondary)}><Body>Reload saved draft</Body></Pressable> : null}
      </Panel> : null}
      <Panel>
        <View style={styles.heading}>
          <SectionTitle>{draft.expected ? "Edit check-in" : "Today"}</SectionTitle>
          {hasBodyCheckInInput(draft) || requestedId !== undefined ? <Pressable accessibilityRole="button" disabled={!ready || saving || deletingId !== null || draft.pending !== null} onPress={() => replace(createBodyCheckInDraft(todayIso(), preferences))} style={pressableFeedback(styles.secondary)}><Body>New check-in</Body></Pressable> : null}
        </View>
        {draft.expected ? <Body>Editing all observations from {draft.expected.logged_date}. Collapsed tape values stay in this check-in.</Body> : null}
        <Label>Date</Label>
        {locked ? <Body>{draft.loggedDate}</Body> : <DatePickerField value={draft.loggedDate} onChange={(loggedDate) => change({ loggedDate })} />}
        <Label>Bodyweight ({draft.inputUnits.weight})</Label>
        <TextInput
          accessibilityLabel={`Bodyweight (${draft.inputUnits.weight})`}
          style={styles.input} value={draft.weight} editable={!locked} onChangeText={(weight) => change({ weight })}
          keyboardType="decimal-pad" inputMode="decimal" returnKeyType="done" onSubmitEditing={() => void save()}
          placeholder="Weight observed on this date" submitBehavior="blurAndSubmit"
        />
        <Body style={styles.hint}>Weight is optional with tape measurements.</Body>

        {!draft.tapeExpanded ? saveControls : null}

        <Pressable accessibilityRole="button" disabled={!ready} accessibilityState={{ expanded: draft.tapeExpanded }} accessibilityLabel="Show optional tape measurements" onPress={() => setDraft((current) => ({ ...current, tapeExpanded: !current.tapeExpanded }))} style={pressableFeedback(styles.expand)}>
          {draft.tapeExpanded ? <ChevronUp size={18} color={palette.ink} /> : <ChevronDown size={18} color={palette.ink} />}
          <Body style={styles.expandLabel}>Tape measurements · {enteredTapeFields ? `${enteredTapeFields} fields entered` : "optional"} ({draft.inputUnits.circumference})</Body>
        </Pressable>
        {!draft.tapeExpanded && enteredTapeFields ? <Body>{enteredTapeFields} recorded tape fields stay in this check-in when you save.</Body> : null}
        {draft.tapeExpanded ? (
          <View style={styles.tapeFields}>
            <Body>No earlier tape values are copied into a new check-in.</Body>
            {(["Torso", "Arms", "Legs"] as const).map((group) => (
              <View key={group} style={styles.tapeFields}>
                <SectionTitle>{group}</SectionTitle>
                {bodyMeasurementDefinitions.filter((definition) => definition.group === group).map((definition) => {
                  const field = draft.fields[definition.key];
                  return (
                    <View key={definition.key} style={styles.field}>
                      <View style={styles.heading}>
                        <Label>{definition.label} ({draft.inputUnits.circumference})</Label>
                        {definition.sided ? <Pressable accessibilityRole="button" disabled={locked} accessibilityLabel={`${field.mode === "sides" ? "Use one value" : "Track left and right"} for ${definition.label}`} onPress={() => updateField(definition.key, { mode: field.mode === "sides" ? "single" : "sides" })} style={pressableFeedback(styles.secondary)}><Body>{field.mode === "sides" ? "Left / right" : "Single"}</Body></Pressable> : null}
                      </View>
                      {"hint" in definition ? <Body style={styles.hint}>{definition.hint}</Body> : null}
                      {definition.sided && field.mode === "sides" ? (
                        <View style={styles.sides}>
                          {(["left", "right"] as const).map((side) => <View key={side} style={styles.side}><Label>{side === "left" ? "Left" : "Right"}</Label><TextInput accessibilityLabel={`${definition.label} ${side} (${draft.inputUnits.circumference})`} style={styles.input} value={field[side]} editable={!locked} onChangeText={(value) => updateField(definition.key, { [side]: value })} keyboardType="decimal-pad" inputMode="decimal" returnKeyType="done" placeholder="Optional" /></View>)}
                        </View>
                      ) : <TextInput accessibilityLabel={`${definition.label} (${draft.inputUnits.circumference})`} style={styles.input} value={field.value} editable={!locked} onChangeText={(value) => updateField(definition.key, { value })} keyboardType="decimal-pad" inputMode="decimal" returnKeyType="done" placeholder="Optional" />}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}
        <DetailsDisclosure title="Add a note">
          <TextInput accessibilityLabel="Body check-in notes" style={[styles.input, styles.notes]} value={draft.notes} editable={!locked} onChangeText={(notes) => change({ notes })} multiline placeholder="Optional context" />
        </DetailsDisclosure>
        <Body style={styles.hint}>Saved units: {draft.inputUnits.weight} and {draft.inputUnits.circumference}, even if display settings change.</Body>
        {draft.tapeExpanded ? saveControls : null}
      </Panel>

      <Panel>
        <SectionTitle>Latest observations</SectionTitle>
        <Label>Bodyweight</Label>
        <Body>{recency.weight ? `${formatBodyWeight(recency.weight.weight!, preferences.weight)} · ${recency.weight.logged_date}` : "No bodyweight recorded yet."}</Body>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showTapeRecency }} onPress={() => setShowTapeRecency((value) => !value)} style={pressableFeedback(styles.secondary)}><Body>{showTapeRecency ? "Hide tape recency" : "See latest tape measurements"}</Body></Pressable>
        {showTapeRecency ? recency.tapes.map(({ definition, observations }) => <View key={definition.key}><Label>{definition.label}</Label>{observations.length ? observations.map((observation) => <Body key={observation.channel}>{`${observation.channel === "scalar" ? "" : `${observation.channel} · `}${formatCircumference(observation.valueCm, preferences.circumference)} · ${observation.date}`}</Body>) : <Body>Not recorded yet.</Body>}</View>) : null}
        <DetailsDisclosure title="How measurement dates work">
          <Body style={styles.hint}>Each measurement keeps its own date. A daily weigh-in does not update earlier tape measurements.</Body>
        </DetailsDisclosure>
      </Panel>

      <Panel>
        {deleteError ? <Body accessibilityRole="alert" style={styles.error}>{deleteError}</Body> : null}
        <DetailsDisclosure title={`History · ${sortedLogs.length}`}>
        {sortedLogs.map((log) => <View key={log.id} style={styles.historyRow}>
          <View style={styles.historyCopy}><Body style={styles.historyDate}>{formatShortDate(log.logged_date)} · {log.logged_date}</Body><Body>{log.weight === null ? "Tape only" : formatBodyWeight(log.weight, preferences.weight)}{Object.keys(log.measurements).length ? ` · ${Object.keys(log.measurements).length} tape fields` : ""}</Body>{log.notes ? <Body>{log.notes}</Body> : null}</View>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit body check-in from ${log.logged_date}`} disabled={locked} onPress={() => startEdit(log)} style={pressableFeedback(styles.icon)}><Pencil size={18} color={palette.ink} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete whole body check-in from ${log.logged_date}`} disabled={locked} onPress={() => void remove(log)} style={pressableFeedback(styles.icon)}>{deletingId === log.id ? <ActivityIndicator color={palette.danger} /> : <Trash2 size={18} color={palette.danger} />}</Pressable>
          </View>
        </View>)}
        {!sortedLogs.length ? <Body>No check-ins recorded yet.</Body> : null}
        </DetailsDisclosure>
      </Panel>

      <Modal visible={replacement !== null} transparent animationType="fade" onRequestClose={() => setReplacement(null)}>
        <View style={styles.modalLayer}><View style={styles.modalCard}><SectionTitle>Replace this unfinished form?</SectionTitle><Body>Your current entered values have not been recorded. Keep this form or deliberately discard it to open the selected check-in.</Body><Pressable accessibilityRole="button" onPress={() => setReplacement(null)} style={pressableFeedback(styles.secondary)}><Body>Keep current form</Body></Pressable><Pressable accessibilityRole="button" onPress={() => { if (replacement) applyReplacement(replacement); setReplacement(null); }} style={pressableFeedback(styles.primary)}><Body style={styles.primaryText}>Discard unfinished form</Body></Pressable></View></View>
      </Modal>
      <Modal visible={confirmReload} transparent animationType="fade" onRequestClose={() => setConfirmReload(false)}><View style={styles.modalLayer}><View style={styles.modalCard}><SectionTitle>Reload the saved draft?</SectionTitle><Body>This deliberately replaces the unfinished values currently shown with the saved draft. Recorded observations stay unchanged.</Body><Pressable accessibilityRole="button" onPress={() => setConfirmReload(false)} style={pressableFeedback(styles.secondary)}><Body>Keep current form</Body></Pressable><Pressable accessibilityRole="button" onPress={() => void reload()} style={pressableFeedback(styles.primary)}><Body style={styles.primaryText}>Reload saved draft</Body></Pressable></View></View></Modal>
    </Screen>
  );
}

function message(error: unknown) { return error instanceof Error ? error.message : "Could not save this check-in. Please retry."; }
const useStyles = createThemedStyles((palette) => StyleSheet.create({
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: palette.ink, fontSize: 17, backgroundColor: palette.surface },
  notes: { minHeight: 80, textAlignVertical: "top" },
  hint: { color: palette.muted, fontSize: 13 },
  expand: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  expandLabel: { flex: 1, minWidth: 0 },
  tapeFields: { gap: spacing.md },
  field: { gap: spacing.sm, borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.md },
  sides: { flexDirection: "row", gap: spacing.sm },
  side: { flex: 1, minWidth: 0, gap: spacing.xs },
  secondary: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 12, backgroundColor: palette.surfaceAlt },
  primary: { minHeight: 48, backgroundColor: palette.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: 12, padding: spacing.md },
  primaryText: { color: palette.surface, fontWeight: "800" },
  secondaryText: { color: palette.ink, fontWeight: "700" },
  conflict: { gap: spacing.sm },
  error: { color: palette.danger },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderColor: palette.border, paddingTop: spacing.md },
  historyCopy: { flex: 1, gap: spacing.xs },
  historyDate: { color: palette.ink, fontWeight: "800" },
  actions: { flexDirection: "row", gap: spacing.xs },
  icon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border },
  modalLayer: { flex: 1, justifyContent: "center", backgroundColor: palette.overlay, padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 460, alignSelf: "center", backgroundColor: palette.surface, borderRadius: 8, padding: spacing.lg, gap: spacing.md }
}));
