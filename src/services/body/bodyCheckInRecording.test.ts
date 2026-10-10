import { describe, expect, it } from "vitest";
import { bodyCheckInObservationUnits, bodyCheckInWritePayload, sameBodyCheckInSnapshot } from "@/domain/bodyCheckInRecording";
import { createBodyCheckInDraft, createBodyCheckInRequest, editedBodyCheckInDraft } from "@/screens/BodyCheckIn/bodyCheckInForm";
import type { BodyMeasurementLog } from "@/types";
import { prepareBodyCheckInWrite } from "./bodyCheckInRecording";

const requestId = "51000000-0000-0000-0000-000000000001";
const units = { weight: "kg", circumference: "in" } as const;
const stamp = "2026-06-01T12:00:00.000Z";
const historical: BodyMeasurementLog = { id: 1, weight: 175.378293, measurements: { waist: 81.287319, arm_flexed: { mode: "sides", left: 40.643719 } }, logged_date: "2026-06-01", logged_at: stamp, created_at: stamp, updated_at: stamp, notes: null };

describe("whole body capture preserves observations and input evidence", () => {
  it("converts daily weight using the form's units without borrowing sparse tape values", () => {
    const draft = createBodyCheckInDraft("2026-10-09", units);
    draft.weight = "80,25";
    const write = prepareBodyCheckInWrite(createBodyCheckInRequest(draft, requestId));
    expect(write.weight).toBeCloseTo(80.25 * 2.2046226218, 8);
    expect(write.measurements).toEqual({});
    expect(bodyCheckInObservationUnits(write)).toEqual({ weight_input_unit: "kg", circumference_input_unit: null });
  });

  it("a quick weigh-in on a day with tape leaves every tape value and its source unit untouched", () => {
    // Record's weigh-in edits today's check-in and changes only the weight.
    const taped: BodyMeasurementLog = { ...historical, circumference_input_unit: "cm", weight_input_unit: "kg" };
    const draft = editedBodyCheckInDraft(taped, units);
    const write = prepareBodyCheckInWrite(createBodyCheckInRequest({ ...draft, weight: "81.4" }, requestId));
    expect(write.measurements).toStrictEqual(taped.measurements);
    expect(bodyCheckInObservationUnits(write).circumference_input_unit).toBe("cm");
    expect(write.weight).toBeCloseTo(81.4 * 2.2046226218, 8);
  });

  it("editing notes preserves exact canonical numbers and unknown historical source units", () => {
    const draft = editedBodyCheckInDraft(historical, units);
    draft.notes = "Before breakfast";
    const write = prepareBodyCheckInWrite(createBodyCheckInRequest(draft, requestId));
    expect(write.weight).toBe(historical.weight);
    expect(write.measurements).toEqual(historical.measurements);
    expect(bodyCheckInObservationUnits(write)).toEqual({ weight_input_unit: null, circumference_input_unit: null });
  });

  it("changing one metric preserves precise untouched values and does not invent mixed tape provenance", () => {
    const draft = editedBodyCheckInDraft(historical, units);
    draft.fields.chest.value = "40";
    const write = prepareBodyCheckInWrite(createBodyCheckInRequest(draft, requestId));
    expect(write.measurements).toEqual({ ...historical.measurements, chest: 101.6 });
    expect(bodyCheckInObservationUnits(write).circumference_input_unit).toBeNull();
  });

  it("retains supported unit evidence on untouched observations", () => {
    const expected = { ...historical, weight_input_unit: "lb", circumference_input_unit: "cm" } as const;
    const write = prepareBodyCheckInWrite(createBodyCheckInRequest(editedBodyCheckInDraft(expected, units), requestId));
    expect(bodyCheckInObservationUnits(write)).toEqual({ weight_input_unit: "lb", circumference_input_unit: "cm" });
  });

  it.each([
    { loggedDate: "2026-02-30" }, { weight: "0" }, { weight: "garbage" },
    { measurements: { waist: -1 } }, { measurements: { obsolete: 88 } },
    { measurements: { arm_flexed: { mode: "sides", left: 40, extra: 42 } } }
  ])("rejects invalid observations before persistence rather than normalizing them away: %j", (override) => {
    const input = { requestId, loggedDate: "2026-10-09", weight: "80", measurements: {}, inputUnits: units, ...override };
    expect(() => prepareBodyCheckInWrite(input as any)).toThrow();
  });

  it("canonicalizes payload key order but treats source-unit changes as a stale snapshot", () => {
    const write = prepareBodyCheckInWrite(createBodyCheckInRequest(editedBodyCheckInDraft(historical, units), requestId));
    const reordered = { ...write, measurements: Object.fromEntries(Object.entries(write.measurements).reverse()) };
    expect(bodyCheckInWritePayload(write)).toBe(bodyCheckInWritePayload(reordered));
    expect(sameBodyCheckInSnapshot(historical, { ...historical, weight_input_unit: "kg" })).toBe(false);
  });
});
