import { describe, expect, it } from "vitest";

import { catalogExerciseRows, getExerciseLoadType } from "@/constants/exercises";
import { assertCustomExercise, cleanExerciseName, existingExerciseNamed, isCustomExercise } from "@/services/workouts/customExercises";
import type { Exercise } from "@/types";

const timestamp = "2026-10-25T12:00:00.000Z";
const catalog = catalogExerciseRows(timestamp);
const landmine: Exercise = { id: 900, name: "Landmine Press", primary_muscle: "Shoulders", is_strength_exercise: 0, created_at: timestamp,
  creator_id: "friend", load_type: "external" };

describe("personal exercises", () => {
  it("clean names before comparing or saving them", () => {
    expect(cleanExerciseName("  Landmine \t  Press ")).toBe("Landmine Press");
    expect(assertCustomExercise({ name: " pec   deck ", primaryMuscle: "Chest", loadType: "machine_stack" }))
      .toEqual({ name: "pec deck", primaryMuscle: "Chest", loadType: "machine_stack" });
  });

  it("find a name already listed, whether catalog, your own or shared by a friend", () => {
    expect(existingExerciseNamed(catalog, "barbell  BENCH press")?.name).toBe("Barbell Bench Press");
    expect(existingExerciseNamed([...catalog, landmine], "landmine press")).toBe(landmine);
    expect(existingExerciseNamed(catalog, "Landmine Press")).toBeNull();
    expect(existingExerciseNamed(catalog, "   ")).toBeNull();
  });

  it("refuse names, muscles and load types the app cannot store", () => {
    expect(() => assertCustomExercise({ name: "X", primaryMuscle: "Chest", loadType: "external" })).toThrow("2 to 60 characters");
    expect(() => assertCustomExercise({ name: "x".repeat(61), primaryMuscle: "Chest", loadType: "external" })).toThrow("2 to 60 characters");
    expect(() => assertCustomExercise({ name: "Pec Deck", primaryMuscle: "Glutes" as never, loadType: "external" })).toThrow("main muscle");
    expect(() => assertCustomExercise({ name: "Pec Deck", primaryMuscle: "Chest", loadType: "kettlebell" as never })).toThrow("loaded");
  });

  it("carry their own load type, while catalog movements keep theirs by name", () => {
    expect(getExerciseLoadType({ ...landmine, load_type: "bodyweight_minus_assistance" })).toBe("bodyweight_minus_assistance");
    expect(getExerciseLoadType(catalog.find((exercise) => exercise.name === "Weighted Dip")!)).toBe("bodyweight_plus_load");
    expect(getExerciseLoadType("Cable Fly")).toBe("machine_stack");
    expect(isCustomExercise(landmine)).toBe(true);
    expect(isCustomExercise(catalog[0])).toBe(false);
  });
});
