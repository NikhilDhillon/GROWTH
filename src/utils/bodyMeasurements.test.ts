import { describe, expect, it } from "vitest";

import {
  bodyMeasurementValuesFromStorage,
  bodyMeasurementValuesToStorage,
  bodyMeasurementsFromLegacyWeights,
  bodyWeightLogsFromMeasurements,
  circumferenceFromStorageUnit,
  circumferenceToStorageUnit,
  normalizeBodyMeasurementValues,
  normalizeBodyUnitPreferences
} from "@/utils/bodyMeasurements";

describe("body measurement units", () => {
  it("round-trips inch values through canonical centimetres", () => {
    const stored = circumferenceToStorageUnit(15.25, "in");
    expect(stored).toBeCloseTo(38.735);
    expect(circumferenceFromStorageUnit(stored, "in")).toBeCloseTo(15.25);
  });

  it("converts scalar and sided values without changing their mode", () => {
    const stored = bodyMeasurementValuesToStorage({
      waist: 32,
      arm_flexed: { mode: "sides", left: 14, right: 14.25 }
    }, "in");
    const displayed = bodyMeasurementValuesFromStorage(stored, "in");
    expect(displayed.waist).toBeCloseTo(32);
    expect(displayed.arm_flexed).toEqual(expect.objectContaining({ mode: "sides" }));
    expect(displayed.arm_flexed?.mode === "sides" ? displayed.arm_flexed.right : null).toBeCloseTo(14.25);
  });

  it("defaults body preferences to kg and inches", () => {
    expect(normalizeBodyUnitPreferences(null)).toEqual({ weight: "kg", circumference: "in" });
    expect(normalizeBodyUnitPreferences({ weight: "lb", circumference: "cm" })).toEqual({ weight: "lb", circumference: "cm" });
  });
});

describe("body measurement normalization", () => {
  it("keeps only positive known values and one active limb mode", () => {
    expect(normalizeBodyMeasurementValues({
      waist: 82,
      unknown: 10,
      thigh: { mode: "single", value: 55, left: 54 },
      calves: { mode: "sides", left: 0, right: 38 }
    })).toEqual({
      calves: { mode: "sides", right: 38 },
      thigh: { mode: "single", value: 55 },
      waist: 82
    });
  });

  it("deduplicates legacy weight rows by date using the latest created row", () => {
    const migrated = bodyMeasurementsFromLegacyWeights([
      { id: 1, weight: 180, unit: "lb", logged_at: "2026-01-01T12:00:00.000Z", logged_date: "2026-01-01", created_at: "2026-01-01T12:00:00.000Z" },
      { id: 2, weight: 179, unit: "lb", logged_at: "2026-01-01T12:00:00.000Z", logged_date: "2026-01-01", created_at: "2026-01-02T12:00:00.000Z" }
    ]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toEqual(expect.objectContaining({ id: 2, weight: 179, logged_date: "2026-01-01" }));
  });

  it("projects check-ins back to the body-weight interface used by scoring", () => {
    const projected = bodyWeightLogsFromMeasurements([
      {
        id: 3,
        weight: 175,
        measurements: { waist: 80 },
        logged_at: "2026-02-01T12:00:00.000Z",
        logged_date: "2026-02-01",
        created_at: "2026-02-01T12:00:00.000Z",
        updated_at: "2026-02-01T12:00:00.000Z"
      },
      {
        id: 4,
        weight: null,
        measurements: { chest: 100 },
        logged_at: "2026-02-02T12:00:00.000Z",
        logged_date: "2026-02-02",
        created_at: "2026-02-02T12:00:00.000Z",
        updated_at: "2026-02-02T12:00:00.000Z"
      }
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toEqual(expect.objectContaining({ id: 3, weight: 175 }));
  });
});
