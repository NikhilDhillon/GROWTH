import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
const actions = vi.hoisted(() => ({ record: vi.fn(), remove: vi.fn() }));
const state = vi.hoisted(() => ({ current: {} as Record<string, any> }));
const draftActions = vi.hoisted(() => ({ flush: vi.fn(), clear: vi.fn(), reload: vi.fn(), ready: true, recoveryError: null as string | null }));
const routing = vi.hoisted(() => ({ params: undefined as { checkInId?: number } | undefined }));
const setParams = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useEffect: (effect: () => void) => hooks.effects.push(effect),
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
  ActivityIndicator: "ActivityIndicator", Modal: "Modal", Pressable: "Pressable", TextInput: "TextInput", View: "View",
  Platform: { OS: "web", select: (values: { web: unknown }) => values.web }, StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock("lucide-react-native", () => ({ ChevronDown: "ChevronDown", ChevronUp: "ChevronUp", Pencil: "Pencil", Trash2: "Trash2" }));
vi.mock("@/components/DatePickerField", () => ({ DatePickerField: "DatePickerField" }));
vi.mock("@/components/DetailsDisclosure", () => ({ DetailsDisclosure: "DetailsDisclosure" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/utils/date", () => ({ todayIso: () => "2026-10-09", formatShortDate: (value: string) => value }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (select: (value: object) => unknown) => select(state.current) }));
vi.mock("@react-navigation/native", () => ({ useRoute: () => ({ key: "body-entry", name: "BodyCheckIn", params: routing.params }), useNavigation: () => ({ setParams }) }));
vi.mock("@/hooks/useBodyCheckInDraft", () => ({ useBodyCheckInDraft: (_account: unknown, defaults: unknown) => {
  const [draft, setDraft] = React.useState(defaults);
  return { draft, setDraft, ready: draftActions.ready, recoveryError: draftActions.recoveryError,
    flushDraft: async (next: unknown) => { setDraft(next); await draftActions.flush(next); },
    clearDraft: async (next: unknown) => { await draftActions.clear(next); setDraft(next); },
    reloadDraft: () => draftActions.reload()
  };
} }));

import { BodyCheckInConflictError, BodyCheckInValidationError } from "@/domain/bodyCheckInRecording";
import { CaptureDraftConflictError } from "@/database/captureDrafts.shared";
import { BodyCheckInScreen } from "./BodyCheckInScreen";

type Element = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render() { hooks.cursor = 0; hooks.effects = []; const tree = BodyCheckInScreen(); hooks.effects.forEach((effect) => effect()); return tree; }
function button(tree: unknown, label: string) { return elements(tree).find((element) => element.type === "Pressable" && element.props.accessibilityLabel === label)!; }
function text(tree: unknown) { return elements(tree).filter((element) => ["Body", "Label", "SectionTitle", "Title"].includes(String(element.type))).map((element) => Array.isArray(element.props.children) ? element.props.children.join("") : element.props.children).filter((value) => typeof value === "string"); }
function textButton(tree: unknown, label: string) { return elements(tree).find((element) => element.type === "Pressable" && text(element.props.children).includes(label))!; }
function input(tree: unknown, label: string) { return elements(tree).find((element) => element.type === "TextInput" && element.props.accessibilityLabel === label)!; }
const savedRow = {
  id: 8, logged_date: "2026-06-09", weight: 175.375, measurements: { waist: 81.28, arm_flexed: { mode: "sides", left: 40.64, right: 41.91 } },
  notes: "Measured before breakfast", created_at: "2026-06-09T12:00:00.000Z", logged_at: "2026-06-09T12:00:00.000Z", updated_at: "2026-06-09T12:00:00.000Z"
};
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  routing.params = undefined;
  setParams.mockReset().mockImplementation((params: { checkInId?: number }) => { routing.params = { ...routing.params, ...params }; });
  draftActions.ready = true; draftActions.recoveryError = null;
  draftActions.flush.mockReset().mockResolvedValue(undefined);
  draftActions.clear.mockReset().mockResolvedValue(undefined);
  draftActions.reload.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("React", React);
  actions.record.mockReset().mockResolvedValue(savedRow);
  actions.remove.mockReset().mockResolvedValue(undefined);
  state.current = { currentUser: { id: "owner" }, bodyMeasurementLogs: [savedRow], bodyUnitPreferences: { weight: "kg", circumference: "in" }, recordBodyCheckIn: actions.record, deleteBodyCheckIn: actions.remove, hydrate: vi.fn() };
});
afterEach(() => vi.unstubAllGlobals());

describe("daily and periodic body recording", () => {
  it("records daily weight without copying previous tape observations", async () => {
    const tree = render();
    expect(input(tree, "Bodyweight (kg)").props.value).toBe("");
    expect(elements(tree).filter((element) => element.type === "TextInput")).toHaveLength(2);
    input(tree, "Bodyweight (kg)").props.onChangeText("80.25");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(1));
    expect(actions.record.mock.calls[0][0]).toMatchObject({ loggedDate: "2026-10-09", weight: "80.25", measurements: {}, inputUnits: { weight: "kg", circumference: "in" } });
    expect(actions.record.mock.calls[0][0]).not.toHaveProperty("id");
    await vi.waitFor(() => expect(text(render())).toContain("Check-in saved."));
  });

  it("preserves collapsed bilateral tape fields and exact edit inputs when display preferences change", async () => {
    button(render(), "Edit body check-in from 2026-06-09").props.onPress();
    let tree = render();
    const originalWeight = input(tree, "Bodyweight (kg)").props.value;
    expect(Number(originalWeight)).toBeCloseTo(175.375 / 2.2046226218, 10);
    expect(elements(tree).filter((element) => element.type === "TextInput")).toHaveLength(2);
    state.current.bodyUnitPreferences = { weight: "lb", circumference: "cm" };
    tree = render();
    expect(input(tree, "Bodyweight (kg)").props.value).toBe(originalWeight);
    button(tree, "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(1));
    expect(actions.record.mock.calls[0][0]).toMatchObject({ id: 8, expected: savedRow, weight: originalWeight, measurements: { waist: 32, arm_flexed: { mode: "sides", left: 16, right: 16.5 } }, inputUnits: { weight: "kg", circumference: "in" }, notes: savedRow.notes });
  });

  it("keeps all nine optional tape fields and permits independent left/right entry", async () => {
    button(render(), "Show optional tape measurements").props.onPress();
    let tree = render();
    for (const label of ["Arm (unflexed)", "Arm (flexed)", "Calves", "Chest", "Forearm", "Abdomen", "Thinnest waist", "Thigh", "Waist"]) expect(input(tree, `${label} (in)`)).toBeDefined();
    button(tree, "Track left and right for Arm (flexed)").props.onPress();
    tree = render();
    input(tree, "Arm (flexed) left (in)").props.onChangeText("15.25");
    input(render(), "Waist (in)").props.onChangeText("32.5");
    button(render(), "Show optional tape measurements").props.onPress();
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(1));
    expect(actions.record.mock.calls[0][0]).toMatchObject({ weight: "", measurements: { arm_flexed: { mode: "sides", left: 15.25 }, waist: 32.5 } });
  });

  it("requires deliberate selection before replacing an occupied date or unfinished form", async () => {
    let tree = render();
    input(tree, "Bodyweight (kg)").props.onChangeText("80");
    elements(render()).find((element) => element.type === "DatePickerField")!.props.onChange("2026-06-09");
    button(render(), "Save body check-in").props.onPress();
    expect(actions.record).not.toHaveBeenCalled();
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("80");
    button(render(), "Edit existing check-in from 2026-06-09").props.onPress();
    tree = render();
    expect(elements(tree).find((element) => element.type === "Modal")!.props.visible).toBe(true);
    expect(input(tree, "Bodyweight (kg)").props.value).toBe("80");
    textButton(tree, "Discard unfinished form").props.onPress();
    expect(input(render(), "Bodyweight (kg)").props.value).not.toBe("80");
  });

  it("opens today's saved weigh-in ready for tape instead of a blank form that reports the date as taken", () => {
    state.current.bodyMeasurementLogs = [{ ...savedRow, id: 9, logged_date: "2026-10-09", weight: 176, measurements: {}, notes: null }, savedRow];
    render();
    const tree = render();
    expect(Number(input(tree, "Bodyweight (kg)").props.value)).toBeCloseTo(176 / 2.2046226218, 6);
    expect(text(tree)).not.toContain("A saved check-in already uses this date.");
    expect(setParams).toHaveBeenCalledWith({ checkInId: 9 });
  });

  it("reports each tape metric's recording date independently of daily weight without a stale warning", () => {
    state.current.bodyMeasurementLogs = [{ ...savedRow, id: 9, logged_date: "2026-10-09", weight: 178, measurements: {} }, savedRow];
    textButton(render(), "See latest tape measurements").props.onPress();
    const details = text(render()).join(" ");
    expect(details).toContain("2026-10-09");
    expect(details).toContain("32 in · 2026-06-09");
    expect(details).toContain("left · 16 in · 2026-06-09");
    expect(details).toContain("right · 16.5 in · 2026-06-09");
    expect(details.toLowerCase()).not.toContain("stale");
    expect(details.toLowerCase()).not.toContain("overdue");
  });
});

