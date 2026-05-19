import { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { palette, spacing } from "@/utils/theme";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const content = <View style={styles.inner}>{children}</View>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {scroll ? <ScrollView contentContainerStyle={styles.scroll}>{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.background
  },
  scroll: {
    paddingBottom: 116
  },
  inner: {
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.lg
  }
});
