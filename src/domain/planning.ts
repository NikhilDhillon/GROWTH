import type { TrainingSplit } from "@/types";
import type { CalendarWeekday, ScheduledDay, WorkoutTemplate } from "./types";

/** A compatibility projection, not a rewrite or a claim that old days shared a reusable template. */
export function projectTrainingPlan(split: TrainingSplit): { templates: WorkoutTemplate[]; scheduledDays: ScheduledDay[] } {
  const templates: WorkoutTemplate[] = [];
  const scheduledDays: ScheduledDay[] = [];
  for (const day of split.days) {
    if (!["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(day.key)) throw new Error("A scheduled day must have a stable weekday identity.");
    const id = `legacy-weekday:${day.key}`;
    if (day.muscles.length) templates.push({
      id, label: day.label, muscles: [...day.muscles], exerciseIds: [], createdAt: null, updatedAt: split.updated_at
    });
    scheduledDays.push({ id: `weekday:${day.key}`, weekday: day.key as CalendarWeekday, templateId: day.muscles.length ? id : null });
  }
  return { templates, scheduledDays };
}
