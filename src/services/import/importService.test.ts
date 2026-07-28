import { describe, expect, it } from "vitest";

import { parseImportData } from "@/services/import/importService";

describe("body import compatibility", () => {
  it("continues to accept schema version 1 bodyweight files", () => {
    const result = parseImportData(JSON.stringify({
      schemaVersion: 1,
      unit: "lb",
      bodyweightUnit: "kg",
      bodyweight: [{ date: "2026-01-02", weight: 80 }]
    }), []);
    expect(result.bodyWeightCount).toBe(1);
    expect(result.bodyMeasurementCount).toBe(0);
    expect(result.bodyWeightLogs[0].weight).toBeCloseTo(176.3698);
  });

  it("parses schema version 2 single and left/right measurements", () => {
    const result = parseImportData(JSON.stringify({
      schemaVersion: 2,
      unit: "lb",
      bodyweightUnit: "kg",
      bodyMeasurementUnit: "in",
      bodyMeasurements: [{
        date: "2026-01-03",
        weight: 81,
        measurements: {
          waist: 32,
          arm_flexed: { left: 14, right: 14.25 }
        }
      }]
    }), []);
    expect(result.bodyMeasurementCount).toBe(1);
    expect(result.bodyMeasurementLogs[0].measurements.waist).toBeCloseTo(81.28);
    expect(result.bodyMeasurementLogs[0].measurements.arm_flexed).toEqual(expect.objectContaining({ mode: "sides" }));
  });
});
