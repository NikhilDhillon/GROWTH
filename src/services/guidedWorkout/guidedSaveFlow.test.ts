import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

// Exercise the screen's real actions against a controllable persistence boundary.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const state = vi.hoisted(() => ({ current: {} as Record<string, any> }));
const actions = vi.hoisted(() => ({ save: vi.fn(), updateDraft: vi.fn(), finish: vi.fn(), navigate: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useEffect: () => undefined,
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  }
}));
vi.mock("react-native", () => ({ useColorScheme: () => "light",
  Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput", View: "View",
  Platform: { OS: "web", select: (values: { web: unknown }) => values.web }, StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock("lucide-react-native", () => ({ Check: "Check", ChevronDown: "ChevronDown", ChevronRight: "ChevronRight", Plus: "Plus", Search: "Search", Timer: "Timer", X: "X" }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: actions.navigate }) }));
vi.mock("@/components/MachineProfilePanel", () => ({ MachineProfilePanel: "MachineProfilePanel" }));
vi.mock("@/components/SearchableExercisePicker", () => ({ SearchableExercisePicker: "SearchableExercisePicker" }));
vi.mock("@/components/BottomSheet", () => ({ BottomSheet: "BottomSheet" }));
vi.mock("@/components/VisualSetComposer", () => ({ VisualSetComposer: "VisualSetComposer" }));
vi.mock("@/components/FlowSetLogger", () => ({ FlowSetLogger: "FlowSetLogger" }));
vi.mock("@/components/FocusShell", () => ({ FocusShell: "FocusShell" }));
vi.mock("@/components/NewExerciseForm", () => ({ NewExerciseForm: "NewExerciseForm" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/store/useFitnessStore", () => {
  const useFitnessStore = Object.assign((select: (value: object) => unknown) => select(state.current), { getState: () => state.current });
  return { useFitnessStore };
});

import { createActiveWorkout } from "@/constants/activeWorkout";
import { createDefaultGuidedWorkoutPreferences } from "@/constants/guidedWorkout";
import { GuidedWorkoutScreen } from "@/screens/Workout/GuidedWorkoutScreen";
import { WorkoutValidationError } from "@/database/workoutWrite";
import { sameStoredJson } from "@/database/workoutWrite";
import { getExerciseLoadType } from "@/constants/exercises";
import { parseObservedSets } from "@/domain/observations";
import { advanceWorkoutDraft, committedWorkoutDraft, workoutRecordFromDraft } from "@/domain/workoutLifecycle";
import { assertGuidedObservationsConfirmed, confirmGuidedObservation } from "@/services/guidedWorkout/guidedObservationService";
import { ActiveWorkout, CompletedGuidedWorkout, LoggedSetDraft, UnitSystem } from "@/types";

type Element = { type: unknown; props: { [key: string]: any; children?: unknown } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render() {
  hooks.cursor = 0;
  const wrapper = GuidedWorkoutScreen() as Element;
  return typeof wrapper.type === "function" ? wrapper.type(wrapper.props) : wrapper;
}
function button(tree: unknown, text: string) {
  return elements(tree).find((element) => element.type === "Pressable" && elements(element.props.children).some((child) => child.props.children === text))!;
}
function saveNextButton(tree: unknown) {
  const actionLabels = new Set(["Save exercise", "Retry exercise save", "Saving…"]);
  return elements(tree).find((element) => element.type === "Pressable"
    && elements(element.props.children).some((child) => typeof child.props.children === "string" && actionLabels.has(child.props.children)))!;
}
function openFinish() {
  button(render(), "End workout").props.onPress();
  return button(render(), "Save current & finish");
}
function hasMessage(text: string) {
  return elements(render()).some((element) => typeof element.props.children === "string" && element.props.children.includes(text));
}
function composer(tree: unknown) {
  return elements(tree).find((element) => element.type === "VisualSetComposer")!;
}
function notesInput(tree: unknown) {
  return elements(tree).find((element) => element.type === "TextInput" && element.props.multiline)!;
}
type RecordingInput = {
  requestId: string; expectedActive: ActiveWorkout; unitSystem: UnitSystem; exerciseId: number;
  workoutDate: string; notes: string; machineProfileId?: string | null; sets: LoggedSetDraft[];
};
function atomicCompletion(input: RecordingInput, sessionId = 42): ActiveWorkout {
  const exercise = state.current.exercises.find((item: { id: number }) => item.id === input.exerciseId);
  const sets = parseObservedSets(input.sets, input.unitSystem, getExerciseLoadType(exercise.name));
  const completedAt = "2026-10-04T22:00:00.000Z";
  const authoritative = committedWorkoutDraft(input.expectedActive, {
    requestId: input.requestId, expectedActive: input.expectedActive, workoutId: input.expectedActive.workoutId!,
    exerciseId: input.exerciseId, workoutDate: input.workoutDate, notes: input.notes, machineProfileId: input.machineProfileId,
    inputUnit: input.unitSystem, recordingOrigin: "guided", sets, completedAt
  }, sessionId);
  // Model the store accepting the transaction result while preserving newer local edits.
  const latest = state.current.activeWorkout as ActiveWorkout | null;
  if (latest && latest.workoutId === input.expectedActive.workoutId && latest.startedAt === input.expectedActive.startedAt) {
    state.current.activeWorkout = sameStoredJson(latest, input.expectedActive) ? authoritative : {
      ...latest, revision: authoritative.revision,
      completedExercises: [...latest.completedExercises.filter((entry) => entry.sessionId !== sessionId), ...authoritative.completedExercises]
    };
    state.current.savedActiveWorkout = authoritative;
    state.current.activeWorkoutDirty = !sameStoredJson(state.current.activeWorkout, authoritative);
  }
  state.current.sessions = [...state.current.sessions.filter((entry: { id: number }) => entry.id !== sessionId), {
    id: sessionId, workout_date: input.workoutDate, notes: input.notes, input_unit: input.unitSystem, created_at: completedAt
  }];
  state.current.sets = [...state.current.sets.filter((set: { session_id: number }) => set.session_id !== sessionId), ...sets.map((set, index) => ({
    id: 100 + index, session_id: sessionId, exercise_id: input.exerciseId, set_number: index + 1,
    reps: set.reps, weight: set.weight, is_warmup: set.isWarmup ? 1 : 0, created_at: completedAt
  }))];
  state.current.workoutRecords = [workoutRecordFromDraft(input.expectedActive)];
  state.current.workoutReferences = [{ workoutId: input.expectedActive.workoutId, sessionId,
    prescription: input.expectedActive.currentExercise.prescription ?? null, completedAt }];
  return authoritative;
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  vi.stubGlobal("React", React);
  for (const action of Object.values(actions)) action.mockReset();
  const active = createActiveWorkout({ key: "sun", label: "Sunday", muscles: ["Biceps"] });
  active.workoutDate = "2026-10-04";
  active.currentExercise = {
    ...active.currentExercise, muscle: "Biceps", exerciseId: 1,
    sets: [8, 8, 8].map((reps) => confirmGuidedObservation({ reps: String(reps), weight: "100" }, { exerciseId: 1, workoutDate: "2026-10-04", unitSystem: "lb" }))
  };
  state.current = {
    currentUser: { id: "user-a" }, activeWorkout: active, activeWorkoutFinalizing: false,
    savedActiveWorkout: active, activeWorkoutDirty: false, activeDraftConflict: false, recoveredWorkoutDrafts: [],
    completedGuidedWorkouts: [], workoutRecords: [], workoutReferences: [],
    exercises: [{ id: 1, name: "Barbell Curl", primary_muscle: "Biceps", is_strength_exercise: 1, created_at: "2026-01-01" }],
    sessions: [], sets: [], bodyWeightLogs: [], exercisePoints: [], machineProfiles: [], unitSystem: "lb",
    bodyUnitPreferences: { weight: "lb", circumference: "cm" },
    trainingSplit: { days: [{ key: "sun", label: "Sunday", muscles: ["Biceps"] }] },
    guidedWorkoutPreferences: createDefaultGuidedWorkoutPreferences(),
    saveWorkout: actions.save, updateActiveWorkout: actions.updateDraft, finishActiveWorkout: actions.finish
  };
  actions.updateDraft.mockImplementation(async (workout: ActiveWorkout) => {
    const saved = { ...workout, revision: (workout.revision ?? 0) + 1 };
    state.current.activeWorkout = saved;
    state.current.savedActiveWorkout = saved;
    state.current.activeWorkoutDirty = false;
  });
  actions.save.mockImplementation(async (input: RecordingInput) => { atomicCompletion(input); return 42; });
  actions.finish.mockImplementation(async () => { state.current.activeWorkout = null; });
});
afterEach(() => vi.unstubAllGlobals());

it("lets Guided choose an off-plan exercise directly and infers its muscle without changing the weekly split", () => {
  state.current.activeWorkout = {
    ...state.current.activeWorkout,
    plannedMuscles: ["Chest"],
    currentExercise: { ...state.current.activeWorkout.currentExercise, muscle: null, exerciseId: null }
  };
  state.current.trainingSplit = { days: [{ key: "sun", label: "Sunday", muscles: ["Chest"] }] };
  const tree = render();
  const picker = elements(tree).find((element) => element.type === "SearchableExercisePicker")!;
  expect(picker.props.exercises.map((exercise: { id: number }) => exercise.id)).toEqual([1]);
  expect(hasMessage("Today is scheduled for rest")).toBe(false);
  expect(hasMessage("Update weekly split")).toBe(false);

  picker.props.onSelect(1);

  expect(state.current.activeWorkout.currentExercise).toMatchObject({ exerciseId: 1, muscle: "Biceps" });
  expect(state.current.activeWorkout.plannedMuscles).toEqual(["Chest"]);
  expect(state.current.trainingSplit.days).toEqual([{ key: "sun", label: "Sunday", muscles: ["Chest"] }]);
});

it.each(["active", "rest", "ended"])("keeps recovery visible in the %s workout flow", (flow) => {
  const recovered = state.current.activeWorkout as ActiveWorkout;
  state.current.recoveredWorkoutDrafts = [{ id: "recovered", savedAt: "2026-10-09T12:00:00Z", draft: recovered }];
  state.current.activeDraftConflict = true;
  state.current.reloadSavedWorkoutDraft = vi.fn().mockResolvedValue(undefined);
  if (flow === "rest") state.current.activeWorkout = { ...recovered, plannedMuscles: [] };
  if (flow === "ended") state.current.activeWorkout = null;
  const tree = render();
  expect(hasMessage("Recovered draft")).toBe(true);
  expect(hasMessage("Set 1: 100 (unit unrecorded) × 8")).toBe(true);
  button(tree, "Reload saved draft").props.onPress();
  expect(state.current.reloadSavedWorkoutDraft).toHaveBeenCalledTimes(1);
  expect(actions.save).not.toHaveBeenCalled();
});

describe("guided save reliability", () => {
  it("places the current task before recorded history and exposes completed work on deliberate expansion", async () => {
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    let tree = render();
    const heading = (element: Element) => Array.isArray(element.props.children) ? element.props.children.join("") : element.props.children;
    expect(elements(tree).some((element) => heading(element) === "Exercise 1: Barbell Curl")).toBe(false);
    button(tree, "Show 1 recorded exercise").props.onPress();
    tree = render();
    const items = elements(tree);
    const selection = items.findIndex((element) => element.props.caption === "Exercise 2");
    const recorded = items.findIndex((element) => heading(element) === "Exercise 1: Barbell Curl");
    expect(selection).toBeGreaterThanOrEqual(0); expect(recorded).toBeGreaterThan(selection);
  });
  it("records the draft's displayed unit even if preferences change before its first save", async () => {
    state.current.activeWorkout = { ...state.current.activeWorkout, currentExercise: { ...state.current.activeWorkout.currentExercise, requestUnit: "lb" } };
    state.current.unitSystem = "kg";
    const tree = render();
    expect(composer(tree).props.unitSystem).toBe("lb");
    saveNextButton(tree).props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save.mock.calls[0][0].unitSystem).toBe("lb");
    expect(state.current.sets.map((set: { weight: number }) => set.weight)).toEqual([100, 100, 100]);
  });
  it("re-establishes the durable identity before retrying after an optimistic draft write failed", async () => {
    let durableRequest: string | undefined;
    let draftWrites = 0;
    const events: string[] = [];
    actions.updateDraft.mockImplementation(async (workout: ActiveWorkout) => {
      state.current.activeWorkout = workout; // Same optimistic behavior as the store.
      state.current.activeWorkoutDirty = true;
      const key = workout.currentExercise.requestId;
      if (!key) { events.push("unexpected-second-write"); return; }
      events.push(`draft:${key}`);
      draftWrites += 1;
      if (draftWrites === 1) throw new Error("Draft persistence failed.");
      durableRequest = key;
      state.current.savedActiveWorkout = workout;
      state.current.activeWorkoutDirty = false;
    });
    actions.save.mockImplementation(async (input: RecordingInput) => {
      expect(durableRequest).toBe(input.requestId);
      events.push(`canonical:${input.requestId}`);
      atomicCompletion(input);
      return 42;
    });
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Draft persistence failed")).toBe(true));
    const requestId = state.current.activeWorkout.currentExercise.requestId;
    expect(requestId).toBeTruthy();
    expect(durableRequest).toBeUndefined();
    expect(actions.save).not.toHaveBeenCalled();

    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));
    expect(events).toEqual([`draft:${requestId}`, `draft:${requestId}`, `canonical:${requestId}`]);
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.updateDraft).toHaveBeenCalledTimes(2);
  });

  it("blocks stale and remounted capture controls while another instance finalizes the workout", () => {
    const oldNext = saveNextButton(render());
    const original = state.current.activeWorkout;
    state.current.activeWorkoutFinalizing = true;
    const locked = render();
    expect(composer(locked).props.disabled).toBe(true);
    expect(notesInput(locked).props.editable).toBe(false);
    expect(button(locked, "End workout").props.disabled).toBe(true);
    oldNext.props.onPress();
    composer(locked).props.onSetsChange([{ reps: "12", weight: "110" }]);
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.updateDraft).not.toHaveBeenCalled();
    expect(state.current.activeWorkout).toBe(original);
  });
  it("saves the live draft rather than an older rendered handler's values, treating filled sets as performed", async () => {
    const staleButton = saveNextButton(render());
    state.current.activeWorkout = {
      ...state.current.activeWorkout,
      currentExercise: { ...state.current.activeWorkout.currentExercise, sets: [{ reps: "9", weight: "110" }, { reps: "7", weight: "110" }, { reps: "", weight: "" }] }
    };
    staleButton.props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    const input = actions.save.mock.calls[0][0] as RecordingInput;
    expect(input.sets.map((set) => [set.reps, set.weight])).toEqual([["9", "110"], ["7", "110"], ["", ""]]);
    // The recording boundary still verifies a confirmation per set; saving supplies it on
    // both the recorded sets and the durable draft they are checked against.
    for (const sets of [input.sets, input.expectedActive.currentExercise.sets]) {
      expect(sets.slice(0, 2).every((set) => Boolean(set.observationConfirmation))).toBe(true);
      expect(sets[2].observationConfirmation).toBeUndefined();
      expect(() => assertGuidedObservationsConfirmed(sets, { exerciseId: 1, workoutDate: "2026-10-04", unitSystem: "lb" })).not.toThrow();
    }
  });

  it("names a half-filled set instead of saving or silently dropping it", async () => {
    state.current.activeWorkout = {
      ...state.current.activeWorkout,
      currentExercise: { ...state.current.activeWorkout.currentExercise, sets: [{ reps: "8", weight: "100" }, { reps: "8", weight: "" }] }
    };
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Set 2 needs both reps and load")).toBe(true));
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.updateDraft).not.toHaveBeenCalled();
  });

  it("retains the operation identity after a lost acknowledgement and retries one canonical record", async () => {
    const committed = new Map<string, number>();
    actions.save.mockImplementation(async (input: RecordingInput) => {
      expect(state.current.activeWorkout.currentExercise.requestId).toBe(input.requestId);
      if (!committed.has(input.requestId)) {
        committed.set(input.requestId, 42);
        throw new Error("Connection lost before acknowledgement.");
      }
      atomicCompletion(input);
      return committed.get(input.requestId);
    });
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Connection lost")).toBe(true));
    const requestId = state.current.activeWorkout.currentExercise.requestId;
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));
    expect(actions.save).toHaveBeenCalledTimes(2);
    expect(actions.save.mock.calls[1][0].requestId).toBe(requestId);
    expect(committed.size).toBe(1);
    expect(state.current.activeWorkout.completedExercises[0].sessionId).toBe(42);
  });

  it("retries the canonical receipt without rewriting a remotely completed draft after acknowledgement loss", async () => {
    let durable = state.current.activeWorkout as ActiveWorkout;
    actions.updateDraft.mockImplementation(async (candidate: ActiveWorkout) => {
      durable = advanceWorkoutDraft(durable, candidate);
      state.current.activeWorkout = durable;
      state.current.savedActiveWorkout = durable;
      state.current.activeWorkoutDirty = false;
    });
    let committed = false;
    actions.save.mockImplementation(async (input: RecordingInput) => {
      if (!committed) {
        const local = state.current.activeWorkout;
        const baseline = state.current.savedActiveWorkout;
        durable = atomicCompletion(input);
        state.current.activeWorkout = local;
        state.current.savedActiveWorkout = baseline;
        state.current.activeWorkoutDirty = false;
        committed = true;
        throw new Error("Server committed but acknowledgement lost.");
      }
      expect(durable.currentExercise.exerciseId).toBeNull();
      expect(durable.completedExercises[0].sessionId).toBe(42);
      state.current.activeWorkout = durable;
      state.current.savedActiveWorkout = durable;
      return 42;
    });
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("acknowledgement lost")).toBe(true));
    const requestId = state.current.activeWorkout.currentExercise.requestId;

    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));

    expect(actions.updateDraft).toHaveBeenCalledTimes(1);
    expect(actions.save).toHaveBeenCalledTimes(2);
    expect(actions.save.mock.calls[1][0].requestId).toBe(requestId);
    expect(state.current.activeWorkout.currentExercise.exerciseId).toBeNull();
    expect(state.current.activeWorkout.completedExercises[0].sets).toEqual([]);
  });

  it("freezes the attempted values and retries with the original explicitly bound unit", async () => {
    actions.save.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Acknowledgement lost")).toBe(true));
    const pending = state.current.activeWorkout.currentExercise;
    expect(pending.requestUnit).toBe("lb");
    state.current.unitSystem = "kg";

    const tree = render();
    expect(composer(tree).props.unitSystem).toBe("lb");
    expect(composer(tree).props.readOnlyValues).toBe(true);
    expect(elements(tree).find((element) => element.type === "TextInput" && element.props.multiline)!.props.editable).toBe(false);
    elements(tree).find((element) => element.type === "SearchableExercisePicker")!.props.onSelect(1);
    composer(render()).props.onSetsChange([{ reps: "12", weight: "110" }]);
    expect(state.current.activeWorkout.currentExercise).toBe(pending);

    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));
    expect(actions.save.mock.calls[1][0]).toMatchObject({ requestId: pending.requestId, unitSystem: "lb", sets: pending.sets });
  });

  it("releases only a new attempt rejected before persistence so its invalid entry can be corrected", async () => {
    actions.save.mockRejectedValueOnce(new WorkoutValidationError("Two working sets are required."));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Two working sets")).toBe(true));
    expect(state.current.activeWorkout.currentExercise.requestId).toBeUndefined();
    expect(state.current.activeWorkout.currentExercise.requestUnit).toBeUndefined();
    expect(composer(render()).props.readOnlyValues).toBe(false);
  });

  it("does not release a reused ambiguous identity even when a later retry fails validation", async () => {
    actions.save.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Acknowledgement lost")).toBe(true));
    const pendingId = state.current.activeWorkout.currentExercise.requestId;
    actions.save.mockRejectedValueOnce(new WorkoutValidationError("Validation rejected the retry."));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Validation rejected")).toBe(true));
    expect(state.current.activeWorkout.currentExercise.requestId).toBe(pendingId);
    expect(composer(render()).props.readOnlyValues).toBe(true);
  });

  it("requires fresh explicit unit review for a legacy pending draft and keeps its identity", async () => {
    const existing = state.current.activeWorkout.currentExercise;
    state.current.activeWorkout = { ...state.current.activeWorkout, currentExercise: { ...existing, requestId: "legacy-request" } };
    const initial = composer(render());
    expect(initial.props.sets.every((set: { observationConfirmation?: string }) => !set.observationConfirmation)).toBe(true);
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("displayed units")).toBe(true));
    expect(actions.save).not.toHaveBeenCalled();

    const reviewed = [...initial.props.sets];
    reviewed[0] = confirmGuidedObservation(reviewed[0], initial.props.observationContext);
    initial.props.onSetsChange(reviewed);
    expect(state.current.activeWorkout.currentExercise.requestUnit).toBe("lb");
    expect(state.current.activeWorkout.currentExercise.requestId).toBe("legacy-request");
    expect(state.current.activeWorkout.currentExercise.sets[1].observationConfirmation).toBeUndefined();
    const current = composer(render());
    current.props.onSetsChange(current.props.sets.map((set: any) => confirmGuidedObservation(set, current.props.observationContext)));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save.mock.calls[0][0]).toMatchObject({ requestId: "legacy-request", unitSystem: "lb" });
  });

  it("does not discard a pending uncertain observation when finishing is requested", async () => {
    actions.save.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Acknowledgement lost")).toBe(true));
    button(render(), "End workout").props.onPress();
    button(render(), "Discard current & finish").props.onPress();
    await vi.waitFor(() => expect(hasMessage("Retry it before discarding")).toBe(true));
    expect(actions.finish).not.toHaveBeenCalled();
    expect(state.current.activeWorkout.currentExercise.requestId).toBeTruthy();
  });

  it("keeps a newer draft and leaves the workout open after a suspended save resumes", async () => {
    let acknowledge!: (id: number) => void;
    actions.save.mockImplementation((input: RecordingInput) => new Promise<number>((resolve) => { acknowledge = (id) => { atomicCompletion(input, id); resolve(id); }; }));
    openFinish().props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    const newerDraft = { ...state.current.activeWorkout.currentExercise, notes: "Newer notes", sets: [{ reps: "10", weight: "110" }] };
    state.current.activeWorkout = { ...state.current.activeWorkout, scheduleChanges: ["Newer plan"], currentExercise: newerDraft };
    acknowledge(42);
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));
    expect(state.current.activeWorkout.currentExercise).toBe(newerDraft);
    expect(state.current.activeWorkout.scheduleChanges).toEqual(["Newer plan"]);
    expect(actions.finish).not.toHaveBeenCalled();
    expect(hasMessage("newer draft was kept")).toBe(true);
  });

  it("does not replace a different workout after an older save completes", async () => {
    let acknowledge!: (id: number) => void;
    actions.save.mockImplementation((input: RecordingInput) => new Promise<number>((resolve) => { acknowledge = (id) => { atomicCompletion(input, id); resolve(id); }; }));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    const newer = { ...state.current.activeWorkout, workoutId: "different-workout", startedAt: "2026-10-04T22:00:00Z", currentExercise: { ...state.current.activeWorkout.currentExercise, notes: "Different session" } };
    state.current.activeWorkout = newer;
    acknowledge(42);
    await vi.waitFor(() => expect(hasMessage("newer workout was kept")).toBe(true));
    expect(state.current.activeWorkout).toBe(newer);
    expect(actions.updateDraft).toHaveBeenCalledTimes(1); // Only preparation of the older request.
    expect(actions.finish).not.toHaveBeenCalled();
  });

  it("ignores repeated taps while a save is awaiting acknowledgement", async () => {
    let acknowledge!: (id: number) => void;
    actions.save.mockImplementation((input: RecordingInput) => new Promise<number>((resolve) => { acknowledge = (id) => { atomicCompletion(input, id); resolve(id); }; }));
    const next = saveNextButton(render());
    next.props.onPress();
    next.props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    acknowledge(42);
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));
  });

  it("retries failed finalization with the same session and stable summary identity", async () => {
    const workoutId = state.current.activeWorkout.startedAt;
    const canonical = new Map<string, number>();
    actions.save.mockImplementation(async (input: RecordingInput) => {
      canonical.set(input.requestId, 42);
      atomicCompletion(input);
      return canonical.get(input.requestId);
    });
    actions.finish.mockRejectedValueOnce(new Error("Finalization acknowledgement lost."));
    openFinish().props.onPress();
    await vi.waitFor(() => expect(hasMessage("Finalization acknowledgement lost")).toBe(true));
    button(render(), "Finish workout").props.onPress();
    await vi.waitFor(() => expect(actions.finish).toHaveBeenCalledTimes(2));
    expect(canonical.size).toBe(1);
    const summaries = actions.finish.mock.calls.map(([summary]) => summary as CompletedGuidedWorkout);
    expect(summaries.map((summary) => summary.id)).toEqual([workoutId, workoutId]);
    expect(summaries.every((summary) => summary.completedExercises.length === 1 && summary.completedExercises[0].sessionId === 42)).toBe(true);
  });

  it("keeps a legacy receipt without a workout reference pending for explicit reconciliation", async () => {
    const previous = state.current.activeWorkout.currentExercise.sets;
    actions.save.mockResolvedValueOnce(42); // Historical receipt returns its entry; no modern link exists.
    openFinish().props.onPress();

    await vi.waitFor(() => expect(hasMessage("earlier attempt")).toBe(true));

    // The attempted values stay pending; the attempt also records how they were captured.
    expect(state.current.activeWorkout.currentExercise.sets).toEqual(previous.map((set: LoggedSetDraft) => ({ ...set, evidence: "typed", capturedValues: expect.any(String) })));
    expect(state.current.activeWorkout.currentExercise.requestId).toBeTruthy();
    expect(state.current.activeWorkout.completedExercises).toEqual([]);
    expect(state.current.workoutReferences).toEqual([]);
    expect(actions.updateDraft).toHaveBeenCalledTimes(1);
    expect(actions.finish).not.toHaveBeenCalled();
  });

  it("reuses the frozen numeric prescription on retry after preferences and history change", async () => {
    state.current.sessions = [{ id: 10, workout_date: "2026-10-03", created_at: "2026-10-03T12:00:00Z" }];
    state.current.sets = [1, 2, 3].map((set_number) => ({ id: set_number, session_id: 10, exercise_id: 1, set_number, reps: 7, weight: 100, is_warmup: 0, created_at: "2026-10-03T12:00:00Z" }));
    actions.save.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    saveNextButton(render()).props.onPress();
    await vi.waitFor(() => expect(hasMessage("Acknowledgement lost")).toBe(true));
    const first = actions.save.mock.calls[0][0] as RecordingInput;
    const frozen = first.expectedActive.currentExercise.prescription;
    expect(frozen?.sets.map((set) => ({ reps: set.targetReps?.minimum, load: set.targetLoadLb }))).toEqual([
      { reps: 8, load: 100 }, { reps: 8, load: 100 }, { reps: 8, load: 100 }
    ]);
    state.current.guidedWorkoutPreferences = { ...state.current.guidedWorkoutPreferences, strengthTargetReps: 3 };
    state.current.sets = state.current.sets.map((set: object) => ({ ...set, reps: 20, weight: 50 }));

    const retryTree = render();
    expect(composer(retryTree).props.targets.map((target: { targetReps: number; weight: number }) => ({ reps: target.targetReps, load: target.weight }))).toEqual([
      { reps: 8, load: 100 }, { reps: 8, load: 100 }, { reps: 8, load: 100 }
    ]);
    saveNextButton(retryTree).props.onPress();
    await vi.waitFor(() => expect(state.current.activeWorkout.completedExercises).toHaveLength(1));

    const retry = actions.save.mock.calls[1][0] as RecordingInput;
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.expectedActive.currentExercise.prescription).toEqual(frozen);
    expect(state.current.workoutReferences[0].prescription).toEqual(frozen);
  });

  it("finishes with references to canonical observations and no archive copies of performed sets", async () => {
    openFinish().props.onPress();
    await vi.waitFor(() => expect(actions.finish).toHaveBeenCalledTimes(1));

    const summary = actions.finish.mock.calls[0][0] as CompletedGuidedWorkout;
    expect(summary.completedExercises).toEqual([expect.objectContaining({ sessionId: 42, exerciseId: 1, sets: [] })]);
    expect(summary.currentExercise.exerciseId).toBeNull();
    expect(summary.currentExercise.sets.every((set) => !set.reps && !set.weight)).toBe(true);
    expect(state.current.sets.filter((set: { session_id: number }) => set.session_id === 42)).toHaveLength(3);
    expect(state.current.workoutReferences).toEqual([expect.objectContaining({ sessionId: 42, workoutId: summary.workoutId })]);
    expect(actions.updateDraft).toHaveBeenCalledTimes(1);
  });
});

