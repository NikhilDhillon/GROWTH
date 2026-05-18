import { ReactNode } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { palette, spacing } from "@/utils/theme";

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.lg,
    gap: spacing.md
  }
});
