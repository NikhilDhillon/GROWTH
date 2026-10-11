import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const shell = vi.hoisted(() => ({
  user: { id: "test-account", name: "Test", email: "test@example.test" } as { id: string; name: string; email: string } | null,
  currentRoute: "BodyCheckIn", dispatch: vi.fn(), dataError: null as string | null
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(), useEffect: () => undefined,
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }];
  }
}));
vi.mock("react-native-gesture-handler", () => ({}));
vi.mock("@vercel/analytics/react", () => ({ Analytics: "Analytics" }));
vi.mock("@react-navigation/native", () => ({ DefaultTheme: { colors: {} }, NavigationContainer: "NavigationContainer", CommonActions: { navigate: (payload: unknown) => ({ type: "NAVIGATE", payload }) }, createNavigationContainerRef: () => ({ isReady: () => true, getCurrentRoute: () => ({ name: shell.currentRoute }), dispatch: shell.dispatch }) }));
vi.mock("@react-navigation/native-stack", () => ({ createNativeStackNavigator: () => ({ Navigator: "Navigator", Screen: "StackScreen" }) }));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("react-native", () => ({ useColorScheme: () => "light", ActivityIndicator: "ActivityIndicator", Modal: "Modal", Platform: { OS: "web", select: (values: { web: unknown }) => values.web }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ width: 390 }) }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" }));
vi.mock("lucide-react-native", () => Object.fromEntries(["ArrowLeft", "BarChart3", "Dumbbell", "Home", "LineChart", "ListChecks", "Menu", "Plus", "Scale", "Settings", "Users", "X"].map((key) => [key, key])));
vi.mock("@/components/LogoMark", () => ({ LogoMark: "LogoMark" }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (select: (state: object) => unknown) => select({ currentUser: shell.user, loading: false, dataError: shell.dataError }) }));
type Element = { type: any; props: any };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; shell.user = { id: "test-account", name: "Test", email: "test@example.test" }; shell.dataError = null; shell.dispatch.mockClear(); vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

async function loadApp() {
  // Only the shell is under test; feature screens keep their own interaction tests.
  for (const [folder, name] of [
    ["Home", "HomeScreen"], ["Record", "RecordScreen"], ["Workout", "WorkoutScreen"], ["Exercise", "ExerciseScreen"], ["Bodyweight", "BodyweightScreen"],
    ["BodyCheckIn", "BodyCheckInScreen"], ["Progress", "ProgressScreen"], ["Settings", "SettingsScreen"],
    ["Settings", "GuidedWorkoutSettingsScreen"], ["Auth", "AuthScreen"], ["Logs", "LogsScreen"], ["Social", "SocialScreen"],
    ["Workout", "GuidedWorkoutScreen"], ["Workout", "WorkoutSummaryScreen"]
  ]) vi.doMock(`@/screens/${folder}/${name}`, () => ({ [name]: name }));
  return (await import("../../App")).default;
}

it("opens supporting tools from More without duplicating Progress or Settings destinations", async () => {
  const App = await loadApp();
  let tree = App();
  const container = elements(tree).find((item) => item.type === "NavigationContainer")!;
  container.props.onReady();
  hooks.cursor = 0; tree = App();
  expect(elements(tree).some((item) => item.type === "StackScreen" && item.props.name === "BodyCheckIn")).toBe(true);
  const mobile = elements(tree).find((item) => typeof item.type === "function" && item.type.name === "MobileNavigation")!;
  const rendered = mobile.type(mobile.props);
  expect(elements(rendered).filter((item) => item.type === "Pressable").map((item) => item.props.accessibilityLabel)).toEqual(["Home", "Record", "Progress", "History", "More"]);
  elements(rendered).find((item) => item.props.accessibilityLabel === "More")!.props.onPress();
  hooks.cursor = 0; tree = App();
  const menu = elements(tree).find((item) => typeof item.type === "function" && item.type.name === "MoreMenu")!;
  expect(menu.props.visible).toBe(true);
  const destinations = elements(menu.type(menu.props)).filter((item) => item.props.destination);
  expect(destinations.map((item) => item.props.destination.name)).toEqual(["Exercises", "Social", "Settings"]);
  const exercises = destinations.find((item) => item.props.destination.name === "Exercises")!;
  const button = exercises.type(exercises.props);
  button.props.onPress();
  expect(shell.dispatch).toHaveBeenCalledWith({ type: "NAVIGATE", payload: { name: "Exercises", params: undefined } });
});

it("shows the auxiliary screen title without a top back button", async () => {
  const App = await loadApp();
  const stack = elements(App()).find((item) => item.type === "Navigator")!;
  const goBack = vi.fn();
  const header = stack.props.screenOptions({ navigation: { canGoBack: () => true, goBack }, route: { name: "BodyCheckIn" } }).header();
  const rendered = header.type(header.props);
  expect(elements(rendered).some((item) => item.props.accessibilityLabel === "Go back")).toBe(false);
  expect(goBack).not.toHaveBeenCalled();
  expect(elements(rendered).some((item) => item.type === "Text" && item.props.children === "Body check-in")).toBe(true);
});

it("enables account-specific linking after authentication and preserves data-load error notices", async () => {
  const App = await loadApp();
  shell.user = null;
  let container = elements(App()).find((item) => item.type === "NavigationContainer")!;
  expect(container.props.linking.enabled).toBe(false);
  shell.user = { id: "test-account", name: "Test", email: "test@example.test" }; shell.dataError = "offline";
  hooks.cursor = 0;
  const tree = App();
  container = elements(tree).find((item) => item.type === "NavigationContainer")!;
  expect(container.props.linking.enabled).toBe(true);
  expect(elements(tree).some((item) => item.props.accessibilityRole === "alert" && item.props.children.includes("saved records are preserved"))).toBe(true);
  expect(elements(tree).some((item) => item.type === "Navigator")).toBe(true);
});
