import { ReactNode } from "react";
import { StyleSheet, Text as NativeText, TextProps } from "react-native";

import { createThemedStyles } from "@/utils/themedStyles";

export function Title({ children, style, ...props }: TextProps & { children: ReactNode }) {
  const { palette, styles } = useStyles();
  return <NativeText {...props} style={[styles.title, style]}>{children}</NativeText>;
}

export function SectionTitle({ children, style, ...props }: TextProps & { children: ReactNode }) {
  const { palette, styles } = useStyles();
  return <NativeText {...props} style={[styles.sectionTitle, style]}>{children}</NativeText>;
}

export function Body({ children, style, ...props }: TextProps & { children: ReactNode }) {
  const { palette, styles } = useStyles();
  return <NativeText {...props} style={[styles.body, style]}>{children}</NativeText>;
}

export function Label({ children, style, ...props }: TextProps & { children: ReactNode }) {
  const { palette, styles } = useStyles();
  return <NativeText {...props} style={[styles.label, style]}>{children}</NativeText>;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  title: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.8
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "700"
  },
  body: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20
  },
  label: {
    color: palette.muted,
    fontSize: 11,
    letterSpacing: 1.1,
    fontWeight: "700",
    textTransform: "uppercase"
  }
}));
