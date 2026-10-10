import { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { palette, styles } = useStyles();
  const content = <View style={styles.inner}>{children}</View>;

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          {...(Platform.OS === "ios" ? { keyboardDismissMode: "interactive" as const } : null)}
        >
          {content}
        </ScrollView>
      ) : content}
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.background
  },
  scroll: {
    paddingBottom: spacing.xxl,
    ...(Platform.OS === "web" ? { touchAction: "pan-y pinch-zoom" } : null)
  },
  inner: {
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.lg
  }
}));
