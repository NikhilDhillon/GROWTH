import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const session = vi.hoisted(() => ({
  navigate: vi.fn(), start: vi.fn(), reload: vi.fn(), recordBody: vi.fn(), active: null as null | { workoutLabel: string; plannedMuscles: string[]; startedAt?: string }, user: { id: "account-a" }, split: { days: [] as { key: string; label: string; muscles: string[] }[] },
  exercises: [] as object[], sessions: [] as object[], sets: [] as object[], bodyLogs: [] as object[]
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  }
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: session.navigate, setParams: () => undefined }), useRoute: () => ({ key: "Record", name: "Record", params: undefined }) }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (select: (value: object) => unknown) => select({ activeWorkout: session.active, currentUser: session.user, startActiveWorkout: session.start, reloadSavedWorkoutDraft: session.reload, trainingSplit: session.split,
  exercises: session.exercises, sessions: session.sessions, sets: session.sets, bodyMeasurementLogs: session.bodyLogs, bodyUnitPreferences: { weight: "lb", circumference: "in" }, unitSystem: "lb", recordBodyCheckIn: session.recordBody }) }));
vi.mock("react-native", () => ({ useColorScheme: () => "light", ActivityIndicator: "ActivityIndicator", Modal: "Modal", ScrollView: "ScrollView", Pressable: "Pressable", TextInput: "TextInput", View: "View", StyleSheet: { create: (value: unknown) => value }, Platform: { OS: "web", select: (value: { web: unknown }) => value.web } }));
vi.mock("lucide-react-native", () => ({ Check: "Check", ChevronDown: "ChevronDown", ChevronRight: "ChevronRight", Dumbbell: "Dumbbell", Minus: "Minus", Plus: "Plus", Scale: "Scale", Search: "Search", Timer: "Timer", X: "X" }));
vi.mock("@/components/BottomSheet", () => ({ BottomSheet: "BottomSheet" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/constants/activeWorkout", () => ({ todaySplitDay: (days: unknown[]) => days[0], createActiveWorkout: (day: { key: string }, label: string, templateId: string) => ({ workoutId: "new-id", day, label, templateId }) }));

import { RecordScreen } from "./RecordScreen";
import { HomeScreen } from "../Home/HomeScreen";
import { todayIso } from "@/utils/date";
type Element = { type: any; props: any };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const render = () => { hooks.cursor = 0; return RecordScreen(); };
const press = (label: string) => elements(render()).find((item) => item.type === "Pressable" && (item.props.accessibilityLabel === label || elements(item.props.children).some((child) => child.props.children === label)))!.props.onPress();
const renderHome = () => { hooks.cursor = 0; return HomeScreen(); };
const pressHome = (label: string) => elements(renderHome()).find((item) => item.type === "Pressable" && (item.props.accessibilityLabel === label || elements(item.props.children).some((child) => child.props.children === label)))!.props.onPress();
const homeOption = (label: string) => elements(renderHome()).find((item) => item.props.accessibilityLabel === label)!;
const today = todayIso();
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; session.active = null; session.split = { days: [] }; session.user = { id: "account-a" };
  session.exercises = []; session.sessions = []; session.sets = []; session.bodyLogs = [];
  session.start.mockReset().mockResolvedValue(undefined); session.reload.mockReset().mockResolvedValue(undefined); session.recordBody.mockReset().mockResolvedValue(undefined); session.navigate.mockReset();
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

it("opens a recent exercise ready to repeat, or an empty quick log, and a new body check-in", () => {
  session.exercises = [{ id: 1, name: "Barbell Bench Press", primary_muscle: "Chest" }, { id: 2, name: "Barbell Row", primary_muscle: "Back" }];
  session.sessions = [{ id: 10, workout_date: "2026-10-01" }, { id: 11, workout_date: "2026-10-03" }, { id: 12, workout_date: "2026-10-05" }];
  session.sets = [
    { id: 1, session_id: 10, exercise_id: 1, set_number: 1, reps: 8, weight: 185 }, { id: 2, session_id: 11, exercise_id: 2, set_number: 1, reps: 8, weight: 155 },
    { id: 3, session_id: 12, exercise_id: 1, set_number: 1, reps: 8, weight: 195 }, { id: 4, session_id: 12, exercise_id: 1, set_number: 2, reps: 7, weight: 195 }
  ];
  const rows = elements(render()).filter((item) => typeof item.props.accessibilityLabel === "string" && item.props.accessibilityLabel.startsWith("Log "));
  expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(["Log Barbell Bench Press", "Log Barbell Row"]);
  expect(elements(rows[0].props.children).some((child) => typeof child.props.children === "object" && JSON.stringify(child.props.children).includes("195 lb × 8 · 7"))).toBe(true);
  press("Log Barbell Bench Press");
  expect(session.navigate).toHaveBeenLastCalledWith("Log", { exerciseId: 1 });
  press("Record completed sets");
  expect(session.navigate).toHaveBeenLastCalledWith("Log");
  press("Record weight or measurements");
  expect(session.navigate).toHaveBeenLastCalledWith("BodyCheckIn", { checkInId: undefined });
});

it("saves a weigh-in prefilled from the last one and retries with the same request", async () => {
  session.bodyLogs = [{ id: 5, logged_date: "2026-01-01", weight: 180, measurements: {}, notes: null, logged_at: "2026-01-01T12:00:00Z", created_at: "2026-01-01T12:00:00Z", updated_at: "2026-01-01T12:00:00Z" }];
  expect(elements(render()).find((item) => item.type === "TextInput")!.props.value).toBe("180.0");
  session.recordBody.mockRejectedValueOnce(new Error("Offline"));
  await press("Save today's weight");
  const first = session.recordBody.mock.calls[0][0];
  expect(first).toMatchObject({ loggedDate: today, weight: "180.0", accountId: "account-a" });
  expect(first.id).toBeUndefined();
  expect(elements(render()).find((item) => item.props.accessibilityRole === "alert")?.props.children).toBe("Offline");
  await press("Save today's weight");
  expect(session.recordBody.mock.calls[1][0].requestId).toBe(first.requestId);
  expect(elements(render()).some((item) => item.type === "Body" && item.props.children === "Saved 180.0 lb")).toBe(true);
});

it("updates today's check-in, keeping its tape measurements, instead of creating a second one", async () => {
  session.bodyLogs = [{ id: 7, logged_date: today, weight: null, measurements: { waist: 80 }, notes: "Tape", logged_at: `${today}T12:00:00Z`, created_at: `${today}T12:00:00Z`, updated_at: `${today}T12:00:00Z` }];
  const input = elements(render()).find((item) => item.type === "TextInput")!;
  input.props.onChangeText("181.4");
  await press("Save today's weight");
  // Tape values travel in the input unit (inches here), exactly as the full check-in form sends them.
  expect(session.recordBody.mock.calls[0][0]).toMatchObject({ id: 7, loggedDate: today, weight: "181.4", notes: "Tape", measurements: { waist: expect.closeTo(80 / 2.54) } });
});

it("resumes an active workout without creating a competing draft", () => {
  session.active = { workoutLabel: "Legs", plannedMuscles: ["Legs"], startedAt: new Date().toISOString() };
  press("Resume guided workout");
  expect(session.navigate).toHaveBeenCalledWith("ActiveWorkout");
  expect(session.start).not.toHaveBeenCalled();
});

it("waits for persisted start, rejects repeated taps, and reports a failed start without navigating", async () => {
  let reject!: (error: Error) => void;
  session.start.mockReturnValue(new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  pressHome("Start workout");
  const first = pressHome("Start Chest / Triceps");
  const second = pressHome("Start Chest / Triceps");
  expect(session.start).toHaveBeenCalledOnce();
  expect(session.navigate).not.toHaveBeenCalled();
  reject(new Error("Connection interrupted"));
  await Promise.all([first, second]);
  expect(elements(renderHome()).find((item) => item.props.accessibilityRole === "alert")?.props.children).toBe("Connection interrupted");
  expect(session.navigate).not.toHaveBeenCalled();
  session.start.mockResolvedValue(undefined);
  await pressHome("Start Chest / Triceps");
  expect(session.navigate).toHaveBeenCalledWith("ActiveWorkout");
});

it("does not navigate an old account's start result into a changed account", async () => {
  let resolve!: () => void;
  session.start.mockReturnValue(new Promise<void>((resolvePromise) => { resolve = resolvePromise; }));
  pressHome("Start workout");
  const pending = pressHome("Start Chest / Triceps");
  session.user = { id: "account-b" }; renderHome();
  resolve(); await pending;
  expect(session.navigate).not.toHaveBeenCalled();
});

it("only releases an ambiguous start after successfully reading the saved draft", async () => {
  session.start.mockRejectedValueOnce(new Error("Lost acknowledgement"));
  pressHome("Start workout"); await pressHome("Start Chest / Triceps");
  session.reload.mockRejectedValueOnce(new Error("Still offline"));
  await pressHome("Review saved workout draft");
  expect(homeOption("Start Legs / Shoulders").props.disabled).toBe(true);
  await pressHome("Review saved workout draft");
  pressHome("Start workout");
  expect(homeOption("Start Legs / Shoulders").props.disabled).toBe(false);
  await pressHome("Start Legs / Shoulders");
  expect(session.start.mock.calls.at(-1)?.[0].templateId).toBe("legs-shoulders");
});

it("also preserves the exact lost-acknowledgement attempt in Home's direct-start flow", async () => {
  session.start.mockRejectedValueOnce(new Error("Lost acknowledgement"));
  pressHome("Start workout");
  await pressHome("Chest / Triceps");
  const attempted = session.start.mock.calls[0][0];
  expect(homeOption("Start Legs / Shoulders").props.disabled).toBe(true);
  await homeOption("Start Legs / Shoulders").props.onPress();
  expect(session.start).toHaveBeenCalledOnce();
  await pressHome("Retry Chest / Triceps");
  expect(session.start.mock.calls[1][0]).toBe(attempted);
  expect(session.navigate).toHaveBeenCalledWith("ActiveWorkout");
});
it("starts the saved schedule with its stable identity and muscles from Home", async () => {
  session.split = { days: [{ key: "mon", label: "Mon", muscles: ["Forearms"] }] };
  const renderHome = () => { hooks.cursor = 0; return HomeScreen(); };
  const pressHome = (label: string) => elements(renderHome()).find((item) => item.type === "Pressable" && elements(item.props.children).some((child) => child.props.children === label))!.props.onPress();
  await pressHome("Start workout");
  expect(session.start).toHaveBeenCalledWith(expect.objectContaining({ templateId: "legacy-weekday:mon", day: expect.objectContaining({ muscles: ["Forearms"] }) }));
  expect(session.navigate).toHaveBeenCalledWith("ActiveWorkout");
});

it("keeps another workout available as a secondary choice when today's plan starts directly", async () => {
  session.split = { days: [{ key: "mon", label: "Mon", muscles: ["Forearms"] }] };
  const renderHome = () => { hooks.cursor = 0; return HomeScreen(); };
  const home = renderHome();
  const choose = elements(home).find((item) => item.type === "Pressable" && elements(item.props.children).some((child) => child.props.children === "Choose another workout"))!;
  expect(choose).toBeDefined();
  choose.props.onPress();
  expect(elements(renderHome()).some((item) => item.type === "Modal" && item.props.visible)).toBe(true);
});
