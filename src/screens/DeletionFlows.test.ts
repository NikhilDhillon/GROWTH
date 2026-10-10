import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

// Node interaction harness: preserve hooks between renders and invoke public UI actions.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const actions = vi.hoisted(() => ({ weight: vi.fn(), measurements: vi.fn(), workout: vi.fn(), updateWorkout: vi.fn(), navigate: vi.fn() }));
const store = vi.hoisted(() => ({
  bodyWeightLogs: [{ id: 1, weight: 175, unit: "lb", logged_date: "2026-07-01", logged_at: "2026-07-01T12:00:00Z", created_at: "2026-07-01T12:00:00Z" }],
  bodyMeasurementLogs: [{ id: 1, weight: 175, measurements: { waist: 80 }, notes: "Original note", logged_date: "2026-07-01", logged_at: "2026-07-01T12:00:00Z", created_at: "2026-07-01T12:00:00Z", updated_at: "2026-07-01T12:00:00Z" }],
  bodyUnitPreferences: { weight: "kg", circumference: "cm" },
  unitSystem: "lb",
  exercises: [{ id: 1, name: "Bench Press", primary_muscle: "Chest", is_enabled: 1 }],
  sessions: [{ id: 1, workout_date: "2026-07-01", notes: "Original note", created_at: "2026-07-01T12:00:00Z" }],
  sets: [{ id: 1, session_id: 1, exercise_id: 1, set_number: 1, reps: 8, weight: 100, is_warmup: 0, created_at: "2026-07-01T12:00:00Z" }],
  exercisePoints: [], machineProfiles: [], completedGuidedWorkouts: []
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
    }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  }
}));
vi.mock("@/hooks/useReportContext", () => ({ useReportContext: (_account: unknown, _report: string, defaults: unknown) => {
  const [value, update] = React.useState(defaults); return { value, update, error: null };
} }));
vi.mock("react-native", () => ({ useColorScheme: () => "light",
  ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", TextInput: "TextInput", View: "View",
  Alert: { alert: vi.fn() }, Platform: { OS: "web", select: (values: { web: unknown }) => values.web },
  StyleSheet: { create: (styles: unknown) => styles }, useWindowDimensions: () => ({ width: 390, height: 844 })
}));
vi.mock("lucide-react-native", () => ({ Check: "Check", ChevronDown: "ChevronDown", ChevronUp: "ChevronUp", ChevronRight: "ChevronRight", Pencil: "Pencil", Plus: "Plus", Save: "Save", Search: "Search", Trash2: "Trash2", X: "X" }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: actions.navigate }) }));
vi.mock("@/components/DatePickerField", () => ({ DatePickerField: "DatePickerField" }));
vi.mock("@/components/LineGraph", () => ({ LineGraph: "LineGraph" }));
vi.mock("@/components/MachineProfilePanel", () => ({ MachineProfilePanel: "MachineProfilePanel" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/store/useFitnessStore", () => ({
  useFitnessStore: (select: (state: object) => unknown) => select({
    ...store, deleteBodyWeightLog: actions.weight, deleteBodyMeasurementLog: actions.measurements,
    deleteWorkoutLog: actions.workout, updateWorkoutLog: actions.updateWorkout
  })
}));

import { BodyweightScreen } from "@/screens/Bodyweight/BodyweightScreen";
import { BodyMeasurementsScreen } from "@/screens/BodyMeasurements/BodyMeasurementsScreen";
import { LogsScreen } from "@/screens/Logs/LogsScreen";

