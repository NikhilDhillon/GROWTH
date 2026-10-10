import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useMemo: (factory: () => unknown) => factory(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(hooks.slots[index]) : next; }];
  }
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: (styles: unknown) => styles },
  TextInput: "TextInput", useWindowDimensions: () => ({ width: 390 }), View: "View"
}));
vi.mock("lucide-react-native", () => ({ Check: "Check", Copy: "Copy", Minus: "Minus", Plus: "Plus", RotateCcw: "RotateCcw", Trash2: "Trash2" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label" }));
vi.mock("@/utils/themedStyles", () => ({ createThemedStyles: (factory: (palette: object) => unknown) => () => ({ palette: {}, styles: factory({}) }) }));
vi.mock("@/utils/theme", () => ({ spacing: { xs: 2, sm: 4, md: 8, lg: 12 } }));
vi.mock("@/utils/touch", () => ({ fastTouchStyle: {}, pressableFeedback: (style: unknown) => style, touchHitSlop: {} }));
vi.mock("@/utils/units", () => ({ formatWeightInput: (weight: number) => String(weight), weightToStorageUnit: (weight: number) => weight }));
vi.mock("@/utils/workout", () => ({ createEmptyPlateCounts: () => ({ 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 }) }));
vi.mock("@/services/guidedWorkout/guidedObservationService", () => ({
  canConfirmGuidedObservation: (set: { weight: string; reps: string }) => Boolean(set.weight.trim() && set.reps.trim()),
  confirmGuidedObservation: (set: object) => ({ ...set, observationConfirmation: { confirmed: true } }),
  isGuidedObservationConfirmed: (set: { observationConfirmation?: unknown }) => Boolean(set.observationConfirmation)
}));

import { VisualSetComposer } from "./VisualSetComposer";

type Element = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  const children = typeof element.type === "function"
    ? (element.type as (props: Record<string, unknown>) => unknown)(element.props)
    : element.props.children;
  return [element, ...elements(children)];
}
function render(props: Parameters<typeof VisualSetComposer>[0]) {
  hooks.cursor = 0;
  hooks.effects = [];
  const tree = VisualSetComposer(props);
  hooks.effects.forEach((effect) => effect());
  return tree;
}
function button(tree: unknown, label: string) {
  return elements(tree).find((item) => item.type === "Pressable" && item.props.accessibilityLabel === label)!;
}
function text(tree: unknown): string[] {
  return elements(tree).filter((item) => item.type === "Body" || item.type === "Label")
    .flatMap((item) => Array.isArray(item.props.children) ? item.props.children : [item.props.children])
    .filter((value) => typeof value === "string");
}
function props(overrides: Partial<Parameters<typeof VisualSetComposer>[0]> = {}) {
  return {
    sets: [{ reps: "5", weight: "135", isWarmup: false }],
    loadType: "external" as const,
    unitSystem: "lb" as const,
    supportsBarbell: true,
    barWeight: "45",
    plateCounts: { 45: 1, 35: 0, 25: 0, 10: 0, 5: 0 },
    onBarbellApply: vi.fn(),
    onBarWeightChange: vi.fn(),
    onPlateCountsChange: vi.fn(),
    onSetsChange: vi.fn(),
    ...overrides
  };
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.stubGlobal("React", React);
});

describe("VisualSetComposer load entry", () => {
  it("keeps barbell weight directly editable and makes plate loading optional", () => {
    const inputProps = props();
    const first = render(inputProps);
    const weight = elements(first).find((item) => item.type === "TextInput" && item.props.accessibilityLabel === "Weight for set 1")!;
    expect(weight.props.value).toBe("135");
    expect(weight.props.editable).toBe(true);
    weight.props.onChangeText("140");
    expect(inputProps.onSetsChange).toHaveBeenCalledWith([expect.objectContaining({ weight: "140" })]);

    button(first, "Open plate calculator for set 1").props.onPress();
    expect(hooks.slots[0]).toBe(0);
    render(inputProps);
    const opened = render(inputProps);
    expect(text(opened)).toContain("Plate calculator");
    expect(elements(opened).find((item) => item.type === "TextInput" && item.props.accessibilityLabel === "Target total load in pounds")?.props.value).toBe("135");

    elements(opened).find((item) => item.type === "Pressable" && text(item).includes("Apply to set"))!.props.onPress();
    expect(inputProps.onBarbellApply).toHaveBeenCalledWith(expect.objectContaining({ sets: [expect.objectContaining({ weight: "135" })] }));
  });

  it("shows target loads as suggestions without a per-set confirmation step", () => {
    const tree = render(props({
      sets: [{ reps: "5", weight: "", isWarmup: false }],
      targets: [{ draftIndex: 0, weight: 120, targetReps: 5 }],
      observationContext: { workoutId: "workout-1" } as never
    }));
    const weight = elements(tree).find((item) => item.type === "TextInput" && item.props.accessibilityLabel === "Weight for set 1")!;
    expect(weight.props.value).toBe("");
    expect(weight.props.placeholder).toBe("120");
    expect(text(tree).join("")).toContain("Suggested 120");
    expect(button(tree, "Set 1 performed")).toBeUndefined();
  });

  it("applies a plate target from the chosen set down without changing warm-up loads", () => {
    const inputProps = props({ sets: [
      { reps: "5", weight: "135", isWarmup: false },
      { reps: "5", weight: "40", isWarmup: true },
      { reps: "5", weight: "95", isWarmup: false }
    ] });
    const first = render(inputProps);
    button(first, "Open plate calculator for set 1").props.onPress();
    render(inputProps);
    const opened = render(inputProps);
    elements(opened).find((item) => item.type === "Pressable" && text(item).includes("This and later sets"))!.props.onPress();
    expect(inputProps.onBarbellApply).toHaveBeenCalledWith(expect.objectContaining({ sets: [
      expect.objectContaining({ weight: "135" }),
      expect.objectContaining({ weight: "40", isWarmup: true }),
      expect.objectContaining({ weight: "135" })
    ] }));
  });

  it("keeps the direct weight field available for non-barbell loads and read-only-safe", () => {
    const fieldProps = props({ supportsBarbell: false, readOnlyValues: true });
    const tree = render(fieldProps);
    const weight = elements(tree).find((item) => item.type === "TextInput" && item.props.accessibilityLabel === "Weight for set 1")!;
    expect(weight.props.value).toBe("135");
    expect(weight.props.editable).toBe(false);
    expect(elements(tree).some((item) => item.props.accessibilityLabel === "Open plate calculator for set 1")).toBe(false);
  });
});