describe("body recording failure safety", () => {
  it("waits for recovery and never sends a record when its attempt cannot be saved durably", async () => {
    draftActions.ready = false;
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(false);
    button(render(), "Save body check-in").props.onPress();
    expect(actions.record).not.toHaveBeenCalled();
    draftActions.ready = true;
    draftActions.flush.mockRejectedValueOnce(new Error("Storage quota reached."));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render())).toContain("Storage quota reached."));
    expect(actions.record).not.toHaveBeenCalled();
    const frozen = draftActions.flush.mock.calls[0][0].pending;
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(false);
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(1));
    expect(actions.record.mock.calls[0][0]).toEqual(frozen);
    expect(draftActions.flush.mock.invocationCallOrder[1]).toBeLessThan(actions.record.mock.invocationCallOrder[0]);
  });

  it("releases a draft conflict before any record request so the preserved form can be deliberately reconciled", async () => {
    draftActions.flush.mockRejectedValueOnce(new CaptureDraftConflictError());
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render()).join(" ")).toContain("A newer body-entry draft is saved on this device."));
    expect(actions.record).not.toHaveBeenCalled();
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(true);
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("80");
  });

  it("reports a committed check-in truthfully when recovery cleanup fails and retries only its original identity", async () => {
    draftActions.clear.mockRejectedValueOnce(new Error("Storage unavailable."));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render()).join(" ")).toContain("Check-in saved. Its recovery draft could not be cleared"));
    expect(text(render())).toContain("Check-in saved.");
    const attempted = actions.record.mock.calls[0][0];
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(false);
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(2));
    expect(actions.record.mock.calls[1][0]).toEqual(attempted);
  });

  it("does not send a previous account's draft if the account changes while its durable save is pending", async () => {
    let persist!: () => void;
    draftActions.flush.mockImplementationOnce(() => new Promise<void>((resolve) => { persist = resolve; }));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    state.current.currentUser = { id: "another-account" };
    render();
    persist();
    await vi.waitFor(() => expect(button(render(), "Save body check-in").props.disabled).toBe(false));
    expect(actions.record).not.toHaveBeenCalled();
    expect(draftActions.clear).not.toHaveBeenCalled();
  });

  it("ignores repeated taps and retries the same frozen payload after lost acknowledgement", async () => {
    let reject!: (error: Error) => void;
    actions.record.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    const tree = render();
    const control = button(tree, "Save body check-in");
    control.props.onPress(); control.props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(1));
    const attempted = actions.record.mock.calls[0][0];
    reject(new Error("Acknowledgement lost."));
    await vi.waitFor(() => expect(text(render())).toContain("Acknowledgement lost."));
    state.current.bodyUnitPreferences = { weight: "lb", circumference: "cm" };
    const pending = render();
    expect(input(pending, "Bodyweight (kg)").props.editable).toBe(false);
    input(pending, "Bodyweight (kg)").props.onChangeText("100");
    expect(button(pending, "Delete whole body check-in from 2026-06-09").props.disabled).toBe(true);
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(actions.record).toHaveBeenCalledTimes(2));
    expect(actions.record.mock.calls[1][0]).toEqual(attempted);
  });

  it("releases a definitively rejected new attempt for correction, while preserving entered values", async () => {
    actions.record.mockRejectedValueOnce(new BodyCheckInConflictError("Another check-in was saved on that date."));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render())).toContain("Another check-in was saved on that date."));
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(true);
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("80");
  });

  it("keeps an ambiguous reused attempt frozen even if retry later fails validation", async () => {
    actions.record.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render())).toContain("Acknowledgement lost."));
    actions.record.mockRejectedValueOnce(new BodyCheckInValidationError("Retry could not be validated."));
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render())).toContain("Retry could not be validated."));
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(false);
    expect(actions.record.mock.calls[1][0]).toEqual(actions.record.mock.calls[0][0]);
  });
  it("releases a definitively rejected pending retry so preserved values can be reviewed", async () => {
    actions.record.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render())).toContain("Acknowledgement lost."));
    actions.record.mockRejectedValueOnce(new BodyCheckInConflictError("This body check-in was deleted. An old retry cannot recreate it."));
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(input(render(), "Bodyweight (kg)").props.editable).toBe(true));
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("80");
    expect(actions.record.mock.calls[1][0]).toEqual(actions.record.mock.calls[0][0]);
  });

  it("does not delete across an account switch during confirmation", async () => {
    vi.stubGlobal("window", { confirm: () => { state.current.currentUser = { id: "another" }; render(); return true; } });
    button(render(), "Delete whole body check-in from 2026-06-09").props.onPress();
    await vi.waitFor(() => expect(button(render(), "Delete whole body check-in from 2026-06-09").props.disabled).toBe(false));
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it("does not remove observations after cancellation and preserves unfinished edits after deletion fails", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    button(render(), "Delete whole body check-in from 2026-06-09").props.onPress();
    await vi.waitFor(() => expect(button(render(), "Delete whole body check-in from 2026-06-09").props.disabled).toBe(false));
    expect(actions.remove).not.toHaveBeenCalled();
    button(render(), "Edit body check-in from 2026-06-09").props.onPress();
    input(render(), "Bodyweight (kg)").props.onChangeText("81");
    confirm.mockReturnValue(true);
    actions.remove.mockRejectedValueOnce(new Error("Offline. Please retry."));
    button(render(), "Delete whole body check-in from 2026-06-09").props.onPress();
    await vi.waitFor(() => expect(text(render())).toContain("Offline. Please retry."));
    expect(actions.remove).toHaveBeenCalledWith(8, savedRow);
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("81");
    expect(state.current.bodyMeasurementLogs).toEqual([savedRow]);
  });

  it("distinguishes a successful deletion from failed recovery-form cleanup", async () => {
    vi.stubGlobal("window", { confirm: () => true });
    button(render(), "Edit body check-in from 2026-06-09").props.onPress();
    draftActions.clear.mockRejectedValueOnce(new Error("Storage unavailable."));
    button(render(), "Delete whole body check-in from 2026-06-09").props.onPress();
    await vi.waitFor(() => expect(text(render()).join(" ")).toContain("Check-in deleted. Its unfinished form could not be cleared"));
    expect(actions.remove).toHaveBeenCalledTimes(1);
    expect(text(render()).join(" ")).not.toContain("Could not delete");
  });
});

