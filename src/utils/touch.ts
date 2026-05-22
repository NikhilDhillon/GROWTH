import { Platform, PressableStateCallbackType, ViewStyle } from "react-native";

export const touchHitSlop = { top: 8, right: 8, bottom: 8, left: 8 } as const;

export const fastTouchStyle = Platform.select({
  web: {
    cursor: "pointer",
    touchAction: "manipulation",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent"
  } as ViewStyle,
  default: {} as ViewStyle
});

export function pressableFeedback<T extends ViewStyle>(
  baseStyle: T | Array<T | false | null | undefined>,
  pressedStyle: ViewStyle = defaultPressedStyle
) {
  return ({ pressed }: PressableStateCallbackType) => [baseStyle, fastTouchStyle, pressed && pressedStyle];
}

const defaultPressedStyle: ViewStyle = {
  opacity: 0.82,
  transform: [{ scale: 0.98 }]
};
