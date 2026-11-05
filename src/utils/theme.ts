/** Neutral surfaces and monochrome actions, with semantic colors for data/status. */
export const lightPalette = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f7f7f8",
  ink: "#0d0d0d",
  muted: "#616161",
  border: "#e5e5e5",
  accent: "#171717",
  accentSoft: "#ececec",
  warning: "#925500",
  danger: "#c03936",
  success: "#177245",
  blue: "#2563eb",
  overlay: "rgba(0, 0, 0, 0.4)",
  grew: "#2f7fe0",
  shrank: "#e2662a",
  steady: "#8e8e93",
  muscle: "#e4e4e6",
  muscleHair: "#c9c9cc",
  muscleEdge: "#b5b5b8"
};
export type ThemePalette = typeof lightPalette;
export const darkPalette: ThemePalette = {
  background: "#212121",
  surface: "#2f2f2f",
  surfaceAlt: "#3a3a3a",
  ink: "#ececec",
  muted: "#b4b4b4",
  border: "#474747",
  accent: "#ececec",
  accentSoft: "#383838",
  warning: "#f6c66e",
  danger: "#ff8a84",
  success: "#7bcf9a",
  blue: "#91b6ff",
  overlay: "rgba(0, 0, 0, 0.64)",
  grew: "#2f7fe0",
  shrank: "#e2662a",
  steady: "#c4c4c9",
  muscle: "#4a4a4c",
  muscleHair: "#3b3b3d",
  muscleEdge: "#1f1f20"
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const muscles = ["Chest", "Back", "Shoulders", "Traps", "Biceps", "Triceps", "Legs", "Core", "Forearms"] as const;
