import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
const state = vi.hoisted(() => ({ params: {} as Record<string, unknown>, selected: { tab: "strength" }, body: { view: "weight" }, setParams: vi.fn() }));
vi.mock("react-native", () => ({ useColorScheme: () => "light", Pressable: "Pressable", View: "View", Platform: { select: (v: { web: unknown }) => v.web }, StyleSheet: { create: (v: unknown) => v } }));
vi.mock("@react-navigation/native", () => ({ useRoute: () => ({ params: state.params }), useNavigation: () => ({ setParams: state.setParams }) }));
vi.mock("@/hooks/useReportContext", () => ({ useReportContext: (_account: unknown, key: string) => key === "progress" ? { value: state.selected, update: (next: typeof state.selected) => { state.selected = next; } } : { value: state.body, update: (next: typeof state.body) => { state.body = next; } } }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (select: (s: object) => unknown) => select({ currentUser: { id: "test" } }) }));
vi.mock("@/components/Text", () => ({ Body: "Body" }));
vi.mock("@/components/ProgressTabs", () => ({ ProgressTabs: "ProgressTabs" }));
vi.mock("@/screens/Analytics/AnalyticsScreen", () => ({ AnalyticsScreen: "AnalyticsScreen" }));
vi.mock("@/screens/BulkAnalytics/BulkAnalyticsScreen", () => ({ BulkAnalyticsScreen: "BulkAnalyticsScreen" }));
vi.mock("@/screens/Bodyweight/BodyweightScreen", () => ({ BodyweightScreen: "BodyweightScreen" }));
vi.mock("@/screens/BodyMeasurements/BodyMeasurementsScreen", () => ({ BodyMeasurementsScreen: "BodyMeasurementsScreen" }));
import { ProgressScreen } from "./ProgressScreen";
import { BodyProgressScreen } from "./BodyProgressScreen";
type Element = { type: any; props: any };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
beforeEach(() => { state.params = {}; state.selected = { tab: "strength" }; state.body = { view: "weight" }; state.setParams.mockClear(); vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());
it("opens strength for legacy overview selections and keeps comparison contextual", () => {
  state.params = { tab: "overview", exerciseId: 7, comparisonKey: "machine:3" };
  const screen = ProgressScreen();
  expect(screen.type).toBe("AnalyticsScreen");
  expect(screen.props.initialExerciseId).toBe(7);
  expect(screen.props.initialComparisonKey).toBe("machine:3");
  screen.props.onCompare({ exerciseId: 7, comparisonKey: "machine:3" });
  expect(state.setParams).toHaveBeenCalledWith({ tab: "bulk", scopeKind: "exercise", exerciseId: 7, comparisonKey: "machine:3" });
});
it("keeps both body histories reachable from the same Body destination", () => {
  state.params = { tab: "body" };
  expect(ProgressScreen().type).toBe(BodyProgressScreen);
  let screen = BodyProgressScreen();
  expect(screen.type).toBe("BodyweightScreen");
  const tape = elements(screen.props.progressTabs).find((item) => item.type === "Pressable" && item.props.children.props.children === "Tape measurements")!;
  tape.props.onPress();
  screen = BodyProgressScreen();
  expect(screen.type).toBe("BodyMeasurementsScreen");
  const weight = elements(screen.props.progressTabs).find((item) => item.type === "Pressable" && item.props.children.props.children === "Bodyweight")!;
  weight.props.onPress();
  expect(BodyProgressScreen().type).toBe("BodyweightScreen");
});
