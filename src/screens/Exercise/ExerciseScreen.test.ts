import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const state = vi.hoisted(() => ({ exercises: [] as Array<Record<string, unknown>> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = next; }];
  }
}));
vi.mock("react-native", () => ({
  useColorScheme: () => "light", TextInput: "TextInput", View: "View",
  Platform: { OS: "web", select: (values: { web: unknown }) => values.web },
  StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock("lucide-react-native", () => ({ Search: "Search" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (select: (value: object) => unknown) => select({ exercises: state.exercises }) }));

import { ExerciseScreen } from "@/screens/Exercise/ExerciseScreen";

type Element = { type: unknown; props: { [key: string]: any; children?: unknown } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render() {
  hooks.cursor = 0;
  return ExerciseScreen();
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  vi.stubGlobal("React", React);
  state.exercises = [
    { id: 1, name: "Cable Fly", primary_muscle: "Chest", secondary_muscle: "Shoulders", is_strength_exercise: 0 },
    { id: 2, name: "Goblet Squat", primary_muscle: "Legs", secondary_muscle: null, is_strength_exercise: 0 }
  ];
});
afterEach(() => vi.unstubAllGlobals());

it("browses every catalog exercise regardless of logging selection and searches by muscle", () => {
  const tree = render();
  expect(elements(tree).filter((item) => item.type === "SectionTitle").map((item) => item.props.children)).toEqual([
    "Browse all exercises", "Chest", "Cable Fly", "Legs", "Goblet Squat"
  ]);
  expect(elements(tree).filter((item) => item.type === "Pressable")).toHaveLength(0);

  const search = elements(tree).find((item) => item.type === "TextInput")!;
  expect(search.props.accessibilityLabel).toBe("Search exercises by name or muscle");
  search.props.onChangeText("legs");
  const filtered = render();
  expect(elements(filtered).filter((item) => item.type === "SectionTitle").map((item) => item.props.children)).toEqual([
    "Browse all exercises", "Legs", "Goblet Squat"
  ]);
});
