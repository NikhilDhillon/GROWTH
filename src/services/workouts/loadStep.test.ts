import { describe, expect, it } from "vitest";

import { createMachineProfile } from "@/constants/machineProfiles";
import { flowLoadStep, learnedLoadStep, loadStepChoices, loadStepKey } from "@/services/workouts/loadStep";

const stack = (stackUnit: "lb" | "kg", increment: number) => createMachineProfile({ label: "Stack", machineType: "single_pulley", stackUnit, increment, minLoad: 0, maxLoad: 200, pulleyRatio: "unknown" });

describe("the weight dial's step", () => {
  it("is remembered per exercise, machine and unit", () => {
    expect(loadStepKey(4, "cable-left", "kg")).toBe("4|cable-left|kg");
    expect(loadStepKey(4, null, "lb")).toBe("4||lb");
  });

  it("uses your choice, then the machine's increment, then the finest jump you have used on it, then a plate step", () => {
    expect(flowLoadStep({ chosen: 2.5, unitSystem: "lb", profile: stack("lb", 10), machineLoads: [100, 110] })).toBe(2.5);
    expect(flowLoadStep({ unitSystem: "lb", profile: stack("lb", 10), machineLoads: [100, 105] })).toBe(10);
    // A stack in the other unit says nothing about the step shown.
    expect(flowLoadStep({ unitSystem: "kg", profile: stack("lb", 10), machineLoads: [14, 21, 28] })).toBe(7);
    expect(flowLoadStep({ unitSystem: "kg", profile: null })).toBe(2.5);
    expect(flowLoadStep({ unitSystem: "lb", profile: null, machineLoads: [] })).toBe(5);
  });

  it("learns a step only from at least two loads, rounding off unit conversions", () => {
    expect(learnedLoadStep([17.5, 20, 22.5, 20])).toBe(2.5);
    expect(learnedLoadStep([44.96, 49.96, 55.01])).toBe(5);
    expect(learnedLoadStep([100])).toBeNull();
    expect(learnedLoadStep([100, 100.1])).toBeNull();
  });

  it("offers common steps in each unit", () => {
    expect(loadStepChoices("lb")).toContain(2.5);
    expect(loadStepChoices("kg")).toContain(1.25);
  });
});
