import { describe, expect, it } from "vitest";

import { flowLoadGhost, standingPlates } from "@/services/workouts/loadGhost";
import type { MachineProfile } from "@/types";

const timestamp = "2026-10-25T12:00:00.000Z";
const cable = (patch: Partial<MachineProfile>): MachineProfile => ({ id: "cable", label: "Cable", machineType: "cable_stack", stackUnit: "lb", increment: 5,
  minLoad: 0, maxLoad: 0, pulleyRatio: "unknown", exerciseIds: [7], createdAt: timestamp, updatedAt: timestamp, ...patch } as MachineProfile);

describe("flow load picture", () => {
  it("shows the plate calculator's bar for barbell lifts, in pounds only", () => {
    expect(flowLoadGhost({ exerciseName: "Barbell Bench Press", loadType: "external", unitSystem: "lb", profile: null })).toEqual({ kind: "barbell", barWeight: 45 });
    expect(flowLoadGhost({ exerciseName: "Barbell Bench Press", loadType: "external", unitSystem: "lb", profile: null, barWeight: 35 })).toEqual({ kind: "barbell", barWeight: 35 });
    expect(flowLoadGhost({ exerciseName: "Barbell Bench Press", loadType: "external", unitSystem: "kg", profile: null })).toBeNull();
  });

  it("shows a stack of about 5 kg (10 lb) plates for machines and cables", () => {
    expect(flowLoadGhost({ exerciseName: "Cable Fly", loadType: "machine_stack", unitSystem: "lb", profile: null })).toEqual({ kind: "stack", plateSize: 10, plates: 12 });
    expect(flowLoadGhost({ exerciseName: "Cable Fly", loadType: "machine_stack", unitSystem: "kg", profile: null })).toEqual({ kind: "stack", plateSize: 5, plates: 12 });
  });

  it("uses a machine tag's increment only when it is a whole plate, and its maximum for the height", () => {
    expect(flowLoadGhost({ exerciseName: "Cable Fly", loadType: "machine_stack", unitSystem: "lb", profile: cable({ increment: 5, maxLoad: 200 }) }))
      .toEqual({ kind: "stack", plateSize: 10, plates: 20 });
    expect(flowLoadGhost({ exerciseName: "Cable Fly", loadType: "machine_stack", unitSystem: "lb", profile: cable({ increment: 15, maxLoad: 150 }) }))
      .toEqual({ kind: "stack", plateSize: 15, plates: 10 });
    expect(flowLoadGhost({ exerciseName: "Cable Fly", loadType: "machine_stack", unitSystem: "lb", profile: cable({ stackUnit: "plate", increment: 1, maxLoad: 16 }) }))
      .toEqual({ kind: "stack", plateSize: 1, plates: 16 });
  });

  it("shows added weight as standing plates for weighted dips and pull-ups, in pounds only", () => {
    expect(flowLoadGhost({ exerciseName: "Weighted Dip", loadType: "bodyweight_plus_load", unitSystem: "lb", profile: null })).toEqual({ kind: "plates" });
    expect(flowLoadGhost({ exerciseName: "Weighted Dip", loadType: "bodyweight_plus_load", unitSystem: "kg", profile: null })).toBeNull();
    expect(standingPlates(90)).toEqual([45, 45]);
    expect(standingPlates(115)).toEqual([45, 45, 25]);
    expect(standingPlates(32.5)).toEqual([25, 5]);
    expect(standingPlates(0)).toEqual([]);
    expect(standingPlates(500)).toHaveLength(6);
  });

  it("shows nothing for dumbbells, assisted and plain bodyweight work", () => {
    expect(flowLoadGhost({ exerciseName: "Dumbbell Curl", loadType: "external", unitSystem: "lb", profile: null })).toBeNull();
    expect(flowLoadGhost({ exerciseName: "Assisted Dip", loadType: "bodyweight_minus_assistance", unitSystem: "lb", profile: null })).toBeNull();
  });
});
