import { describe, expect, it } from "vitest";
import { createBodyCheckInDraft, createBodyCheckInRequest, editedBodyCheckInDraft, latestBodyObservations } from "./bodyCheckInForm";
import type { BodyMeasurementLog } from "@/types";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const row: BodyMeasurementLog = {
  id: 1, logged_date: "2026-06-09", weight: 175.375, measurements: { waist: 81.28, calves: { mode: "sides", left: 36.5125 } },
  notes: "Original notes", logged_at: "2026-06-09T12:00:00.000Z", created_at: "2026-06-09T12:00:00.000Z", updated_at: "2026-06-09T12:00:00.000Z"
};
describe("body check-in form observations", () => {
  it("does not invent a weight or tape value for empty fields", () => {
    const draft = createBodyCheckInDraft("2026-10-09", { weight: "kg", circumference: "in" });
    expect(() => createBodyCheckInRequest(draft, requestId)).toThrow("Enter bodyweight or at least one tape measurement.");
    draft.fields.calves = { mode: "sides", value: "", left: "14,5", right: "" };
    expect(createBodyCheckInRequest(draft, requestId)).toMatchObject({ weight: "", measurements: { calves: { mode: "sides", left: 14.5 } } });
  });
  it("validates every entered tape value even when that section is collapsed", () => {
    const draft = createBodyCheckInDraft("2026-10-09", { weight: "kg", circumference: "in" });
    draft.weight = "80";
    draft.fields.waist.value = "not measured";
    expect(draft.tapeExpanded).toBe(false);
    expect(() => createBodyCheckInRequest(draft, requestId)).toThrow("Waist must be a number greater than zero.");
  });
  it("rejects invalid calendar dates and nonpositive observations without creating a payload", () => {
    const draft = createBodyCheckInDraft("2026-02-30", { weight: "kg", circumference: "in" });
    draft.weight = "80";
    expect(() => createBodyCheckInRequest(draft, requestId)).toThrow("real calendar date");
    draft.loggedDate = "2026-10-09"; draft.weight = "0";
    expect(() => createBodyCheckInRequest(draft, requestId)).toThrow("Bodyweight must be a number greater than zero.");
  });
  it("keeps a frozen full edit snapshot and unrounded input precision", () => {
    const draft = editedBodyCheckInDraft(row, { weight: "lb", circumference: "cm" });
    expect(draft.weight).toBe("175.375");
    expect(draft.fields.calves).toEqual({ mode: "sides", value: "", left: "36.5125", right: "" });
    const input = createBodyCheckInRequest(draft, requestId);
    expect(input.expected).toEqual(row);
    expect(input.expected).not.toBe(row);
    expect(input.measurements).toEqual(row.measurements);
  });
  it("keeps periodic tape recency independent of later weigh-ins and future observations", () => {
    const recent = { ...row, id: 2, logged_date: "2026-10-09", weight: 180, measurements: {} };
    const future = { ...row, id: 3, logged_date: "2026-12-09", weight: 200 };
    const recency = latestBodyObservations([future, recent, row], "2026-10-09");
    expect(recency.weight?.id).toBe(2);
    expect(recency.tapes.find((tape) => tape.definition.key === "waist")?.date).toBe("2026-06-09");
    expect(recency.tapes.find((tape) => tape.definition.key === "chest")?.date).toBeNull();
  });
  it("retains each side's recording date when only one side is measured later", () => {
    const bilateral = { ...row, measurements: { calves: { mode: "sides", left: 36, right: 37 } } } as BodyMeasurementLog;
    const later = { ...row, id: 2, logged_date: "2026-10-09", measurements: { calves: { mode: "sides", left: 38 } } } as BodyMeasurementLog;
    const recency = latestBodyObservations([later, bilateral], "2026-10-09");
    expect(recency.tapes.find(({ definition }) => definition.key === "calves")?.observations).toEqual([
      { channel: "left", checkInId: 2, date: "2026-10-09", valueCm: 38 },
      { channel: "right", checkInId: 1, date: "2026-06-09", valueCm: 37 }
    ]);
  });
});
