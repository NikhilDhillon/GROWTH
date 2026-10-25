import { describe, expect, it } from "vitest";

import { plannedSuggestion } from "@/services/workouts/setCapture";
import { expectedReps, flowHistoryForRow, nextFlowRow, plannedFlowLoad, RepPredictionInput } from "@/services/workouts/setPrediction";

const fly: RepPredictionInput = { load: 70, scaleByLoad: true, previous: { reps: 12, load: 70 }, previousBefore: null, loggedBefore: null };

describe("expected reps", () => {
  it("repeat last session's set at the same load", () => {
    expect(expectedReps(fly)).toBe(12);
  });

  it("drop at a heavier load through the same estimated 1RM", () => {
    expect(expectedReps({ ...fly, load: 80 })).toBeCloseTo(30 * (70 * (1 + 12 / 30) / 80 - 1), 6);
    expect(expectedReps({ ...fly, load: 80, scaleByLoad: false })).toBe(12);
  });

  it("follow today's previous set minus your usual drop between those sets", () => {
    expect(expectedReps({ ...fly, previous: { reps: 10, load: 70 }, previousBefore: { reps: 12, load: 70 }, loggedBefore: { reps: 13, load: 70 } })).toBe(11);
    expect(expectedReps({ ...fly, previous: null, loggedBefore: { reps: 8, load: 70 } })).toBe(7);
  });

  it("fall back to the target, then to ten", () => {
    expect(expectedReps({ ...fly, previous: null, targetReps: 6 })).toBe(6);
    expect(expectedReps({ ...fly, previous: null })).toBe(10);
  });
});

describe("flow rows", () => {
  const rows = [
    { reps: "10", weight: "45", isWarmup: true },
    { reps: "12", weight: "70" },
    { reps: "", weight: "70" },
    { reps: "", weight: "" }
  ];

  it("logs the first row without reps", () => {
    expect(nextFlowRow(rows)).toBe(2);
    expect(nextFlowRow(rows.slice(0, 2))).toBeNull();
  });

  it("logs over a prefilled suggestion, which never counts as today's previous set", () => {
    const suggested = [{ reps: "", weight: "" }, plannedSuggestion({ reps: "8", weight: "210" }), plannedSuggestion({ reps: "8", weight: "210" })];
    expect(nextFlowRow(suggested)).toBe(0);
    expect(nextFlowRow([{ reps: "7", weight: "215" }, ...suggested.slice(1)])).toBe(1);
    expect(flowHistoryForRow([{ reps: "", weight: "" }, ...suggested.slice(1)], 2, []).loggedBefore).toBeNull();
  });

  it("matches working rows to last session's working sets, skipping warm-ups", () => {
    expect(flowHistoryForRow(rows, 2, [{ reps: 12, load: 70 }, { reps: 11, load: 70 }])).toEqual({
      loggedBefore: { reps: 12, load: 70 }, previous: { reps: 11, load: 70 }, previousBefore: { reps: 12, load: 70 }
    });
    expect(flowHistoryForRow(rows, 0, [{ reps: 12, load: 70 }])).toEqual({ loggedBefore: null, previous: null, previousBefore: null });
  });

  it("carries the load down from the row above of the same kind", () => {
    expect(plannedFlowLoad(rows, 3)).toBe(70);
    expect(plannedFlowLoad([{ reps: "", weight: "45", isWarmup: true }, { reps: "", weight: "" }], 1, 60)).toBe(60);
    expect(plannedFlowLoad([{ reps: "", weight: "" }], 0)).toBeNull();
  });
});
