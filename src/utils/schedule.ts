import type { TrainingSplitDay } from "@/types";

const weekOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayNames: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export function dayName(key: string) {
  return dayNames[key] ?? key;
}

export function sameMuscles(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((muscle) => b.includes(muscle));
}

/** The first scheduled training day after today, wrapping around the week. */
export function nextTrainingDay(days: TrainingSplitDay[], todayKey: string | undefined) {
  const start = Math.max(0, weekOrder.indexOf(todayKey ?? "mon"));
  for (let offset = 1; offset <= 7; offset += 1) {
    const key = weekOrder[(start + offset) % 7];
    const day = days.find((item) => item.key === key);
    if (day?.muscles.length) return day;
  }
  return null;
}

/** "Scheduled Sun & Wed" — where a workout falls in the saved schedule, reading the week from Sunday. */
export function scheduledDays(days: TrainingSplitDay[], muscles: readonly string[]) {
  const matches = ["sun", ...weekOrder.slice(0, 6)].map((key) => days.find((day) => day.key === key))
    .filter((day): day is TrainingSplitDay => Boolean(day && day.muscles.length && sameMuscles(day.muscles, muscles)));
  return matches.length ? `Scheduled ${matches.map((day) => day.label).join(" & ")}` : "Not in your weekly schedule";
}
