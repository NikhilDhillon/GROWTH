import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, effectCursor: 0, dependencies: [] as Array<readonly unknown[] | undefined> }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void, dependencies?: readonly unknown[]) => {
    const index = hooks.effectCursor++;
    const previous = hooks.dependencies[index];
    if (!dependencies || !previous || dependencies.some((value, offset) => !Object.is(value, previous[offset]))) hooks.effects.push(effect);
    hooks.dependencies[index] = dependencies;
  },
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
vi.mock("react-native", () => ({ useColorScheme: () => "light", Platform: { OS: "ios" }, Pressable: "Pressable", View: "View", StyleSheet: { create: (styles: unknown) => styles },
  PanResponder: { create: (pan: unknown) => ({ panHandlers: { pan } }) } }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Defs: "Defs", Line: "Line", LinearGradient: "LinearGradient", Path: "Path", Stop: "Stop", Text: "SvgText" }));
vi.mock("@/components/Text", () => ({ Body: "Body" }));
vi.mock("@/utils/touch", () => ({ pressableFeedback: (styles: unknown) => styles }));

import { lightPalette } from "@/utils/theme";
import { buildSmoothPath, LineGraph } from "./LineGraph";

type Props = Parameters<typeof LineGraph>[0];
type Element = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(props: Props) {
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.effectCursor = 0;
  const tree = LineGraph(props);
  hooks.effects.forEach((effect) => effect());
  return tree;
}
function targets(tree: unknown) { return elements(tree).filter((element) => element.type === "Pressable" && element.props.accessibilityHint === "Show the full recorded date, value and details"); }
function button(tree: unknown, label: string) { return elements(tree).find((element) => element.type === "Pressable" && element.props.accessibilityLabel === label)!; }
function text(tree: unknown) {
  return elements(tree).filter((element) => element.type === "Body").map((element) => Array.isArray(element.props.children) ? element.props.children.filter((part: unknown) => typeof part === "string").join("") : element.props.children).filter((value) => typeof value === "string");
}
function series(count: number, value = (index: number) => index + 100) {
  return Array.from({ length: count }, (_, index) => ({ key: `entry:${index}`, date: `2026-10-${String(index + 1).padStart(2, "0")}`, label: `Oct ${index + 1}`, value: value(index) }));
}

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.effectCursor = 0; hooks.dependencies = [];
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

