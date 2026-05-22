import DateTimePicker from "@react-native-community/datetimepicker";
import { CalendarDays } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { dateToIso, formatShortDate, isoToDate } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";

export function DatePickerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const date = isoToDate(value);

  if (Platform.OS === "web") {
    return (
      <View style={styles.webField}>
        <CalendarDays size={18} color={palette.ink} />
        <input
          aria-label="Workout date"
          style={webInputStyle}
          type="date"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable accessibilityLabel="Choose workout date" hitSlop={touchHitSlop} onPress={() => setShowPicker(true)} style={pressableFeedback(styles.button)}>
        <CalendarDays size={18} color={palette.ink} />
        <Body style={styles.buttonText}>{formatShortDate(value)}</Body>
      </Pressable>
      {showPicker ? (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(_, selectedDate) => {
            if (Platform.OS !== "ios") setShowPicker(false);
            if (selectedDate) onChange(dateToIso(selectedDate));
          }}
        />
      ) : null}
    </View>
  );
}

const webInputStyle = {
  flex: 1,
  minHeight: 44,
  borderWidth: 0,
  backgroundColor: "transparent",
  color: palette.ink,
  fontWeight: "700",
  fontSize: 14,
  outlineStyle: "none"
} as const;

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm
  },
  button: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...fastTouchStyle
  },
  buttonText: {
    color: palette.ink,
    fontWeight: "800"
  },
  webField: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...fastTouchStyle
  }
});
