import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

// Test real capture actions without introducing a DOM/native renderer dependency.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
const state = vi.hoisted(() => ({ current: {} as Record<string, any> }));
const recovery = vi.hoisted(() => ({ draft: null as any, accountId: null as any, cleanup: vi.fn(), flush: vi.fn() }));
const confirmation = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useEffect: (effect: () => void, dependencies: unknown[] = []) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || dependencies.some((item, i) => item !== previous[i])) hooks.effects.push(effect);
    hooks.slots[index] = dependencies;
  },
  useState(initial: unknown) {
    const index = hooks.cursor++;
    const slots = hooks.slots;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  }
}));
vi.mock("react-native", () => ({ useColorScheme: () => "light",
  ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", TextInput: "TextInput", View: "View",
  Platform: { OS: "web", select: (values: { web: unknown }) => values.web }, StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock("lucide-react-native", () => ({ Check: "Check", Copy: "Copy", Save: "Save" }));
vi.mock("@react-navigation/native", () => ({ useRoute: () => ({ key: "Log", name: "Log", params: undefined }), useNavigation: () => ({ setParams: () => undefined, navigate: () => undefined }) }));
vi.mock("@/hooks/useQuickWorkoutDraft", () => ({ useQuickWorkoutDraft: (accountId: unknown, defaults: unknown) => {
  if (recovery.draft === null || recovery.accountId !== accountId) { recovery.draft = defaults; recovery.accountId = accountId; }
  return { draft: recovery.draft, ready: true, recoveryError: null,
    setDraft: (next: any) => { recovery.draft = typeof next === "function" ? next(recovery.draft) : next; },
    flushDraft: async (next: any) => { await recovery.flush(next); if (next) recovery.draft = next; },
    clearDraft: async (next: any) => { await recovery.cleanup(); recovery.draft = next; }, reloadDraft: async () => undefined };
} }));
vi.mock("@/utils/deletion", () => ({ confirmDeletion: confirmation }));
vi.mock("@/components/SearchableExercisePicker", () => ({ SearchableExercisePicker: "SearchableExercisePicker" }));
vi.mock("@/components/DatePickerField", () => ({ DatePickerField: "DatePickerField" }));
vi.mock("@/components/DetailsDisclosure", () => ({ DetailsDisclosure: "DetailsDisclosure" }));
vi.mock("@/components/MachineProfilePanel", () => ({ MachineProfilePanel: "MachineProfilePanel" }));
vi.mock("@/components/VisualSetComposer", () => ({ VisualSetComposer: "VisualSetComposer" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: Object.assign((select: (value: object) => unknown) => select(state.current), { getState: () => state.current }) }));

import { WorkoutValidationError } from "@/database/workoutWrite";
import { WorkoutScreen } from "@/screens/Workout/WorkoutScreen";

type Element = { type: unknown; props: { [key: string]: any; children?: unknown } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render() {
  hooks.cursor = 0;
  hooks.effects = [];
  const tree = WorkoutScreen();
  hooks.effects.forEach((effect) => effect());
  return tree;
}
function composer(tree: unknown) {
  return elements(tree).find((element) => element.type === "VisualSetComposer")!;
}
function button(tree: unknown, text: string) {
  return elements(tree).find((element) => element.type === "Pressable" && elements(element.props.children).some((child) => child.props.children === text))!;
}
function notes(tree: unknown) {
  return elements(tree).find((element) => element.type === "TextInput" && element.props.multiline)!;
}
function enterWorkout() {
  render(); // Run catalog/history initialization.
  const tree = render();
  composer(tree).props.onSetsChange([{ reps: "8", weight: "100" }, { reps: "7", weight: "95" }]);
  elements(tree).find((element) => element.type === "DatePickerField")!.props.onChange("2026-10-04");
  notes(tree).props.onChangeText("Observed work");
  return render();
}

beforeEach(() => {
  recovery.draft = null; recovery.accountId = null; recovery.cleanup.mockReset().mockResolvedValue(undefined); recovery.flush.mockReset().mockResolvedValue(undefined);
  confirmation.mockReset().mockResolvedValue(true);
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.stubGlobal("React", React);
  save.mockReset().mockResolvedValue(42);
  state.current = {
    currentUser: { id: "user-a" },
    exercises: [
      { id: 1, name: "Barbell Curl", primary_muscle: "Biceps", is_strength_exercise: 1 },
      { id: 2, name: "Overhead Press", primary_muscle: "Shoulders", is_strength_exercise: 1 }
    ],
    sessions: [], sets: [], exercisePoints: [], bodyWeightLogs: [], machineProfiles: [],
    bodyUnitPreferences: { weight: "lb", circumference: "cm" }, unitSystem: "lb", saveWorkout: save
  };
});
afterEach(() => vi.unstubAllGlobals());

it("keeps entered Quick values in their displayed unit when preferences change before saving", async () => {
  const entered = enterWorkout();
  expect(elements(entered).filter((element) => element.type === "Pressable" && elements(element.props.children).some((child) => child.props.children === "Save workout"))).toHaveLength(1);
  state.current.unitSystem = "kg";
  const tree = render();
  expect(composer(tree).props.unitSystem).toBe("lb");
  await button(tree, "Save workout").props.onPress();
  expect(save.mock.calls[0][0]).toMatchObject({ unitSystem: "lb", sets: [{ reps: "8", weight: "100" }, { reps: "7", weight: "95" }] });
});

it("makes the full exercise library available without an enable-only gate or muscle pre-step", () => {
  state.current.exercises.push({ id: 3, name: "Goblet Squat", primary_muscle: "Legs", is_strength_exercise: 0 });
  const tree = render();
  const picker = elements(tree).find((element) => element.type === "SearchableExercisePicker")!;
  expect(picker.props.exercises.map((exercise: any) => exercise.id)).toEqual([1, 2, 3]);
  expect(elements(tree).some((element) => element.type === "Pressable" && elements(element.props.children).some((child) => child.props.children === "Filter by muscle"))).toBe(false);
});

describe("quick capture retry safety", () => {
  it("opening an exercise with recorded history does not turn its previous numbers into new observations", async () => {
    state.current.sessions = [{ id: 20, workout_date: "2026-10-03", created_at: "2026-10-03" }];
    state.current.sets = [
      { id: 30, session_id: 20, exercise_id: 1, set_number: 1, reps: 5, weight: 50, is_warmup: 1 },
      { id: 31, session_id: 20, exercise_id: 1, set_number: 2, reps: 8, weight: 100, is_warmup: 0 }
    ];
    render();
    const tree = render();
    expect(composer(tree).props.sets).toEqual([{ reps: "", weight: "", isWarmup: true }, { reps: "", weight: "", isWarmup: false }]);
    expect(composer(tree).props.targets).toEqual([expect.objectContaining({ weight: 50, targetReps: 5 }), expect.objectContaining({ weight: 100, targetReps: 8 })]);
    await button(tree, "Save workout").props.onPress();
    expect(save).not.toHaveBeenCalled(); expect(recovery.draft.pending).toBeNull();
  });

  it("explicitly using previous sets copies those observations into editable input for a new capture", async () => {
    state.current.sessions = [{ id: 20, workout_date: "2026-10-03", created_at: "2026-10-03" }];
    state.current.sets = [
      { id: 30, session_id: 20, exercise_id: 1, set_number: 1, reps: 8, weight: 100, is_warmup: 0 },
      { id: 31, session_id: 20, exercise_id: 1, set_number: 2, reps: 7, weight: 95, is_warmup: 0 }
    ];
    render();
    button(render(), "Use previous sets").props.onPress();
    expect(save).not.toHaveBeenCalled();
    await button(render(), "Save workout").props.onPress();
    expect(save.mock.calls[0][0].sets).toEqual([{ reps: "8", weight: "100", isWarmup: false }, { reps: "7", weight: "95", isWarmup: false }]);
  });

  it("an invalid recoverable date remains visible and editable and cannot create a pending save", async () => {
    const tree = enterWorkout();
    elements(tree).find((element) => element.type === "DatePickerField")!.props.onChange("2026-02-30");
    recovery.flush.mockRejectedValue(new Error("Storage unavailable"));
    expect(() => render()).not.toThrow();
    await button(render(), "Save workout").props.onPress();
    expect(save).not.toHaveBeenCalled(); expect(recovery.flush).not.toHaveBeenCalled();
    expect(recovery.draft.pending).toBeNull(); expect(composer(render()).props.disabled).toBe(false);
  });
  it("cancelling an exercise change through the searchable picker preserves every entered field", async () => {
    let tree = enterWorkout();
    composer(tree).props.onBarWeightChange("35");
    composer(tree).props.onPlateCountsChange({ "45": 2 });
    tree = render();
    const before = structuredClone(recovery.draft);
    confirmation.mockResolvedValueOnce(false);
    await elements(tree).find((element) => element.type === "SearchableExercisePicker")!.props.onSelect(2);
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(recovery.draft).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it("accepting an exercise change through the searchable picker consistently starts clean input for the new exercise", async () => {
    let tree = enterWorkout();
    composer(tree).props.onBarWeightChange("35"); composer(tree).props.onPlateCountsChange({ "45": 2 });
    recovery.draft.machineProfileId = "previous-machine";
    tree = render();
    await elements(tree).find((element) => element.type === "SearchableExercisePicker")!.props.onSelect(2);
    expect(recovery.draft).toMatchObject({ exerciseId: 2, selectedMuscle: "Shoulders", notes: "", machineProfileId: null, barWeight: "45", workoutDate: "2026-10-04", unitSystem: "lb" });
    expect(recovery.draft.sets.every((set: any) => set.reps === "" && set.weight === "")).toBe(true);
    expect(Object.values(recovery.draft.plateCounts).every((count) => count === 0)).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps a new invalid entry editable without creating a pending attempt even if recovery storage would fail", async () => {
    enterWorkout();
    composer(render()).props.onSetsChange([{ reps: "8", weight: "" }]);
    recovery.flush.mockRejectedValue(new Error("Storage unavailable"));
    await button(render(), "Save workout").props.onPress();
    expect(save).not.toHaveBeenCalled(); expect(recovery.flush).not.toHaveBeenCalled();
    expect(recovery.draft.pending).toBeNull(); expect(composer(render()).props.disabled).toBe(false);
    composer(render()).props.onSetsChange([{ reps: "8", weight: "100" }]);
    expect(recovery.draft.sets).toEqual([{ reps: "8", weight: "100" }]);
  });

  it("ignores repeated taps both during an uncertain request and after its acknowledged completion", async () => {
    let acknowledge!: (id: number) => void;
    save.mockImplementation(() => new Promise<number>((resolve) => { acknowledge = resolve; }));
    const originalButton = button(enterWorkout(), "Save workout");
    const pending = originalButton.props.onPress();
    await originalButton.props.onPress();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    acknowledge(42);
    await pending;
    await originalButton.props.onPress();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact attempted values and units after a lost acknowledgement", async () => {
    save.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    const original = enterWorkout();
    const oldDate = elements(original).find((element) => element.type === "DatePickerField")!;
    await button(original, "Save workout").props.onPress();
    const attempted = save.mock.calls[0][0];
    state.current.unitSystem = "kg";
    const pending = render();
    expect(composer(pending).props.unitSystem).toBe("lb");
    expect(composer(pending).props.disabled).toBe(true);
    expect(notes(pending).props.editable).toBe(false);
    composer(pending).props.onSetsChange([{ reps: "12", weight: "110" }]);
    notes(pending).props.onChangeText("Changed notes");
    oldDate.props.onChange("2026-10-05");
    elements(pending).find((element) => element.type === "SearchableExercisePicker")!.props.onSelect(2);

    await button(render(), "Retry save").props.onPress();
    expect(save.mock.calls[1][0]).toEqual(attempted);
    expect(composer(render()).props.sets.every((set: { reps: string; weight: string }) => !set.reps && !set.weight)).toBe(true);
  });

  it("releases a new pre-write validation failure for correction and gives the corrected entry a new identity", async () => {
    save.mockRejectedValueOnce(new WorkoutValidationError("Check the entered sets."));
    await button(enterWorkout(), "Save workout").props.onPress();
    const firstId = save.mock.calls[0][0].requestId;
    expect(composer(render()).props.disabled).toBe(false);
    composer(render()).props.onSetsChange([{ reps: "9", weight: "105" }, { reps: "8", weight: "100" }]);
    await button(render(), "Save workout").props.onPress();
    expect(save.mock.calls[1][0].requestId).not.toBe(firstId);
    expect(save.mock.calls[1][0].sets[0]).toEqual({ reps: "9", weight: "105" });
  });

  it("does not rotate an ambiguous reused identity when a later retry fails validation", async () => {
    save.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    await button(enterWorkout(), "Save workout").props.onPress();
    const originalId = save.mock.calls[0][0].requestId;
    save.mockRejectedValueOnce(new WorkoutValidationError("Retry validation failed."));
    await button(render(), "Retry save").props.onPress();
    expect(save.mock.calls[1][0].requestId).toBe(originalId);
    expect(composer(render()).props.disabled).toBe(true);
    notes(render()).props.onChangeText("Must not replace the pending entry");
    expect(notes(render()).props.value).toBe("Observed work");
  });

  it("starts another workout only after a deliberate new edit following completion", async () => {
    await button(enterWorkout(), "Save workout").props.onPress();
    const firstId = save.mock.calls[0][0].requestId;
    composer(render()).props.onSetsChange([{ reps: "6", weight: "115" }, { reps: "6", weight: "110" }]);
    await button(render(), "Save workout").props.onPress();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].requestId).not.toBe(firstId);
  });

  it("reports an acknowledged workout truthfully when local recovery cleanup fails", async () => {
    recovery.cleanup.mockRejectedValueOnce(new Error("Quota exceeded"));
    await button(enterWorkout(), "Save workout").props.onPress();
    const tree = render();
    expect(elements(tree).some((element) => typeof element.props.children === "string" && element.props.children.includes("Workout saved. Draft cleanup failed"))).toBe(true);
    expect(composer(tree).props.disabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    await button(tree, "Retry draft cleanup").props.onPress();
    expect(composer(render()).props.disabled).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("resumes a frozen saved attempt across a remount without submitting it automatically", async () => {
    save.mockRejectedValueOnce(new Error("Acknowledgement lost"));
    await button(enterWorkout(), "Save workout").props.onPress();
    const attempted = save.mock.calls[0][0];
    hooks.slots = []; // Navigation or reload recreates component state; recovery storage survives.
    state.current.unitSystem = "kg";
    const restored = render();
    expect(save).toHaveBeenCalledTimes(1);
    expect(composer(restored).props.unitSystem).toBe("lb");
    await button(restored, "Retry save").props.onPress();
    expect(save.mock.calls[1][0]).toEqual(attempted);
  });
});
