import { beforeEach, expect, it, vi } from "vitest";
const appearance = vi.hoisted(() => ({ scheme: "light" as "light" | "dark" | null }));
vi.mock("react-native", () => ({ useColorScheme: () => appearance.scheme }));
import { darkPalette, lightPalette } from "./theme";
import { createThemedStyles, useThemePalette } from "./themedStyles";

beforeEach(() => { appearance.scheme = "light"; });
it("follows system appearance including changes after the first render", () => {
  expect(useThemePalette()).toBe(lightPalette);
  appearance.scheme = "dark";
  expect(useThemePalette()).toBe(darkPalette);
  appearance.scheme = "light";
  expect(useThemePalette()).toBe(lightPalette);
  appearance.scheme = null;
  expect(useThemePalette()).toBe(lightPalette);
});
it("updates stylesheet colors with appearance without recreating cached style sets", () => {
  const factory = vi.fn((palette) => ({ panel: { backgroundColor: palette.surface, color: palette.ink } }));
  const useStyles = createThemedStyles(factory);
  const light = useStyles();
  appearance.scheme = "dark";
  const dark = useStyles();
  expect(dark.colorScheme).toBe("dark");
  expect(dark.styles.panel).toEqual({ backgroundColor: darkPalette.surface, color: darkPalette.ink });
  expect(dark.styles).not.toBe(light.styles);
  appearance.scheme = "light";
  expect(useStyles().styles).toBe(light.styles);
  expect(factory).toHaveBeenCalledTimes(2);
});
function luminance(hex: string) {
  const values = hex.slice(1).match(/.{2}/g)!.map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
it("keeps normal text, statuses and primary actions readable in both themes", () => {
  for (const palette of [lightPalette, darkPalette]) {
    for (const surface of [palette.background, palette.surface, palette.surfaceAlt]) {
      for (const ink of [palette.ink, palette.muted, palette.warning, palette.danger, palette.success]) {
        expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(palette.surface, palette.accent)).toBeGreaterThanOrEqual(4.5);
  }
});
