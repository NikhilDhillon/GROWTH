import { describe, expect, it } from "vitest";

import { createEmptyPlateCounts, formatElapsedWorkoutTime } from "@/utils/workout";

describe("workout helpers", () => {
  it("creates a fresh zeroed plate map", () => {
    const first = createEmptyPlateCounts();
    const second = createEmptyPlateCounts();

    expect(first).toEqual({ 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 });
    expect(first).not.toBe(second);
  });

  it("formats elapsed time and clamps future start times", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";

    expect(formatElapsedWorkoutTime(startedAt, Date.parse("2026-01-01T01:02:03.000Z"))).toBe("01:02:03");
    expect(formatElapsedWorkoutTime(startedAt, Date.parse("2025-12-31T23:59:59.000Z"))).toBe("00:00:00");
  });
});
