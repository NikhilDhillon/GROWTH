import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: {} as Record<string, any>, params: {} as Record<string, any> }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(), useEffect: () => undefined,
  useRef: (current: unknown) => ({ current })
}));
vi.mock("react-native", () => ({ useColorScheme: () => "light",
  View: "View", Pressable: "Pressable", Platform: { OS: "web", select: (values: any) => values.web },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
  Animated: { View: "AnimatedView", Value: class { interpolate() { return 0; } }, spring: () => ({ start() {} }), timing: () => ({ start() {} }), stagger: () => ({ start() {} }) }
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate() {} }), useRoute: () => ({ params: state.params }) }));
vi.mock("lucide-react-native", () => ({ ArrowRight: "ArrowRight", CheckCircle2: "CheckCircle2", Dumbbell: "Dumbbell", Flame: "Flame", ListChecks: "ListChecks", Sparkles: "Sparkles" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/DetailsDisclosure", () => ({ DetailsDisclosure: ({ children }: any) => React.createElement("View", null, children) }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (selector: (current: any) => unknown) => selector(state.current) }));

import { createActiveWorkout } from "@/constants/activeWorkout";
import { workoutRecordFromDraft } from "@/domain/workoutLifecycle";
import { WorkoutSummaryScreen } from "./WorkoutSummaryScreen";

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node && typeof node === "object" && "props" in node) {
    const element = node as any;
    return text(typeof element.type === "function" ? element.type(element.props) : element.props.children);
  }
  return "";
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  const workout = { ...createActiveWorkout({ key: "thu", label: "Thu", muscles: ["Chest"] }), startedAt: "2026-10-01T12:00:00Z", workoutDate: "2026-10-01", completedExercises: [{ exerciseId: 1, sessionId: 10, exerciseName: "Bench Press", muscle: "Chest" as const, completedAt: "2026-10-01", sets: [{ reps: "99", weight: "999" }] }] };
  state.params = { workoutId: workout.workoutId, workout, finishedAt: "2099-10-01T13:00:00Z" };
  state.current = {
    exercises: [{ id: 1, name: "Bench Press", primary_muscle: "Chest" }],
    sessions: [{ id: 10, workout_date: "2026-10-02", created_at: "2026-10-01", machine_profile_id: "gym-b" }],
    sets: [1, 2].map((id) => ({ id, session_id: 10, exercise_id: 1, set_number: id, reps: 8, weight: 110, is_warmup: 0, created_at: "2026-10-01" })),
    workoutRecords: [{ ...workoutRecordFromDraft(workout), status: "completed", finishedAt: "2026-10-01T13:00:00Z" }],
    workoutReferences: [{ workoutId: workout.workoutId, sessionId: 10, prescription: null, completedAt: null }],
    activeWorkout: null, completedGuidedWorkouts: [], workoutArchiveEvidence: undefined,
    machineProfiles: [{ id: "gym-b", label: "Revised machine" }], unitSystem: "kg", exercisePoints: [], dataError: null, hydrate: vi.fn()
  };
});
afterEach(() => vi.unstubAllGlobals());
describe("summary reads recorded work, independent of archived copied values", () => {
  it("shows edited loads with the current display unit and correct canonical volume", () => {
    const rendered = text(WorkoutSummaryScreen());
    expect(rendered).toContain("49.9 kg × 8 · 8");
    expect(rendered).toContain("798.3 kg");
    expect(rendered).toContain("Revised machine");
    expect(rendered).not.toContain("999");
  });
  it("does not show deleted work from route copies", () => {
    state.current.sessions = []; state.current.sets = [];
    const rendered = text(WorkoutSummaryScreen());
    expect(rendered).toContain("no verified recording link");
    expect(rendered).toContain("0 kg");
    expect(rendered).not.toContain("999");
    expect(rendered).not.toContain("49.9 kg × 8 · 8");
  });
  it("does not substitute an unrelated same-day score for an unlinked archive", () => {
    state.current.workoutReferences = [];
    delete state.params.workout.completedExercises[0].sessionId;
    state.current.exercisePoints = [{ exerciseId: 1, sessionId: 100, date: "2026-10-01", performancePoints: 999, estimated1RM: 999 }];
    const rendered = text(WorkoutSummaryScreen());
    expect(rendered).not.toContain("Performance:");
    expect(rendered).not.toContain("999");
  });
  it("provides a real retry action when observations cannot hydrate", () => {
    state.current.sessions = []; state.current.sets = []; state.current.dataError = "Offline";
    const tree = WorkoutSummaryScreen();
    expect(text(tree)).toContain("Retry loading recorded work");
    function elements(node: unknown): any[] {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!node || typeof node !== "object" || !("props" in node)) return [];
      return [node, ...elements((node as any).props.children)];
    }
    const retry = elements(tree).find((element) => element.type === "Pressable" && text(element).includes("Retry loading recorded work"));
    retry.props.onPress();
    expect(state.current.hydrate).toHaveBeenCalledTimes(1);
  });
  it("loads a copied-payload-free browser link and ignores route duration mutations", () => {
    state.params = { workoutId: state.params.workoutId };
    const rendered = text(WorkoutSummaryScreen());
    expect(rendered).toContain("1h 0m");
    expect(rendered).toContain("49.9 kg × 8 · 8");
  });
  it("shows missing links truthfully instead of a completion celebration from route copies", () => {
    state.params.workoutId = "missing";
    const rendered = text(WorkoutSummaryScreen());
    expect(rendered).toContain("Workout unavailable");
    expect(rendered).not.toContain("Work logged.");
    expect(rendered).not.toContain("999");
  });
});
