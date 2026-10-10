import type { ComponentType } from "react";
import { ActivityIndicator, Pressable, StyleSheet, StyleProp, View, ViewStyle } from "react-native";

import { Body } from "@/components/Text";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type IconComponent = ComponentType<{ color: string; size: number }>;

/**
 * Filled, centered actions so controls never read as text inputs. Inputs keep the
 * outlined surface look; buttons are always tinted (or plain text for ghost).
 */
export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "md",
  icon: Icon,
  trailingIcon: TrailingIcon,
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  style
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconComponent;
  trailingIcon?: IconComponent;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette, styles } = useStyles();
  const color = variant === "primary" ? palette.surface : variant === "danger" ? palette.danger : palette.ink;
  const iconSize = size === "sm" ? 15 : 17;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      hitSlop={size === "sm" ? touchHitSlop : undefined}
      onPress={onPress}
      style={pressableFeedback([
        styles.base,
        styles[size],
        styles[variant],
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.disabled,
        style as ViewStyle
      ])}
    >
      {loading ? <ActivityIndicator color={color} /> : Icon ? <Icon size={iconSize} color={color} /> : null}
      <Body numberOfLines={1} style={[styles.label, size === "sm" && styles.labelSmall, { color }]}>{label}</Body>
      {TrailingIcon ? <View style={styles.trailing}><TrailingIcon size={iconSize} color={color} /></View> : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    alignSelf: "flex-start"
  },
  sm: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: 10 },
  md: { minHeight: 44, paddingHorizontal: spacing.lg },
  lg: { minHeight: 52, paddingHorizontal: spacing.xl },
  primary: { backgroundColor: palette.ink },
  secondary: { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
  ghost: { backgroundColor: "transparent", paddingHorizontal: spacing.sm },
  danger: { backgroundColor: "transparent", borderColor: palette.border },
  fullWidth: { alignSelf: "stretch" },
  disabled: { opacity: 0.45 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  labelSmall: { fontSize: 13, lineHeight: 18 },
  trailing: { marginLeft: -2 }
}));
