import { afterEach, describe, expect, it } from "vitest";
import { comparePerformancePeriods, monthlyScoreAverages, weeklyScoreAverages, weeklyVolume } from "./analyticsService";
import type { WorkoutSet } from "@/types";

const originalTimezone = process.env.TZ;
afterEach(() => { process.env.TZ = originalTimezone; });

describe("calendar-based performance reports", () => {
  it.each(["Pacific/Auckland", "America/Los_Angeles", "UTC"])("keeps inclusive comparison windows stable in %s across daylight saving", (timezone) => {
    process.env.TZ = timezone;
    const result = comparePerformancePeriods([
      { date: "2026-03-01", score: 100 }, { date: "2026-03-07", score: 100 },
      { date: "2026-03-08", score: 110 }, { date: "2026-03-14", score: 110 },
      { date: "2026-03-15", score: 900 }
    ], "week", "2026-03-14");
    expect(result).toMatchObject({ currentStart: "2026-03-08", currentEnd: "2026-03-14", previousStart: "2026-03-01", previousEnd: "2026-03-07", previousAverage: 100, currentAverage: 110, changePercent: 10 });
  });

  it("rejects impossible comparison dates", () => {
    expect(() => comparePerformancePeriods([], "month", "2026-02-30")).toThrow("real calendar date");
  });

  it("groups Sunday weeks and leap-day months without locale shifts or invalid scores", () => {
    process.env.TZ = "Pacific/Auckland";
    const points = [{ date: "2024-02-29", score: 100 }, { date: "2024-03-02", score: 120 }, { date: "2024-03-03", score: 140 }, { date: "2024-02-30", score: 900 }, { date: "2024-03-03", score: NaN }];
    expect(weeklyScoreAverages(points)).toEqual([{ date: "2024-02-25", score: 110 }, { date: "2024-03-03", score: 140 }]);
    expect(monthlyScoreAverages(points)).toEqual([{ date: "2024-02", score: 100 }, { date: "2024-03", score: 130 }]);
  });

  it("keeps warmups out of working volume", () => {
    const set = { created_at: "2026-03-08T12:00:00Z", weight: 100, reps: 5 };
    expect(weeklyVolume([{ ...set, is_warmup: false }, { ...set, weight: 50, is_warmup: true }] as WorkoutSet[])).toEqual([{ date: "2026-03-08", volume: 500 }]);
  });
});
