import { describe, expect, it } from "vitest";
import { getScoringEligibility, parseObservedSets } from "./observations";
import { calculateSessionPerformance } from "@/services/strength/strengthService";

describe("observations exist independently of prescriptions and scoring", () => {
  it("records one warm-up without creating points or confirmation proof", () => {
    const input = [{ reps: "8", weight: "20", isWarmup: true }];
    const result = parseObservedSets(input, "kg", "external");
    expect(result[0].weight).toBeCloseTo(44.09245);
    expect(result[0]).not.toHaveProperty("observationConfirmation");
    expect(getScoringEligibility(result).eligible).toBe(false);
    expect(calculateSessionPerformance(result.map((set, index) => ({ ...set, set_number: index + 1, is_warmup: set.isWarmup })))).toBeNull();
    expect(input).toEqual([{ reps: "8", weight: "20", isWarmup: true }]);
  });
  it("records one working set even though the current metric cannot score it", () => {
    const sets = parseObservedSets([{ reps: "5", weight: "100" }], "lb", "external");
    expect(sets).toEqual([{ reps: 5, weight: 100, isWarmup: false }]);
    expect(getScoringEligibility(sets).eligible).toBe(false);
    expect(calculateSessionPerformance([{ reps: 5, weight: 100, set_number: 1 }])).toBeNull();
  });
  it("requires explicit zero for bodyweight load and assistance", () => {
    expect(() => parseObservedSets([{ reps: "5", weight: "" }], "lb", "bodyweight_plus_load")).toThrow(/both reps and load/);
    expect(parseObservedSets([{ reps: "5", weight: "0" }], "lb", "bodyweight_minus_assistance")[0].weight).toBe(0);
  });
  it.each([{ reps: "", weight: "20" }, { reps: "0", weight: "20" }, { reps: "1.5", weight: "20" }, { reps: "5", weight: "-2" }, { reps: "5", weight: "Infinity" }])("rejects partial or invalid recorded inputs %o", (set) => {
    expect(() => parseObservedSets([set], "lb", "external")).toThrow();
  });
  it("ignores an entirely blank spare row, but never a partial performed row", () => {
    expect(parseObservedSets([{ reps: "5", weight: "20" }, { reps: "", weight: "" }], "lb", "external")).toHaveLength(1);
    expect(() => parseObservedSets([{ reps: "5", weight: "20" }, { reps: "5", weight: "" }], "lb", "external")).toThrow();
  });
});
