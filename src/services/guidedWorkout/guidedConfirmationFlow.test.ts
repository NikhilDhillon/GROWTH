import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

// Invoke the actual public input/action handlers in Node; this is not a layout renderer.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useEffect: (effect: () => void) => hooks.effects.push(effect),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
    }];
  }
}));
vi.mock("react-native", () => ({ useColorScheme: () => "light",
  Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput", View: "View",
  Platform: { OS: "web", select: (values: { web: unknown }) => values.web },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, height: 844 })
}));
vi.mock("lucide-react-native", () => ({ Check: "Check", Copy: "Copy", Minus: "Minus", Plus: "Plus", RotateCcw: "RotateCcw", Trash2: "Trash2" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label" }));

import { VisualSetComposer } from "@/components/VisualSetComposer";
import { assertGuidedObservationsConfirmed, GuidedObservationContext } from "@/services/guidedWorkout/guidedObservationService";
import { LoggedSetDraft } from "@/types";
import { createEmptyPlateCounts } from "@/utils/workout";

type Element = { type: unknown; props: { [key: string]: any; children?: unknown } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function control(tree: unknown, label: string) {
  return elements(tree).find((item) => item.props.accessibilityLabel === label)!;
}
function buttonWithText(tree: unknown, text: string) {
  return elements(tree).find((item) => item.type === "Pressable" && elements(item.props.children).some((child) => child.props.children === text))!;
}
const context: GuidedObservationContext = { exerciseId: 1, workoutDate: "2026-10-04", unitSystem: "lb" };

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

describe("guided recording confirmation controls", () => {
  it("keeps pending values read-only and asks for no per-set confirmation", () => {
    let draft: LoggedSetDraft[] = [{ reps: "8", weight: "100" }];
    const changed = vi.fn((sets: LoggedSetDraft[]) => { draft = sets; });
    hooks.cursor = 0;
    const tree = VisualSetComposer({
      sets: draft, loadType: "external", unitSystem: "lb", supportsBarbell: false,
      barWeight: "45", plateCounts: createEmptyPlateCounts(), observationContext: context, readOnlyValues: true,
      onBarWeightChange: vi.fn(), onPlateCountsChange: vi.fn(), onSetsChange: changed
    });
    expect(control(tree, "Weight for set 1").props.editable).toBe(false);
    control(tree, "Weight for set 1").props.onChangeText("110");
    expect(changed).not.toHaveBeenCalled();
    expect(control(tree, "Set 1 performed")).toBeUndefined();
    expect(draft[0].weight).toBe("100");
  });

  it("shows targets as placeholders, never as entered values", () => {
    let draft: LoggedSetDraft[] = [{ reps: "", weight: "100" }];
    const changed = vi.fn((sets: LoggedSetDraft[]) => { draft = sets; });
    function render() {
      hooks.cursor = 0;
      hooks.effects = [];
      const tree = VisualSetComposer({
        sets: draft, loadType: "external", unitSystem: "lb", supportsBarbell: false,
        barWeight: "45", plateCounts: createEmptyPlateCounts(),
        targets: [{ draftIndex: 0, weight: 100, targetReps: 8 }], observationContext: context,
        onBarWeightChange: vi.fn(), onPlateCountsChange: vi.fn(), onSetsChange: changed
      });
      hooks.effects.forEach((effect) => effect());
      return tree;
    }

    const initial = render();
    expect(control(initial, "Reps for set 1").props.placeholder).toBe("8");
    expect(control(initial, "Reps for set 1").props.value).toBe("");
    expect(changed).not.toHaveBeenCalled();
    control(initial, "Reps for set 1").props.onChangeText("8");
    expect(draft[0]).toMatchObject({ reps: "8", weight: "100" });
    expect(draft[0].observationConfirmation).toBeUndefined();
    expect(() => assertGuidedObservationsConfirmed(draft, context)).toThrow(/performed/);
  });

  it("applies a guided barbell edit as one coherent draft change", () => {
    const atomicChange = vi.fn();
    const barChange = vi.fn();
    const platesChange = vi.fn();
    const setsChange = vi.fn();
    function render() {
      hooks.cursor = 0;
      hooks.effects = [];
      const tree = VisualSetComposer({
        sets: [{ reps: "8", weight: "100" }], loadType: "external", unitSystem: "lb", supportsBarbell: true,
        barWeight: "45", plateCounts: createEmptyPlateCounts(), observationContext: context,
        onBarbellApply: atomicChange, onBarWeightChange: barChange, onPlateCountsChange: platesChange, onSetsChange: setsChange
      });
      hooks.effects.forEach((effect) => effect());
      return tree;
    }
    control(render(), "Open plate calculator for set 1").props.onPress();
    render(); // Load-editor effect seeds the editable values.
    const editor = elements(render()).find((element) => typeof element.type === "function" && element.props.onBarWeight)!;
    editor.props.onBarWeight("35");
    buttonWithText(render(), "Apply to set").props.onPress();

    expect(atomicChange).toHaveBeenCalledTimes(1);
    expect(atomicChange.mock.calls[0][0]).toMatchObject({ barWeight: "35", sets: [{ reps: "8", weight: "100" }] });
    expect(atomicChange.mock.calls[0][0].plateCounts).toBeDefined();
    expect(barChange).not.toHaveBeenCalled();
    expect(platesChange).not.toHaveBeenCalled();
    expect(setsChange).not.toHaveBeenCalled();
  });
});
