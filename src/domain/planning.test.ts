import { describe, expect, it } from "vitest";
import { createDefaultTrainingSplit } from "@/constants/trainingSplit";
import { createActiveWorkout, normalizeActiveWorkout } from "@/constants/activeWorkout";
import { projectTrainingPlan } from "./planning";
import { calendarWeekday } from "./calendar";

it("separates a chosen template identity from today's weekday", () => {
  const active = createActiveWorkout({ key: "chest-triceps", label: "Chest / Triceps", muscles: ["Chest", "Triceps"] }, "Chest / Triceps", "chest-triceps");
  expect(active.templateId).toBe("chest-triceps");
  expect(active.todayDayKey).toBe(calendarWeekday(active.workoutDate));
  expect(active.sourceDayKey).toBe(active.todayDayKey);
  expect(normalizeActiveWorkout(active)?.templateId).toBe(active.templateId);
});
describe("legacy schedule projection preserves planning choices", () => {
  it("retains each weekday and represents rest without a fake template", () => {
    const split = createDefaultTrainingSplit();
    const before = JSON.stringify(split);
    const result = projectTrainingPlan(split);
    expect(result.scheduledDays).toHaveLength(7);
    expect(result.scheduledDays.find((day) => day.weekday === "sat")?.templateId).toBeNull();
    expect(result.templates.find((template) => template.id === "legacy-weekday:sun")?.muscles).toEqual(["Chest", "Triceps"]);
    expect(result.templates.find((template) => template.id === "legacy-weekday:mon")?.muscles).toEqual(["Back", "Biceps", "Traps"]);
    expect(JSON.stringify(split)).toBe(before);
  });
});
