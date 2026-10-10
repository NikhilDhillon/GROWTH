import { ReactNode } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { palette, styles } = useStyles();
  return <View style={[styles.panel, style]}>{children}</View>;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  panel: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.lg,
    gap: spacing.md
  }
}));
