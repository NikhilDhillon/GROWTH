import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, ThemePalette } from "@/utils/theme";

export function useThemePalette(): ThemePalette {
  return useColorScheme() === "dark" ? darkPalette : lightPalette;
}

/** Both immutable style sets are created once; mounted consumers follow Appearance updates. */
export function createThemedStyles<T>(factory: (palette: ThemePalette) => T) {
  const lightStyles = factory(lightPalette);
  const darkStyles = factory(darkPalette);
  return function useStyles() {
    const palette = useThemePalette();
    return { palette, styles: palette === darkPalette ? darkStyles : lightStyles, colorScheme: palette === darkPalette ? "dark" as const : "light" as const };
  };
}

