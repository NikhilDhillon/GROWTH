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
    expect(result.bodyWeightLogs[0].weightInputUnit).toBe("kg");
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
    expect(result.bodyMeasurementLogs[0].weightInputUnit).toBe("kg");
    expect(result.bodyMeasurementLogs[0].circumferenceInputUnit).toBe("in");
  });

  it("keeps provenance unknown when compatibility conversion defaults are used", () => {
    const result = parseImportData(JSON.stringify({
      schemaVersion: 1,
      unit: "lb",
      bodyweight: [{ date: "2026-01-04", weight: 180 }],
      bodyMeasurements: [{ date: "2026-01-04", measurements: { waist: 32 } }]
    }), []);
    expect(result.bodyWeightLogs[0].weightInputUnit).toBeNull();
    expect(result.bodyMeasurementLogs[0].circumferenceInputUnit).toBeNull();
    expect(result.warnings).toHaveLength(2);
  });
});

describe("import observation contracts", () => {
  const bench = { id: 1, name: "Bench Press", primary_muscle: "Chest" as const, is_strength_exercise: 1, created_at: "2026-01-01" };
  function file(date: string, sets: Array<{ reps: number; weight: number; rir?: number; isWarmup?: boolean }> = [{ reps: 5, weight: 50 }]) {
    return JSON.stringify({ schemaVersion: 2, unit: "kg", workouts: [{ date, exercises: [{ name: bench.name, sets }] }] });
  }
  it("accepts one observed set and carries the declared input unit", () => {
    const preview = parseImportData(file("2026-02-28"), [bench]);
    expect(preview.setCount).toBe(1);
    expect(preview.workouts[0].inputUnit).toBe("kg");
    expect(preview.workouts[0].sets[0].weight).toBeCloseTo(110.2311);
  });
  it("preserves a performed warm-up flag", () => {
    const raw = JSON.parse(file("2026-02-28"));
    raw.workouts[0].exercises[0].sets[0].isWarmup = true;
    expect(parseImportData(JSON.stringify(raw), [bench]).workouts[0].sets[0].isWarmup).toBe(true);
  });
  it("preserves an explicitly recorded RIR and leaves unknown RIR absent", () => {
    const raw = JSON.parse(file("2026-02-28", [{ reps: 5, weight: 50, rir: 1.5 }, { reps: 4, weight: 55 }]));
    const parsed = parseImportData(JSON.stringify(raw), [bench]);
    expect(parsed.workouts[0].sets).toEqual([
      expect.objectContaining({ reps: 5, rir: 1.5 }),
      expect.objectContaining({ reps: 4 })
    ]);
    expect(parsed.workouts[0].sets[1]).not.toHaveProperty("rir");
    expect(parsed.workouts[0].fingerprint).not.toBe(parseImportData(file("2026-02-28"), [bench]).workouts[0].fingerprint);
  });
  it.each([-1, 10.1, "2"])("rejects invalid RIR %s", (rir) => {
    const raw = JSON.parse(file("2026-02-28"));
    raw.workouts[0].exercises[0].sets[0].rir = rir;
    expect(() => parseImportData(JSON.stringify(raw), [bench])).toThrow(/rir must be a number from 0 to 10/);
  });
  it("rejects external IDs that collide with the fingerprint delimiter", () => {
    const raw = JSON.parse(file("2026-02-28"));
    raw.workouts[0].externalId = "source::edition";
    expect(() => parseImportData(JSON.stringify(raw), [bench])).toThrow(/externalId must not contain the reserved/);
  });
  it.each(["2026-02-30", "2026-13-01", "0000-01-01"])("rejects impossible date %s", (date) => {
    expect(() => parseImportData(file(date), [bench])).toThrow(/calendar date/);
  });
});
