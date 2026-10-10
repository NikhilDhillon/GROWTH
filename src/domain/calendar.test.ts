import { afterEach, describe, expect, it, vi } from "vitest";
import { addCalendarDays, assertCalendarDate, assertCalendarRange, calendarWeekday, daysBetween, isCalendarDate } from "./calendar";
import { daysAgoIso, isoToDate, todayIso } from "@/utils/date";
import { todaySplitDay } from "@/constants/activeWorkout";
import { createDefaultTrainingSplit } from "@/constants/trainingSplit";

afterEach(() => vi.useRealTimers());
describe("calendar dates are dates rather than elapsed instants", () => {
  it.each(["2026-02-30", "2026-02-29", "1900-02-29", "0000-01-01", "2026-00-01", "2026-01-32", "2026-1-2", "", "2026-10-09T01:00:00Z"])("rejects %s", (date) => {
    expect(isCalendarDate(date)).toBe(false);
    expect(() => assertCalendarDate(date)).toThrow();
    expect(Number.isNaN(isoToDate(date).getTime())).toBe(true);
  });
  it.each(["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])("accepts real date %s", (date) => expect(assertCalendarDate(date)).toBe(date));
  it("keeps calendar boundaries stable across leap years and daylight saving", () => {
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCalendarDays("2026-03-08", -1)).toBe("2026-03-07");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(calendarWeekday("2026-10-09")).toBe("fri");
    expect(() => assertCalendarRange("2026-10-09", "2026-10-08")).toThrow();
  });
  it("uses the existing explicit Vancouver day for recording and schedule selection", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T01:00:00Z"));
    expect(todayIso()).toBe("2026-10-08");
    expect(daysAgoIso(1)).toBe("2026-10-07");
    expect(todaySplitDay(createDefaultTrainingSplit().days).key).toBe("thu");
  });
});
