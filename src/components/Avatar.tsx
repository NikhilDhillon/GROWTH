import { StyleSheet, Text, View } from "react-native";

import { createThemedStyles } from "@/utils/themedStyles";

/** Initials in a circle: identifies the signed-in account without reading as a button. */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const { styles } = useStyles();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Signed in as ${name}`}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text allowFontScaling={false} style={[styles.initials, { fontSize: Math.round(size * 0.4) }]}>{initials(name)}</Text>
    </View>
  );
}

export function initials(name: string) {
  const words = name.trim().split(/[\s._@-]+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 1) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ink
  },
  initials: {
    color: palette.surface,
    fontWeight: "800",
    letterSpacing: 0.3
  }
}));