describe("mobile chart inspection", () => {
  it("keeps the selected date, units and complete details readable after a tap", () => {
    const detail = "Set 1: 225 lb × 8 reps, performed on the recorded machine with a complete description";
    const props = { points: [{ key: "entry:42", date: "2026-10-09", label: "Oct 9", value: 225, details: [detail] }], suffix: " lb" };
    const target = targets(render(props))[0];
    expect(target.props.accessibilityLabel).toContain("2026-10-09");
    expect(target.props.accessibilityLabel).toContain("225.0 lb");
    target.props.onPress();
    const selected = render(props);
    expect(text(selected)).toContain("2026-10-09 · Oct 9");
    expect(text(selected)).toContain("225.0 lb");
    expect(text(selected)).toContain(detail);
    expect(targets(selected)[0].props.accessibilityState.selected).toBe(true);
    button(selected, "Close chart point details").props.onPress();
    expect(text(render(props))).not.toContain(detail);
  });

  it("follows an observation identity when the filtered series changes instead of selecting the old index", () => {
    const first = { key: "entry:1", date: "2026-10-01", label: "Oct 1", value: 100 };
    const selected = { key: "entry:2", date: "2026-10-02", label: "Oct 2", value: 110 };
    targets(render({ points: [first, selected] }))[1].props.onPress();
    const changed = render({ points: [{ ...selected, value: 120 }, first] });
    expect(text(changed)).toContain("120.0");
    expect(text(changed)).toContain("2026-10-02 · Oct 2");
    expect(targets(changed).map((target) => target.props.accessibilityState.selected)).toEqual([true, false]);
    const removed = render({ points: [first] });
    expect(text(removed)).not.toContain("2026-10-02 · Oct 2");
    expect(targets(render({ points: [first, selected] })).every((target) => !target.props.accessibilityState.selected)).toBe(true);
  });

  it("discloses an explicitly limited series and lets the user inspect every point", () => {
    const points = series(12);
    const limited = render({ points, maxPoints: 8 });
    expect(targets(limited)).toHaveLength(8);
    expect(text(limited).join(" ")).toContain("Showing latest 8 of 12 points.");
    button(limited, "Show all 12 chart points").props.onPress();
    expect(targets(render({ points, maxPoints: 8 }))).toHaveLength(12);
    expect(targets(render({ points }))).toHaveLength(12);
  });

  it("headlines the change from the first visible point and tints a falling trend", () => {
    const rising = render({ points: series(3, (index) => 100 + index * 10), suffix: " lb" });
    expect(text(rising)).toContain("120.0 lb");
    expect(text(rising).join(" ")).toContain("▲ +20.0 lb (+20.0%)");
    const falling = render({ points: series(3, (index) => 120 - index * 10), suffix: " lb" });
    expect(text(falling).join(" ")).toContain("▼ −20.0 lb (−16.7%)");
    const line = elements(falling).find((element) => element.type === "Path" && element.props.fill === "none")!;
    expect(line.props.stroke).toBe(lightPalette.danger);
    const neutral = render({ points: series(3, (index) => 120 - index * 10), tone: "neutral" });
    expect(elements(neutral).find((element) => element.type === "Path" && element.props.fill === "none")!.props.stroke).toBe(lightPalette.blue);
  });

  it("scrubs to the nearest point while dragging across the chart", () => {
    const props = { points: series(5) };
    const tree = render(props);
    const pan = elements(tree).find((element) => element.type === "View" && element.props.pan)!.props.pan;
    // A horizontal drag takes over from the page; a vertical one is left to scroll it.
    expect(pan.onMoveShouldSetPanResponderCapture({}, { dx: 20, dy: 4 })).toBe(true);
    expect(pan.onMoveShouldSetPanResponderCapture({}, { dx: 4, dy: 20 })).toBe(false);
    expect(pan.onPanResponderTerminationRequest()).toBe(false);
    const third = elements(tree).filter((element) => element.type === "Circle" && element.props.r === 2.5)[2];
    // The finger's screen position counts, not locationX, which a point's tap target measures from its own corner.
    pan.onPanResponderMove({ nativeEvent: { pageX: third.props.cx + 3, locationX: 5 } });
    const scrubbed = render(props);
    expect(text(scrubbed)).toContain("102.0");
    expect(text(scrubbed)).toContain("2026-10-03 · Oct 3");
  });

  it("keeps point targets at least 44 pixels on a narrow responsive chart", () => {
    const props = { points: [{ key: "entry:1", date: "2026-10-01", label: "Oct 1", value: 100 }] };
    const tree = render(props) as Element;
    tree.props.onLayout({ nativeEvent: { layout: { width: 280 } } });
    const resized = render(props);
    const target = targets(resized)[0];
    expect(target.props.style[0].width).toBeGreaterThanOrEqual(44);
    expect(target.props.style[0].height).toBeGreaterThanOrEqual(44);
    const marker = elements(resized).filter((element) => element.type === "Circle").at(-1)!;
    expect(target.props.style[1].left).toBeCloseTo(marker.props.cx - 22);
    expect(target.props.accessible).toBe(true);
  });

  it("keeps ordinal points inside the chart when a shared domain has missing observations", () => {
    const tree = render({ points: [{ label: "First", key: "a", value: 1 }, { label: "Last", key: "d", value: 2 }], xLabels: ["a", "b", "c", "d"] });
    expect(targets(tree).map((point) => point.props.style[1].left + 22)).toEqual([6, 294]);
  });
});

it("smooths the line without overshooting recorded values", () => {
  const path = buildSmoothPath([{ x: 0, y: 100 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 0 }]);
  const numbers = path.replace(/[MC]/g, " ").trim().split(/\s+/).map(Number);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(path.startsWith("M 0 100")).toBe(true);
});
