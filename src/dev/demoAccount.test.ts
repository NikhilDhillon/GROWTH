import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: { getState: () => ({}), setState: () => undefined } }));

import { catalogExercises } from "@/constants/exercises";
import { calendarWeekday } from "@/domain/calendar";
import { parseImportData } from "@/services/import/importService";
import { buildDemoImport, demoAccountAvailable } from "./demoAccount";

it("builds a valid import that follows the Saturday-rest split and stays in the past", () => {
  const exercises = catalogExercises.map((exercise, index) => ({ ...exercise, id: index + 1, is_strength_exercise: 1, created_at: "2026-01-01" }));
  const preview = parseImportData(buildDemoImport("2026-10-10"), exercises as never);
  expect(preview.workoutCount).toBeGreaterThan(300);
  expect(preview.bodyWeightCount).toBeGreaterThan(60);
  expect(preview.bodyMeasurementCount).toBeGreaterThan(5);
  expect(preview.workouts.some((workout) => calendarWeekday(workout.workoutDate) === "sat")).toBe(false);
  expect(preview.workouts.every((workout) => workout.workoutDate < "2026-10-10")).toBe(true);
});

it("is never offered outside development builds", () => {
  expect(demoAccountAvailable()).toBe(false);
});
