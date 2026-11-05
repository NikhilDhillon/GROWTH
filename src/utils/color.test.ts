import { expect, it } from "vitest";
import { mixHexColors } from "./color";

it("blends between two colours", () => {
  expect(mixHexColors("#000000", "#ffffff", 0)).toBe("#000000");
  expect(mixHexColors("#000000", "#ffffff", 1)).toBe("#ffffff");
  expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(mixHexColors("#e4e4e6", "#2f7fe0", 0.3)).toBe("#aec6e4");
});
