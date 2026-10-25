import { getPathFromState, getStateFromPath } from "@react-navigation/core";
import type { LinkingOptions } from "@react-navigation/native";
import type { ActiveWorkout, MuscleGroup } from "@/types";

export type RootStackParamList = {
  Home: undefined;
  /** logged names an exercise just saved from Record's quick capture, for confirmation. */
  Record: { logged?: string } | undefined;
  /** exerciseId opens the quick log on that exercise with its last sets filled in. */
  Log: { exerciseId?: number } | undefined;
  Exercises: undefined;
  Bodyweight: undefined;
  BodyCheckIn: { checkInId?: number } | undefined;
  Progress: { tab?: "overview" | "strength" | "body" | "bulk"; exerciseId?: number; range?: string; comparisonKey?: string; scopeKind?: "overall" | "muscle" | "exercise"; muscleGroup?: MuscleGroup } | undefined;
  Social: undefined;
  Logs: undefined;
  Settings: undefined;
  GuidedWorkoutSettings: undefined;
  ActiveWorkout: undefined;
  /** Flow mode: the active workout as a full-screen flow without app navigation. */
  FlowWorkout: undefined;
  // Old in-memory callers may resolve a saved identity, never render this copy.
  WorkoutSummary: { workoutId?: string; workout?: ActiveWorkout; finishedAt?: string } | undefined;
};

export type AppRouteName = keyof RootStackParamList;
export type PrimaryRouteName = "Home" | "Record" | "Progress" | "Logs";
export type NavigationSection = PrimaryRouteName | "More";

export const routeTitles: Record<AppRouteName, string> = {
  Home: "Home", Record: "Record", Log: "Quick workout", Exercises: "Exercises", Bodyweight: "Bodyweight",
  BodyCheckIn: "Body check-in", Progress: "Progress", Social: "Social", Logs: "History", Settings: "Settings",
  GuidedWorkoutSettings: "Guided preferences", ActiveWorkout: "Guided workout", FlowWorkout: "Flow", WorkoutSummary: "Workout details"
};

/** Where the active workout opens: the full-screen flow in flow mode, otherwise the guided page. */
export function workoutRoute(flowMode: boolean): "FlowWorkout" | "ActiveWorkout" {
  return flowMode ? "FlowWorkout" : "ActiveWorkout";
}

export function navigationSection(route: AppRouteName): NavigationSection {
  if (route === "Home") return "Home";
  if (["Record", "Log", "ActiveWorkout", "FlowWorkout", "BodyCheckIn"].includes(route)) return "Record";
  if (["Progress", "Bodyweight"].includes(route)) return "Progress";
  if (["Logs", "WorkoutSummary"].includes(route)) return "Logs";
  return "More";
}

const positiveId = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : -1;

export const navigationConfig: NonNullable<LinkingOptions<RootStackParamList>["config"]> = {
  initialRouteName: "Home",
  screens: {
    Home: "",
    Record: "record",
    Log: { path: "record/quick", parse: { exerciseId: positiveId } },
    ActiveWorkout: "record/guided",
    FlowWorkout: "record/flow",
    BodyCheckIn: { path: "record/body", parse: { checkInId: positiveId } },
    Progress: { path: "progress", parse: { exerciseId: positiveId } },
    Logs: "history",
    Exercises: "exercises",
    Bodyweight: "bodyweight",
    Social: "social",
    Settings: "settings",
    GuidedWorkoutSettings: "settings/guided",
    WorkoutSummary: "workouts/:workoutId?"
  }
};

// Old public paths remain useful. Route names also appeared in shared URLs.
const aliases: Record<string, string> = {
  home: "", record: "record", log: "record/quick", workout: "record/quick", quick: "record/quick",
  activeworkout: "record/guided", "active-workout": "record/guided", "guided-workout": "record/guided",
  bodycheckin: "record/body", "body-check-in": "record/body", logs: "history", history: "history",
  exercises: "exercises", bodyweight: "bodyweight", "body-weight": "bodyweight", social: "social", settings: "settings",
  guidedworkoutsettings: "settings/guided", "guided-workout-settings": "settings/guided", progress: "progress"
};
const reportAliases: Record<string, "strength" | "body" | "bulk"> = {
  analytics: "strength", strength: "strength", bodymeasurements: "body", "body-measurements": "body",
  bulkanalytics: "bulk", "bulk-analytics": "bulk", comparison: "bulk"
};

