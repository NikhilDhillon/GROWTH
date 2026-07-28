import { describe, expect, it } from "vitest";

import { calculateAverageBodyweight, getClosestBodyweightForDate } from "@/services/body/bodyWeightService";
import { BodyWeightLog } from "@/types";

const logs: BodyWeightLog[] = [
  { id: 1, weight: 170, unit: "lb", logged_at: "2026-01-01T12:00:00.000Z", logged_date: "2026-01-01", created_at: "2026-01-01T12:00:00.000Z" },
  { id: 2, weight: 174, unit: "lb", logged_at: "2026-01-05T12:00:00.000Z", logged_date: "2026-01-05", created_at: "2026-01-05T12:00:00.000Z" }
];

describe("body-weight analytics helpers", () => {
  it("uses the latest body weight on or before a workout date", () => {
    expect(getClosestBodyweightForDate("2026-01-04", logs)?.id).toBe(1);
  });

  it("averages canonical weights over an inclusive period", () => {
    expect(calculateAverageBodyweight("2026-01-01", "2026-01-05", logs)).toBe(172);
  });
});
