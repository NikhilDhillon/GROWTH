import { describe, expect, it } from "vitest";

import { angleAt, angleDelta, dialPoint, flowDial, maxRoll, ringAt, rolledValue, settledRoll } from "@/services/workouts/flowDial";

describe("flow dial", () => {
  it("finds the ring under the thumb, leaving the hub to Done", () => {
    const { reps, weight } = flowDial.rings;
    expect(ringAt(flowDial.cx, flowDial.cy)).toBeNull();
    expect(ringAt(flowDial.cx, flowDial.cy - (reps.r0 + reps.r1) / 2)).toBe("reps");
    expect(ringAt(flowDial.cx, flowDial.cy - (weight.r0 + weight.r1) / 2)).toBe("weight");
    expect(ringAt(flowDial.cx, flowDial.cy - weight.r1 - 40)).toBeNull();
  });

  it("measures angles clockwise from 12 o'clock", () => {
    const top = dialPoint(100, 0), right = dialPoint(100, 90);
    expect(angleAt(top.x, top.y)).toBeCloseTo(0, 6);
    expect(angleAt(right.x, right.y)).toBeCloseTo(90, 6);
  });

  it("takes the short way round, so passing 6 o'clock is a small turn", () => {
    expect(angleDelta(170, -170)).toBe(20);
    expect(angleDelta(-170, 170)).toBe(-20);
    expect(angleDelta(10, 40)).toBe(30);
  });

  it("rolls like a wheel: clockwise brings lower values to the marker, anticlockwise higher", () => {
    const step = flowDial.rings.reps.degreesPerStep;
    expect(rolledValue(8, step * 2.2, "reps", 1, 1)).toBe(6);
    expect(rolledValue(8, -step * 2.2, "reps", 1, 1)).toBe(10);
    expect(rolledValue(8, step * 0.4, "reps", 1, 1)).toBe(8);
    expect(rolledValue(20, -flowDial.rings.weight.degreesPerStep * 3, "weight", 2.5, 0)).toBe(27.5);
  });

  it("stops at the minimum and settles on the nearest value", () => {
    const step = flowDial.rings.reps.degreesPerStep;
    expect(maxRoll(3, "reps", 1, 1)).toBe(step * 2);
    expect(rolledValue(3, maxRoll(3, "reps", 1, 1) + step * 3, "reps", 1, 1)).toBe(1);
    expect(settledRoll(step * 1.4, "reps")).toBe(step);
    expect(settledRoll(-step * 1.6, "reps")).toBe(-step * 2);
    expect(settledRoll(step * 0.2, "reps")).toBe(0);
  });
});