describe("body edit route intent", () => {
  it("clears a successfully deleted edit route so another check-in can be recorded", async () => {
    routing.params = { checkInId: 8 }; render(); render();
    vi.stubGlobal("window", { confirm: () => true });
    actions.remove.mockImplementationOnce(async () => { state.current.bodyMeasurementLogs = []; });
    button(render(), "Delete whole body check-in from 2026-06-09").props.onPress();
    await vi.waitFor(() => expect(setParams).toHaveBeenCalledWith({ checkInId: undefined }));
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(true);
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("");
  });

  it("allows deliberate draft replacement when deletion succeeded but cleanup failed", async () => {
    routing.params = { checkInId: 8 }; render(); render();
    vi.stubGlobal("window", { confirm: () => true });
    actions.remove.mockImplementationOnce(async () => { state.current.bodyMeasurementLogs = []; });
    draftActions.clear.mockRejectedValueOnce(new Error("Storage unavailable"));
    button(render(), "Delete whole body check-in from 2026-06-09").props.onPress();
    await vi.waitFor(() => expect(text(render()).join(" ")).toContain("Check-in deleted."));
    expect(setParams).not.toHaveBeenCalled();
    textButton(render(), "New check-in").props.onPress();
    textButton(render(), "Discard unfinished form").props.onPress();
    expect(routing.params?.checkInId).toBeUndefined();
    expect(input(render(), "Bodyweight (kg)").props.editable).toBe(true);
    expect(actions.remove).toHaveBeenCalledTimes(1);
  });
  it("clears edit-route intent only after the recorded edit and recovery cleanup both succeed", async () => {
    routing.params = { checkInId: 8 };
    render(); render();
    draftActions.clear.mockRejectedValueOnce(new Error("Storage unavailable."));
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(text(render()).join(" ")).toContain("Check-in saved. Its recovery draft could not be cleared"));
    expect(setParams).not.toHaveBeenCalled();
    expect(routing.params?.checkInId).toBe(8);
    button(render(), "Save body check-in").props.onPress();
    await vi.waitFor(() => expect(setParams).toHaveBeenCalledWith({ checkInId: undefined }));
    expect(routing.params?.checkInId).toBeUndefined();
    expect(actions.record.mock.calls[1][0]).toEqual(actions.record.mock.calls[0][0]);
  });

  it("clears edit-route intent when the user explicitly discards it to start a new check-in", () => {
    routing.params = { checkInId: 8 };
    render(); render();
    textButton(render(), "New check-in").props.onPress();
    expect(setParams).not.toHaveBeenCalled();
    textButton(render(), "Discard unfinished form").props.onPress();
    expect(setParams).toHaveBeenCalledWith({ checkInId: undefined });
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("");
  });

  it("opens a saved ID only after draft recovery is ready", () => {
    routing.params = { checkInId: 8 };
    draftActions.ready = false;
    render();
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("");
    draftActions.ready = true;
    render();
    expect(Number(input(render(), "Bodyweight (kg)").props.value)).toBeCloseTo(175.375 / 2.2046226218, 10);
  });
  it("keeps an unfinished recovered form until the user deliberately accepts the edit route", () => {
    input(render(), "Bodyweight (kg)").props.onChangeText("80");
    routing.params = { checkInId: 8 };
    render();
    const tree = render();
    expect(input(tree, "Bodyweight (kg)").props.value).toBe("80");
    expect(elements(tree).find((element) => element.type === "Modal")!.props.visible).toBe(true);
    textButton(tree, "Keep current form").props.onPress();
    expect(input(render(), "Bodyweight (kg)").props.value).toBe("80");
  });
  it("shows an unavailable edit intent without treating it as a new observation", () => {
    routing.params = { checkInId: 999 };
    const tree = render();
    expect(text(tree).join(" ")).toContain("This saved check-in is unavailable.");
    expect(button(tree, "Save body check-in").props.disabled).toBe(true);
    expect(input(tree, "Bodyweight (kg)").props.editable).toBe(false);
    button(tree, "Save body check-in").props.onPress();
    expect(actions.record).not.toHaveBeenCalled();
  });
});