describe("flow mode", () => {
  function renderFocus() {
    hooks.cursor = 0;
    const wrapper = GuidedWorkoutScreen({ focus: true }) as Element;
    return typeof wrapper.type === "function" ? wrapper.type(wrapper.props) : wrapper;
  }
  const logger = (tree: unknown) => elements(tree).find((element) => element.type === "FlowSetLogger")!;
  beforeEach(() => {
    state.current.activeWorkout = { ...state.current.activeWorkout, currentExercise: { ...state.current.activeWorkout.currentExercise,
      sets: [{ reps: "", weight: "100" }, { reps: "", weight: "100" }, { reps: "", weight: "100" }] } };
  });

  it("logs the dialed values as a flow set and starts rest", async () => {
    const first = logger(renderFocus());
    expect(first.props).toMatchObject({ fill: true, row: 0, weight: 100, rest: null });
    first.props.onChange({ weight: 105, reps: 9 });
    expect(logger(renderFocus()).props).toMatchObject({ weight: 105, reps: 9 });
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.currentExercise.sets[0]).toMatchObject({ reps: "9", weight: "105", evidence: "flow" }));
    expect(state.current.activeWorkout.rest).toMatchObject({ setIndex: 0, seconds: 90 });
    // The waiting rows take the new load as suggestions; they are not logged.
    expect(state.current.activeWorkout.currentExercise.sets.slice(1).map((set: LoggedSetDraft) => [set.weight, set.reps])).toEqual([["105", ""], ["105", ""]]);
    expect(logger(renderFocus()).props).toMatchObject({ row: 1, rest: expect.objectContaining({ canAddSet: false, next: "105 × 8" }) });
  });

  it("finishing early saves only the confirmed sets", async () => {
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.rest).toBeTruthy());
    button(renderFocus(), "Finish workout").props.onPress();
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save.mock.calls[0][0].sets).toEqual([expect.objectContaining({ reps: expect.any(String), weight: "100", evidence: "flow" })]);
  });

  it("after the last set, rest offers another set and names the next exercise", async () => {
    state.current.activeWorkout = { ...state.current.activeWorkout, currentExercise: { ...state.current.activeWorkout.currentExercise, sets: [{ reps: "", weight: "100" }] } };
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.rest).toBeTruthy());
    expect(logger(renderFocus()).props).toMatchObject({ row: null, rest: expect.objectContaining({ canAddSet: true, next: null }) });
  });

  it("reopens a finished set from its pill to fix it, or puts it back in the queue", async () => {
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.currentExercise.sets[0].evidence).toBe("flow"));
    logger(renderFocus()).props.onSkipRest();
    await vi.waitFor(() => expect(state.current.activeWorkout.rest).toBeNull());
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.currentExercise.sets[1].evidence).toBe("flow"));
    const performedAt = state.current.activeWorkout.currentExercise.sets[0].performedAt;

    logger(renderFocus()).props.onEditSet(0);
    const editing = logger(renderFocus()).props;
    expect(editing).toMatchObject({ editing: true, row: 0, rest: null, weight: 100 });
    editing.onChange({ weight: 95, reps: 6 });
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.currentExercise.sets[0]).toMatchObject({ weight: "95", reps: "6", evidence: "flow", performedAt }));
    expect(logger(renderFocus()).props).toMatchObject({ editing: false, row: 2 });

    logger(renderFocus()).props.onEditSet(1);
    logger(renderFocus()).props.onUnlog();
    await vi.waitFor(() => expect(state.current.activeWorkout.currentExercise.sets[1].reps).toBe(""));
    expect(logger(renderFocus()).props).toMatchObject({ editing: false, row: 1 });
  });

  it("winding the rest ring changes this rest and the ones after it, even if skipped", async () => {
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.rest).toMatchObject({ seconds: 90 }));
    logger(renderFocus()).props.onAdjustRest(120);
    await vi.waitFor(() => expect(state.current.activeWorkout.restSeconds).toBeGreaterThanOrEqual(120));
    const length = state.current.activeWorkout.restSeconds;
    expect(state.current.activeWorkout.rest.seconds).toBe(length);
    logger(renderFocus()).props.onSkipRest();
    await vi.waitFor(() => expect(state.current.activeWorkout.rest).toBeNull());
    logger(renderFocus()).props.onLog();
    await vi.waitFor(() => expect(state.current.activeWorkout.rest).toMatchObject({ setIndex: 1, seconds: length }));
  });

  it("keeps the classic page as the plain set list with Save", () => {
    state.current.guidedWorkoutPreferences = { ...createDefaultGuidedWorkoutPreferences(), flowMode: true };
    const tree = render();
    expect(elements(tree).some((element) => element.type === "FlowSetLogger")).toBe(false);
    expect(composer(tree)).toBeTruthy();
    expect(saveNextButton(tree)).toBeTruthy();
  });
});
