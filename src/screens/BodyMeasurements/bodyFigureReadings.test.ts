import { describe, expect, it } from "vitest";
import { buildBodyMeasurementOverview } from "@/services/body/bodyMeasurementReport";
import type { BodyMeasurementLog, BodyMeasurementValues } from "@/types";
import { bodyFigureReading, bodyFigureTint, changeBarScale } from "./bodyFigureReadings";

const cutoff = "2026-10-09";
function log(id: number, date: string, measurements: BodyMeasurementValues): BodyMeasurementLog {
  return { id, weight: 170, measurements, logged_date: date, logged_at: `${date}T12:00:00Z`, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` };
}
const rows = (...logs: BodyMeasurementLog[]) => buildBodyMeasurementOverview(logs, "all", cutoff).rows;

describe("what each side of the body shows", () => {
  it("reads each side from its own channel", () => {
    const measured = rows(log(1, "2026-01-01", { thigh: { mode: "sides", left: 50, right: 52 } }), log(2, "2026-05-01", { thigh: { mode: "sides", left: 51, right: 55 } }));
    expect(bodyFigureReading(measured, "thigh", "left")).toEqual({ key: "thigh", channel: "left", changeCm: 1 });
    expect(bodyFigureReading(measured, "thigh", "right")).toEqual({ key: "thigh", channel: "right", changeCm: 3 });
  });
  it("leaves an unmeasured side empty instead of borrowing the other side", () => {
    const measured = rows(log(1, "2026-01-01", { thigh: { mode: "sides", left: 50 } }), log(2, "2026-05-01", { thigh: { mode: "sides", left: 51 } }));
    expect(bodyFigureReading(measured, "thigh", "right")).toEqual({ key: "thigh", channel: null, changeCm: null });
  });
  it("shows one value on both sides when one value was recorded", () => {
    const measured = rows(log(1, "2026-01-01", { calves: { mode: "single", value: 35 } }), log(2, "2026-05-01", { calves: { mode: "single", value: 36 } }));
    for (const side of ["left", "right"] as const) expect(bodyFigureReading(measured, "calves", side)).toEqual({ key: "calves", channel: "single", changeCm: 1 });
  });
  it("prefers a side's own channel over an older single value", () => {
    const measured = rows(log(1, "2026-01-01", { thigh: { mode: "single", value: 50 } }), log(2, "2026-03-01", { thigh: { mode: "sides", left: 51 } }), log(3, "2026-05-01", { thigh: { mode: "sides", left: 53 } }));
    expect(bodyFigureReading(measured, "thigh", "left")?.channel).toBe("left");
    expect(bodyFigureReading(measured, "thigh", "right")?.channel).toBe("single");
  });
  it("reads torso measurements the same on both halves of the body", () => {
    const measured = rows(log(1, "2026-01-01", { waist: 80 }), log(2, "2026-05-01", { waist: 78 }));
    for (const side of ["left", "right"] as const) expect(bodyFigureReading(measured, "waist", side)).toEqual({ key: "waist", channel: "scalar", changeCm: -2 });
  });
  it("shows flexed arm first and falls back to unflexed", () => {
    const both = rows(log(1, "2026-01-01", { arm_flexed: { mode: "single", value: 38 }, arm_unflexed: { mode: "single", value: 34 } }));
    expect(bodyFigureReading(both, "arm", "left")?.key).toBe("arm_flexed");
    const unflexed = rows(log(1, "2026-01-01", { arm_unflexed: { mode: "single", value: 34 } }));
    expect(bodyFigureReading(unflexed, "arm", "left")?.key).toBe("arm_unflexed");
  });
  it("uses the average on both sides once a part switched how it was measured", () => {
    const measured = rows(log(1, "2026-01-01", { thigh: { mode: "single", value: 60 } }), log(2, "2026-05-01", { thigh: { mode: "sides", left: 54, right: 56 } }));
    for (const side of ["left", "right"] as const) expect(bodyFigureReading(measured, "thigh", side)).toEqual({ key: "thigh", channel: "average", changeCm: -5 });
  });
  it("has no reading for a part never measured", () => {
    expect(bodyFigureReading(rows(log(1, "2026-01-01", { waist: 80 })), "forearm", "left")).toBeNull();
  });
});

describe("tints and bars", () => {
  const domain = { min: -2, max: 4 };
  it("gives direction and scales strength with the largest change", () => {
    expect(bodyFigureTint(4, "cm", domain)).toEqual({ direction: "grew", strength: 1 });
    expect(bodyFigureTint(-2, "cm", domain)?.direction).toBe("shrank");
    expect(bodyFigureTint(-2, "cm", domain)?.strength).toBeCloseTo(0.65);
  });
  it("tells a part that stayed the same apart from a part with nothing to compare", () => {
    expect(bodyFigureTint(null, "cm", domain)).toBeNull();
    expect(bodyFigureTint(0, "cm", domain)?.direction).toBe("steady");
    expect(bodyFigureTint(0.04, "cm", domain)?.direction).toBe("steady");
    expect(bodyFigureTint(0.1, "in", domain)?.direction).toBe("steady");
  });
  it("keeps a tiny change from filling the scale", () => {
    expect(bodyFigureTint(0.5, "cm", { min: 0, max: 0.5 })?.strength).toBeCloseTo(0.475);
    expect(changeBarScale({ min: 0, max: 0.5 })).toEqual({ low: 0, high: 2 });
    expect(changeBarScale({ min: -0.5, max: 0 })).toEqual({ low: -2, high: 0 });
    expect(changeBarScale({ min: 0, max: 0 })).toEqual({ low: 0, high: 2 });
  });
  it("uses the real range once changes are large enough", () => {
    expect(changeBarScale({ min: -3, max: 4 })).toEqual({ low: -3, high: 4 });
  });
});
