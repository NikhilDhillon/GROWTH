import { describe, expect, it } from "vitest";
import { chartRangeDays, chartRangeLabel, chartRanges, isChartRange, rangeStopAt } from "./chartRange";

describe("chart ranges", () => {
  it("steps from a week to all time with no big jumps", () => {
    expect(chartRanges.map((range) => range.short)).toEqual(["1W", "2W", "1M", "2M", "3M", "6M", "9M", "1Y", "All"]);
    const days = chartRanges.map((range) => range.days).filter((value): value is NonNullable<typeof value> => value !== null);
    for (let index = 1; index < days.length; index += 1) expect(days[index] / days[index - 1]).toBeLessThanOrEqual(2.2);
  });
  it("still accepts every range saved before the slider", () => {
    for (const saved of ["week", "month", "quarter", "half", "year", "all"]) expect(isChartRange(saved)).toBe(true);
    expect(isChartRange("decade")).toBe(false);
  });
  it("gives days and a readable name", () => {
    expect(chartRangeDays("quarter")).toBe(90);
    expect(chartRangeDays("all")).toBeNull();
    expect(chartRangeLabel("nineMonths")).toBe("Last 9 months");
  });
});

describe("where a finger lands on the slider", () => {
  it("finds the nearest stop", () => {
    expect(rangeStopAt(12, 324, 12, 9)).toBe(0);
    expect(rangeStopAt(162, 324, 12, 9)).toBe(4);
    expect(rangeStopAt(312, 324, 12, 9)).toBe(8);
    expect(rangeStopAt(60, 324, 12, 9)).toBe(1);
  });
  it("stays on the track when the finger slides past either end", () => {
    expect(rangeStopAt(-50, 324, 12, 9)).toBe(0);
    expect(rangeStopAt(900, 324, 12, 9)).toBe(8);
  });
  it("does not break before the track has a size", () => {
    expect(rangeStopAt(10, 0, 12, 9)).toBe(0);
  });
});