function safeParams(name: string, params?: Record<string, unknown>) {
  if (!params) return undefined;
  const result: Record<string, string | number> = {};
  if (name === "BodyCheckIn" && params.checkInId !== undefined) result.checkInId = positiveId(String(params.checkInId));
  if (name === "Progress") {
    if (["overview", "strength", "body", "bulk"].includes(String(params.tab))) result.tab = String(params.tab);
    if (params.exerciseId !== undefined) result.exerciseId = positiveId(String(params.exerciseId));
    if (typeof params.range === "string") result.range = params.range;
    if (typeof params.comparisonKey === "string") result.comparisonKey = params.comparisonKey;
    if (["overall", "muscle", "exercise"].includes(String(params.scopeKind))) result.scopeKind = String(params.scopeKind);
    if (["Chest", "Back", "Shoulders", "Traps", "Biceps", "Triceps", "Legs", "Core", "Forearms"].includes(String(params.muscleGroup))) result.muscleGroup = String(params.muscleGroup);
  }
  if (name === "WorkoutSummary") {
    const id = params.workoutId ?? (params.workout as ActiveWorkout | undefined)?.workoutId;
    if (typeof id === "string" && id.trim()) result.workoutId = id;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Strip incidental/auth/observation payloads before the router remembers a path. */
export function normalizeNavigationPath(path: string): string | undefined {
  let url: URL;
  try { url = new URL(path.startsWith("/") ? path : `/${path}`, "https://growth.local"); } catch { return undefined; }
  const raw = url.pathname.replace(/^\/+|\/+$/g, "");
  let key: string;
  try { key = decodeURIComponent(raw).toLowerCase(); } catch { return undefined; }
  let canonical = aliases[key] ?? (raw === "" ? "" : undefined);
  let name: AppRouteName | undefined;
  let summaryId: string | undefined;
  const reportTab = reportAliases[key];
  if (reportTab) canonical = "progress";
  if (/^(workouts|workout-summary|workoutsummary)(\/|$)/i.test(raw)) {
    const encodedId = raw.slice(raw.indexOf("/") + 1);
    try { summaryId = raw.includes("/") ? decodeURIComponent(encodedId) : url.searchParams.get("workoutId") ?? undefined; } catch { return undefined; }
    canonical = `workouts${summaryId ? `/${encodeURIComponent(summaryId)}` : ""}`;
    name = "WorkoutSummary";
  }
  if (canonical === undefined) {
    // Recognize canonical nested paths without requiring aliases for each.
    if (["record/quick", "record/guided", "record/flow", "record/body", "settings/guided"].includes(key)) canonical = key;
    else return undefined;
  }
  name ??= canonical === "progress" ? "Progress" : canonical === "record/body" ? "BodyCheckIn" : undefined;
  const input = Object.fromEntries(url.searchParams.entries());
  if (reportTab) input.tab = reportTab;
  if (summaryId) input.workoutId = summaryId;
  const params = name ? safeParams(name, input) : undefined;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (name === "WorkoutSummary" && key === "workoutId") continue;
    query.set(key, String(value));
  }
  return `/${canonical}${query.size ? `?${query}` : ""}`;
}

export const parseNavigationPath: typeof getStateFromPath = (path, options) => {
  const normalized = normalizeNavigationPath(path);
  return normalized === undefined ? undefined : getStateFromPath(normalized, options ?? navigationConfig as NonNullable<typeof options>);
};

/** URLs carry identities and report context, never copies of observations. */
export const serializeNavigationState: typeof getPathFromState = (state, options) => {
  function sanitize(value: typeof state): typeof state {
    return { ...value, routes: value.routes.map((route) => ({
      ...route,
      params: safeParams(route.name, route.params as Record<string, unknown> | undefined),
      ...(route.state ? { state: sanitize(route.state) } : {})
    })) } as typeof state;
  }
  return getPathFromState(sanitize(state), options ?? navigationConfig as NonNullable<typeof options>);
};

export const appLinking: LinkingOptions<RootStackParamList> = {
  prefixes: ["growth://"], config: navigationConfig,
  getStateFromPath: parseNavigationPath, getPathFromState: serializeNavigationState
};
