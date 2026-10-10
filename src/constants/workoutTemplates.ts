import type { WorkoutTemplate } from "@/domain/types";

/** Stable built-in template identities. Scheduling one is a separate operation. */
export const workoutTemplates: WorkoutTemplate[] = [
  { id: "chest-triceps", label: "Chest / Triceps", muscles: ["Chest", "Triceps"], exerciseIds: [], createdAt: null, updatedAt: null },
  { id: "back-biceps-traps", label: "Back / Biceps / Traps", muscles: ["Back", "Biceps", "Traps"], exerciseIds: [], createdAt: null, updatedAt: null },
  { id: "legs-shoulders", label: "Legs / Shoulders", muscles: ["Legs", "Shoulders"], exerciseIds: [], createdAt: null, updatedAt: null }
];
