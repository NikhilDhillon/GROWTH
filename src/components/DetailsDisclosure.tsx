import { ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

/** Secondary explanations stay available without competing with the current task. */
export function DetailsDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const { palette, styles } = useStyles();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)} style={pressableFeedback(styles.toggle)}>
        <Body style={styles.title}>{title}</Body>
        <Body style={styles.indicator}>{expanded ? "−" : "+"}</Body>
      </Pressable>
      {expanded ? <View style={styles.details}>{children}</View> : null}
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  container: { borderTopWidth: 1, borderTopColor: palette.border },
  toggle: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { flex: 1, minWidth: 0, color: palette.accent, fontWeight: "700", fontSize: 13 },
  indicator: { color: palette.accent, fontSize: 22, width: 24, textAlign: "center" },
  details: { gap: spacing.sm, paddingBottom: spacing.md }
}));
