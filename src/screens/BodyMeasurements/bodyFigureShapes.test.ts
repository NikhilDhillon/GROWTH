import { describe, expect, it } from "vitest";
import { femaleBodyFigure, maleBodyFigure, type BodyFigureRegion } from "./bodyFigureShapes";

const regions: BodyFigureRegion[] = ["chest", "thinnest_waist", "waist", "abdomen", "arm", "forearm", "thigh", "calves"];
const startX = (d: string) => Number(/^[Mm]\s*(-?[\d.]+)/.exec(d)?.[1]);

describe.each([["male", maleBodyFigure], ["female", femaleBodyFigure]] as const)("%s figure", (_name, figure) => {
  it("draws every measured region on both sides", () => {
    for (const region of regions) for (const side of ["left", "right"] as const) {
      expect(figure.shapes.some((shape) => shape.region === region && shape.side === side), `${region} ${side}`).toBe(true);
    }
  });
  it("puts the person's left on the right of the image", () => {
    for (const shape of figure.shapes.filter((item) => item.region === "arm" || item.region === "forearm" || item.region === "thigh" || item.region === "calves" || item.region === "chest")) {
      if (shape.side === "left") expect(startX(shape.d)).toBeGreaterThan(figure.midX);
      if (shape.side === "right") expect(startX(shape.d)).toBeLessThan(figure.midX);
    }
    for (const limb of Object.values(figure.limbs)) {
      expect(limb.left.x).toBeGreaterThan(figure.midX);
      expect(limb.right.x).toBeLessThan(figure.midX);
    }
  });
  it("stacks the torso measurements from the top down", () => {
    const { chest, thinnest_waist, waist, abdomen } = figure.torso;
    expect(chest).toBeLessThan(thinnest_waist);
    expect(thinnest_waist).toBeLessThan(waist);
    expect(waist).toBeLessThan(abdomen);
  });
});
