import { MuscleGroup } from "@/types";

export type CatalogExercise = {
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscle?: MuscleGroup | null;
};

export const catalogExercises: CatalogExercise[] = [
  { name: "Barbell Bench Press", primary_muscle: "Chest" },
  { name: "Incline Barbell Bench Press", primary_muscle: "Chest" },
  { name: "Dumbbell Bench Press", primary_muscle: "Chest" },
  { name: "Incline Dumbbell Press", primary_muscle: "Chest" },
  { name: "Machine Chest Press", primary_muscle: "Chest" },
  { name: "Weighted Dip", primary_muscle: "Chest", secondary_muscle: "Triceps" },
  { name: "Cable Fly", primary_muscle: "Chest" },
  { name: "Pin Press", primary_muscle: "Chest", secondary_muscle: "Triceps" },
  { name: "Conventional Deadlift", primary_muscle: "Back", secondary_muscle: "Legs" },
  { name: "Barbell Row", primary_muscle: "Back" },
  { name: "Dumbbell Row", primary_muscle: "Back" },
  { name: "Pull-Up", primary_muscle: "Back", secondary_muscle: "Biceps" },
  { name: "Chin-Up", primary_muscle: "Back", secondary_muscle: "Biceps" },
  { name: "Lat Pulldown", primary_muscle: "Back" },
  { name: "Seated Cable Row", primary_muscle: "Back" },
  { name: "Overhead Press", primary_muscle: "Shoulders" },
  { name: "Seated Dumbbell Shoulder Press", primary_muscle: "Shoulders" },
  { name: "Arnold Press", primary_muscle: "Shoulders" },
  { name: "Lateral Raise", primary_muscle: "Shoulders" },
  { name: "Rear Delt Fly", primary_muscle: "Shoulders" },
  { name: "Face Pull", primary_muscle: "Shoulders", secondary_muscle: "Back" },
  { name: "Barbell Curl", primary_muscle: "Biceps" },
  { name: "Dumbbell Curl", primary_muscle: "Biceps" },
  { name: "Incline Dumbbell Curl", primary_muscle: "Biceps" },
  { name: "Hammer Curl", primary_muscle: "Biceps" },
  { name: "Preacher Curl", primary_muscle: "Biceps" },
  { name: "Cable Curl", primary_muscle: "Biceps" },
  { name: "Close-Grip Bench Press", primary_muscle: "Triceps", secondary_muscle: "Chest" },
  { name: "Skull Crusher", primary_muscle: "Triceps" },
  { name: "Cable Pushdown", primary_muscle: "Triceps" },
  { name: "Overhead Triceps Extension", primary_muscle: "Triceps" },
  { name: "Assisted Dip", primary_muscle: "Triceps", secondary_muscle: "Chest" },
  { name: "Tricep Pin Press", primary_muscle: "Triceps", secondary_muscle: "Chest" },
  { name: "Back Squat", primary_muscle: "Legs" },
  { name: "Front Squat", primary_muscle: "Legs" },
  { name: "Leg Press", primary_muscle: "Legs" },
  { name: "Romanian Deadlift", primary_muscle: "Legs", secondary_muscle: "Back" },
  { name: "Hip Thrust", primary_muscle: "Legs" },
  { name: "Bulgarian Split Squat", primary_muscle: "Legs" },
  { name: "Walking Lunge", primary_muscle: "Legs" },
  { name: "Leg Extension", primary_muscle: "Legs" },
  { name: "Leg Curl", primary_muscle: "Legs" },
  { name: "Standing Calf Raise", primary_muscle: "Legs" },
  { name: "Seated Calf Raise", primary_muscle: "Legs" },
  { name: "Weighted Plank", primary_muscle: "Core" },
  { name: "Cable Crunch", primary_muscle: "Core" },
  { name: "Hanging Leg Raise", primary_muscle: "Core" },
  { name: "Ab Wheel Rollout", primary_muscle: "Core" },
  { name: "Decline Sit-Up", primary_muscle: "Core" },
  { name: "Pallof Press", primary_muscle: "Core" }
];

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