type Element = { type: unknown; props: { [key: string]: any; children?: unknown } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(screen: () => unknown) {
  hooks.cursor = 0;
  return screen();
}
function button(tree: unknown, label: string) {
  return elements(tree).find((item) => item.type === "Pressable" && item.props.accessibilityLabel === label)!;
}
function hasMessage(tree: unknown, message: string) {
  return elements(tree).some((item) => item.props.children === message);
}

const cases = [
  { name: "bodyweight", screen: BodyweightScreen, label: "Delete bodyweight from 2026-07-01", action: actions.weight },
  { name: "tape measurements", screen: () => BodyMeasurementsScreen({}), label: "Delete body check-in from 2026-07-01", action: actions.measurements },
  { name: "workout history", screen: LogsScreen, label: "Delete workout log from 2026-07-01", action: actions.workout }
];

beforeEach(() => {
  store.unitSystem = "lb";
  hooks.slots = [];
  hooks.cursor = 0;
  vi.stubGlobal("React", React);
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it("keeps a history edit in the unit shown when it was opened", async () => {
  button(render(LogsScreen), "Edit workout log from 2026-07-01").props.onPress();
  store.unitSystem = "kg";
  const tree = render(LogsScreen);
  const loadInput = elements(tree).find((element) => element.type === "TextInput" && element.props.value === "100")!;
  expect(loadInput.props.placeholder).toBe("lb");
  const save = elements(tree).find((element) => element.type === "Pressable" && hasMessage(element.props.children, "Save changes"))!;
  await save.props.onPress();
  expect(actions.updateWorkout).toHaveBeenCalledWith(expect.objectContaining({ unitSystem: "lb", sets: [{ reps: "8", weight: "100", isWarmup: false }] }));
});

describe.each(cases)("$name deletion on mobile web", ({ screen, label, action }) => {
  it("does not call persistence after cancellation", async () => {
    vi.stubGlobal("window", { confirm: () => false });
    button(render(screen), label).props.onPress();
    await vi.waitFor(() => expect(button(render(screen), label).props.disabled).toBe(false));
    expect(action).not.toHaveBeenCalled();
  });

  it("reports failed persistence and releases the control for retry", async () => {
    vi.stubGlobal("window", { confirm: () => true });
    action.mockRejectedValue(new Error("Offline. Please retry."));
    button(render(screen), label).props.onPress();

    await vi.waitFor(() => expect(hasMessage(render(screen), "Offline. Please retry.")).toBe(true));
    expect(button(render(screen), label).props.disabled).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("ignores repeated taps while one deletion is pending", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    let finish!: () => void;
    action.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const control = button(render(screen), label);
    control.props.onPress();
    control.props.onPress();
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(button(render(screen), label).props.disabled).toBe(true);
    finish();
    await vi.waitFor(() => expect(button(render(screen), label).props.disabled).toBe(false));
  });
});

describe("shared body capture from reports", () => {
  it.each([
    { screen: BodyweightScreen, label: "Edit bodyweight from 2026-07-01" },
    { screen: () => BodyMeasurementsScreen({}), label: "Edit body check-in from 2026-07-01" }
  ])("opens the same whole saved observation for editing", ({ screen, label }) => {
    button(render(screen), label).props.onPress();
    expect(actions.navigate).toHaveBeenCalledWith("BodyCheckIn", { checkInId: 1 });
    expect(elements(render(screen)).some((item) => item.type === "TextInput")).toBe(false);
  });

  it.each([BodyweightScreen, () => BodyMeasurementsScreen({})])("new recording clears an earlier edit route", (screen) => {
    const tree = render(screen);
    const control = button(tree, "Record body check-in");
    control.props.onPress();
    expect(actions.navigate).toHaveBeenCalledWith("BodyCheckIn", { checkInId: undefined });
  });
});

it("shows one tape chart at a time without averaging left and right measurements", () => {
  const original = store.bodyMeasurementLogs[0].measurements;
  store.bodyMeasurementLogs[0].measurements = { waist: 80, arm_flexed: { mode: "sides", left: 30, right: 40 } } as typeof original;
  try {
    let tree = render(() => BodyMeasurementsScreen({}));
    elements(tree).find((item) => item.type === "Pressable" && hasMessage(item.props.children, "Arm (flexed)"))!.props.onPress();
    tree = render(() => BodyMeasurementsScreen({}));
    let charts = elements(tree).filter((item) => item.type === "LineGraph");
    expect(charts).toHaveLength(1);
    expect(charts[0].props.points[0].value).toBe(30);
    elements(tree).find((item) => item.type === "Pressable" && hasMessage(item.props.children, "Arm (flexed) · right"))!.props.onPress();
    charts = elements(render(() => BodyMeasurementsScreen({}))).filter((item) => item.type === "LineGraph");
    expect(charts).toHaveLength(1);
    expect(charts[0].props.points[0].value).toBe(40);
  } finally { store.bodyMeasurementLogs[0].measurements = original; }
});
