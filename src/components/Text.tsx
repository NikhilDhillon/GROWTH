import { ReactNode } from "react";
import { StyleSheet, Text as NativeText, TextProps } from "react-native";

import { palette } from "@/utils/theme";

export function Title({ children, style, ...props }: TextProps & { children: ReactNode }) {
  return <NativeText {...props} style={[styles.title, style]}>{children}</NativeText>;
}

export function SectionTitle({ children, style, ...props }: TextProps & { children: ReactNode }) {
  return <NativeText {...props} style={[styles.sectionTitle, style]}>{children}</NativeText>;
}

export function Body({ children, style, ...props }: TextProps & { children: ReactNode }) {
  return <NativeText {...props} style={[styles.body, style]}>{children}</NativeText>;
}

export function Label({ children, style, ...props }: TextProps & { children: ReactNode }) {
  return <NativeText {...props} style={[styles.label, style]}>{children}</NativeText>;
}

const styles = StyleSheet.create({
  title: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 0
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  body: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20
  },
  label: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  }
});
