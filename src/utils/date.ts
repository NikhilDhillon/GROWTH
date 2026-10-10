import { addCalendarDays, isCalendarDate } from "@/domain/calendar";

export function todayIso() {
  return dateToVancouverIso(new Date());
}

export function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateToVancouverIso(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function isoToDate(value: string) {
  if (!isCalendarDate(value)) return new Date(Number.NaN);
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function daysAgoIso(days: number) {
  return addCalendarDays(todayIso(), -days);
}

export function formatShortDate(value: string) {
  if (!isCalendarDate(value)) return "Date unresolved";
  const date = isoToDate(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 8" in the current year, "Oct 8, 2025" otherwise — for tight rows and chart labels. */
export function formatCompactDate(value: string) {
  if (!isCalendarDate(value)) return "Date unresolved";
  const date = isoToDate(value);
  const sameYear = value.slice(0, 4) === todayIso().slice(0, 4);
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "Saturday, Oct 10" — a workout's heading in history. */
export function formatWeekdayDate(value: string) {
  if (!isCalendarDate(value)) return "Date unresolved";
  const date = isoToDate(value);
  const sameYear = value.slice(0, 4) === todayIso().slice(0, 4);
  return date.toLocaleDateString(undefined, sameYear ? { weekday: "long", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "Thu, Oct 8" — compact row heading that still carries the weekday. */
export function formatWeekdayShort(value: string) {
  if (!isCalendarDate(value)) return "Date unresolved";
  const date = isoToDate(value);
  const sameYear = value.slice(0, 4) === todayIso().slice(0, 4);
  return date.toLocaleDateString(undefined, sameYear ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
