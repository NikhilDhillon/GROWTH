import { MuscleGroup } from "@/types";

export type CatalogExercise = {
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscle?: MuscleGroup | null;
  loadType?: ExerciseLoadType;
  supportsBarbellCalculator?: boolean;
};

export type ExerciseLoadType = "external" | "machine_stack" | "bodyweight_plus_load" | "bodyweight_minus_assistance";

export const catalogExercises: CatalogExercise[] = [
  { name: "Barbell Bench Press", primary_muscle: "Chest", supportsBarbellCalculator: true },
  { name: "Incline Barbell Bench Press", primary_muscle: "Chest", supportsBarbellCalculator: true },
  { name: "Dumbbell Bench Press", primary_muscle: "Chest" },
  { name: "Incline Dumbbell Press", primary_muscle: "Chest" },
  { name: "Machine Chest Press", primary_muscle: "Chest", loadType: "machine_stack" },
  { name: "Weighted Dip", primary_muscle: "Chest", secondary_muscle: "Triceps", loadType: "bodyweight_plus_load" },
  { name: "Cable Fly", primary_muscle: "Chest", loadType: "machine_stack" },
  { name: "Pin Press", primary_muscle: "Chest", secondary_muscle: "Triceps", supportsBarbellCalculator: true },
  { name: "Conventional Deadlift", primary_muscle: "Back", secondary_muscle: "Legs", supportsBarbellCalculator: true },
  { name: "Barbell Row", primary_muscle: "Back", supportsBarbellCalculator: true },
  { name: "Dumbbell Row", primary_muscle: "Back" },
  { name: "Pull-Up", primary_muscle: "Back", secondary_muscle: "Biceps", loadType: "bodyweight_plus_load" },
  { name: "Chin-Up", primary_muscle: "Back", secondary_muscle: "Biceps", loadType: "bodyweight_plus_load" },
  { name: "Incline Lying Dumbbell Row", primary_muscle: "Back" },
  { name: "Lat Pulldown", primary_muscle: "Back", loadType: "machine_stack" },
  { name: "Seated Cable Row", primary_muscle: "Back", loadType: "machine_stack" },
  { name: "Overhead Press", primary_muscle: "Shoulders" },
  { name: "Seated Dumbbell Shoulder Press", primary_muscle: "Shoulders" },
  { name: "Arnold Press", primary_muscle: "Shoulders" },
  { name: "Lateral Raise", primary_muscle: "Shoulders" },
  { name: "Cable Lateral Raise", primary_muscle: "Shoulders", loadType: "machine_stack" },
  { name: "Rear Delt Fly", primary_muscle: "Shoulders" },
  { name: "Cable Rear Delt Fly", primary_muscle: "Shoulders", loadType: "machine_stack" },
  { name: "Face Pull", primary_muscle: "Shoulders", secondary_muscle: "Back", loadType: "machine_stack" },
  { name: "Barbell Shrug", primary_muscle: "Traps", supportsBarbellCalculator: true },
  { name: "Dumbbell Shrug", primary_muscle: "Traps" },
  { name: "Cable Shrug", primary_muscle: "Traps", loadType: "machine_stack" },
  { name: "Barbell Curl", primary_muscle: "Biceps", supportsBarbellCalculator: true },
  { name: "Dumbbell Curl", primary_muscle: "Biceps" },
  { name: "Incline Dumbbell Curl", primary_muscle: "Biceps" },
  { name: "Hammer Curl", primary_muscle: "Biceps" },
  { name: "Barbell Preacher Curl", primary_muscle: "Biceps", supportsBarbellCalculator: true },
  { name: "Dumbbell Preacher Curl", primary_muscle: "Biceps" },
  { name: "Cable Curl", primary_muscle: "Biceps", loadType: "machine_stack" },
  { name: "Close-Grip Bench Press", primary_muscle: "Triceps", secondary_muscle: "Chest", supportsBarbellCalculator: true },
  { name: "Skull Crusher", primary_muscle: "Triceps" },
  { name: "Cable Pushdown", primary_muscle: "Triceps", loadType: "machine_stack" },
  { name: "Overhead Triceps Extension", primary_muscle: "Triceps" },
  { name: "Assisted Dip", primary_muscle: "Triceps", secondary_muscle: "Chest", loadType: "bodyweight_minus_assistance" },
  { name: "Tricep Pin Press", primary_muscle: "Triceps", secondary_muscle: "Chest", supportsBarbellCalculator: true },
  { name: "Back Squat", primary_muscle: "Legs", supportsBarbellCalculator: true },
  { name: "Front Squat", primary_muscle: "Legs", supportsBarbellCalculator: true },
  { name: "Leg Press", primary_muscle: "Legs", loadType: "machine_stack" },
  { name: "Romanian Deadlift", primary_muscle: "Legs", secondary_muscle: "Back", supportsBarbellCalculator: true },
  { name: "Hip Thrust", primary_muscle: "Legs" },
  { name: "Bulgarian Split Squat", primary_muscle: "Legs" },
  { name: "Walking Lunge", primary_muscle: "Legs" },
  { name: "Leg Extension", primary_muscle: "Legs", loadType: "machine_stack" },
  { name: "Leg Curl", primary_muscle: "Legs", loadType: "machine_stack" },
  { name: "Standing Calf Raise", primary_muscle: "Legs", loadType: "machine_stack" },
  { name: "Seated Calf Raise", primary_muscle: "Legs", loadType: "machine_stack" },
  { name: "Weighted Plank", primary_muscle: "Core" },
  { name: "Cable Crunch", primary_muscle: "Core", loadType: "machine_stack" },
  { name: "Hanging Leg Raise", primary_muscle: "Core" },
  { name: "Ab Wheel Rollout", primary_muscle: "Core" },
  { name: "Decline Sit-Up", primary_muscle: "Core" },
  { name: "Pallof Press", primary_muscle: "Core", loadType: "machine_stack" },
  { name: "Wrist Curl", primary_muscle: "Forearms" },
  { name: "Reverse Wrist Curl", primary_muscle: "Forearms" }
];

export function getExerciseLoadType(exerciseName: string): ExerciseLoadType {
  return catalogExercises.find((exercise) => exercise.name === exerciseName)?.loadType ?? "external";
}

export function isBodyweightLoadType(loadType: ExerciseLoadType) {
  return loadType === "bodyweight_plus_load" || loadType === "bodyweight_minus_assistance";
}

export function isMachineLoadType(loadType: ExerciseLoadType) {
  return loadType === "machine_stack";
}

export function supportsBarbellCalculator(exerciseName: string) {
  return catalogExercises.find((exercise) => exercise.name === exerciseName)?.supportsBarbellCalculator ?? false;
}

export function catalogExerciseRows(createdAt: string) {
  return catalogExercises.map((exercise, index) => ({
    id: index + 1,
    name: exercise.name,
    primary_muscle: exercise.primary_muscle,
    secondary_muscle: exercise.secondary_muscle ?? null,
    is_strength_exercise: 0,
    created_at: createdAt
  }));
}
