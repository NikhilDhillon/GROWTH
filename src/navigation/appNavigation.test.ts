import { describe, expect, it } from "vitest";
import { CommonActions, StackRouter } from "@react-navigation/routers";
import { navigationSection, normalizeNavigationPath, parseNavigationPath, serializeNavigationState } from "./appNavigation";

const focused = (path: string) => parseNavigationPath(path)?.routes.at(-1);

describe("shareable navigation", () => {
  it.each([
    ["/Log", "Log"], ["/workout", "Log"], ["/ActiveWorkout", "ActiveWorkout"],
    ["/BodyCheckIn?checkInId=7", "BodyCheckIn"], ["/Logs", "Logs"],
    ["/GuidedWorkoutSettings", "GuidedWorkoutSettings"]
  ])("keeps the existing %s destination", (path, name) => expect(focused(path)?.name).toBe(name));

  it.each([["/Analytics", "strength"], ["/BodyMeasurements", "body"], ["/BulkAnalytics", "bulk"]])("keeps specialist report %s", (path, tab) => {
    expect(focused(path)).toMatchObject({ name: "Progress", params: { tab } });
  });

  it("round-trips report context including explicit equipment comparison", () => {
    const path = "/progress?tab=strength&exerciseId=14&range=90d&comparisonKey=machine%3Apulldown%2Fgym%20A";
    const state = parseNavigationPath(path)!;
    expect(state.routes.at(-1)?.params).toEqual({ tab: "strength", exerciseId: 14, range: "90d", comparisonKey: "machine:pulldown/gym A" });
    expect(parseNavigationPath(serializeNavigationState(state))?.routes.at(-1)?.params).toEqual(state.routes.at(-1)?.params);
  });

  it("round-trips Comparison scope and strips invalid muscle input", () => {
    const state = parseNavigationPath("/progress?tab=bulk&scopeKind=muscle&muscleGroup=Legs")!;
    expect(parseNavigationPath(serializeNavigationState(state))?.routes.at(-1)?.params).toEqual({ tab: "bulk", scopeKind: "muscle", muscleGroup: "Legs" });
    expect(focused("/progress?tab=bulk&scopeKind=invalid&muscleGroup=unknown")?.params).toEqual({ tab: "bulk" });
  });

  it("puts Home behind direct links so in-app back has a valid destination", () => {
    expect(parseNavigationPath("/record/body?checkInId=42")?.routes.map((route) => route.name)).toEqual(["Home", "BodyCheckIn"]);
  });

  it("does not turn a malformed body edit identity into a new check-in", () => {
    expect(focused("/record/body?checkInId=invalid")?.params).toEqual({ checkInId: -1 });
  });

  it("carries only a saved workout identity in summaries, including old in-memory callers", () => {
    const path = serializeNavigationState({ routes: [{ name: "WorkoutSummary", params: {
      workout: { workoutId: "saved/id", sets: [{ weight: 200 }] }, finishedAt: "2026-01-01", access_token: "secret"
    } }] });
    expect(path).toBe("/workouts/saved%2Fid");
    expect(focused(path)?.params).toEqual({ workoutId: "saved/id" });
    expect(focused("/workout-summary")?.name).toBe("WorkoutSummary");
    expect((focused("/workout-summary")?.params as { workoutId?: string })?.workoutId).toBeUndefined();
  });

  it("strips incidental query copies and credentials before remembering incoming paths", () => {
    expect(normalizeNavigationPath("/workouts/abc?workout=%7B%7D&finishedAt=tomorrow&access_token=secret")).toBe("/workouts/abc");
    expect(normalizeNavigationPath("/record/body?checkInId=7&invite=secret#access_token=secret")).toBe("/record/body?checkInId=7");
    expect(focused("/progress?tab=strength&sets=%5B1%5D&code=secret")?.params).toEqual({ tab: "strength" });
  });

  it("keeps forms as one route instance when returning through primary navigation", () => {
    const router = StackRouter({ initialRouteName: "Home" });
    const options = { routeNames: ["Home", "Record", "Log", "Progress"], routeParamList: {}, routeGetIdList: { Home: () => "Home", Record: () => "Record", Log: () => "Log", Progress: () => "Progress" } };
    let state = router.getInitialState(options);
    const dispatch = (action: Parameters<typeof router.getStateForAction>[1]) => {
      const next = router.getStateForAction(state, action, options);
      if (!next || next.stale !== false) throw new Error("Expected a complete navigation state");
      state = next;
    };
    dispatch(CommonActions.navigate("Log"));
    const formKey = state.routes.at(-1)!.key;
    dispatch(CommonActions.navigate("Progress"));
    dispatch(CommonActions.navigate("Log"));
    expect(state.routes.filter((route) => route.name === "Log")).toHaveLength(1);
    expect(state.routes.at(-1)?.key).toBe(formKey);
    dispatch(CommonActions.goBack());
    expect(state.routes.at(-1)?.name).toBe("Progress");
  });

  it("uses section aliases only for highlighting, while auxiliary routes retain their identity", () => {
    expect(navigationSection("BodyCheckIn")).toBe("Record");
    expect(navigationSection("ActiveWorkout")).toBe("Record");
    expect(navigationSection("WorkoutSummary")).toBe("Logs");
    expect(navigationSection("Bodyweight")).toBe("Progress");
    expect(navigationSection("Exercises")).toBe("More");
  });
});
