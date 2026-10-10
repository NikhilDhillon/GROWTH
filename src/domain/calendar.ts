import type { CalendarDate, CalendarWeekday } from "./types";

export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function assertCalendarDate(value: unknown): CalendarDate {
  if (!isCalendarDate(value)) throw new Error("Choose a real calendar date in YYYY-MM-DD format.");
  return value;
}

function calendarInstant(value: CalendarDate) {
  const [year, month, day] = assertCalendarDate(value).split("-").map(Number);
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(0, 0, 0, 0);
  return instant;
}

export function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) throw new Error("Calendar offsets require whole days.");
  const instant = calendarInstant(value);
  instant.setUTCDate(instant.getUTCDate() + days);
  return assertCalendarDate(instant.toISOString().slice(0, 10));
}

export function daysBetween(start: CalendarDate, end: CalendarDate) {
  return (calendarInstant(end).getTime() - calendarInstant(start).getTime()) / 86400000;
}

export function calendarWeekday(value: CalendarDate): CalendarWeekday {
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[calendarInstant(value).getUTCDay()];
}

export function assertCalendarRange(startDate: CalendarDate, endDate: CalendarDate) {
  assertCalendarDate(startDate); assertCalendarDate(endDate);
  if (startDate > endDate) throw new Error("The comparison start date must be on or before its end date.");
  return { startDate, endDate };
}
