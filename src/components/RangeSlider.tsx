import { useRef } from "react";
import { GestureResponderEvent, PanResponder, Platform, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { rangeStopAt } from "@/utils/chartRange";
import { tickHaptic } from "@/utils/haptics";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";

export type RangeSliderOption<T extends string> = { key: T; short: string; label: string; marked: boolean };

const thumbSize = 26;
const inset = thumbSize / 2;

/** One thumb across every range. Drag it, or tap anywhere on the track to jump there. */
export function RangeSlider<T extends string>({ options, value, onChange, accessibilityLabel }: {
  options: ReadonlyArray<RangeSliderOption<T>>;
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const { styles } = useStyles();
  const track = useRef<View>(null);
  const trackLeft = useRef(0);
  const trackWidth = useRef(0);
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  const last = options.length - 1;
  const percent = (stop: number) => `${last > 0 ? (stop / last) * 100 : 0}%` as const;
  const current = options[index];
  const measure = () => track.current?.measureInWindow((x, _y, width) => { trackLeft.current = x; trackWidth.current = width; });

  function select(stop: number) {
    const next = options[Math.min(last, Math.max(0, stop))];
    if (!next || next.key === latest.current.value) return;
    tickHaptic();
    latest.current.value = next.key;
    latest.current.onChange(next.key);
  }
  const latest = useRef({ value, onChange, select });
  latest.current = { value, onChange, select };

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => { measure(); moveTo(event); },
    onPanResponderMove: (event) => moveTo(event),
    onPanResponderTerminationRequest: () => false
  })).current;

  function moveTo(event: GestureResponderEvent) {
    const native = event.nativeEvent as unknown as Record<string, any>;
    const touch = native.touches?.[0] ?? native.changedTouches?.[0];
    const x = [touch?.clientX, native.clientX, touch?.pageX, native.pageX].find((value) => typeof value === "number");
    if (x === undefined) return;
    latest.current.select(rangeStopAt(x - trackLeft.current, trackWidth.current, inset, optionsCount.current));
  }
  const optionsCount = useRef(options.length);
  optionsCount.current = options.length;

  const webKeys = Platform.OS === "web" ? {
    focusable: true,
    "aria-valuetext": current?.label,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      select(index + (event.key === "ArrowRight" ? 1 : -1));
    }
  } : {};

  return (
    <View style={styles.wrap}>
      <Body accessibilityLiveRegion="polite" style={styles.label}>{current?.label}</Body>
      <View
        ref={track}
        onLayout={measure}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: current?.label }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => select(index + (event.nativeEvent.actionName === "increment" ? 1 : -1))}
        style={styles.track}
        {...responder.panHandlers}
        {...webKeys}
      >
        <View pointerEvents="none" style={styles.inner}>
          <View style={styles.rail} />
          <View style={[styles.fill, { width: percent(index) }]} />
          {options.map((option, stop) => <View key={option.key} style={[styles.tick, { left: percent(stop) }, stop <= index && styles.tickPassed]} />)}
          <View style={[styles.thumb, { left: percent(index) }]} />
        </View>
      </View>
      <View pointerEvents="none" style={styles.marks}>
        {options.map((option, stop) => option.marked ? <Body key={option.key} numberOfLines={1} style={[styles.mark, { left: percent(stop) }, stop === index && styles.markActive]}>{option.short}</Body> : null)}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  wrap: { gap: 2 },
  label: { color: palette.ink, fontSize: 14, fontWeight: "700", textAlign: "center", paddingBottom: spacing.xs },
  track: { height: 36, justifyContent: "center", ...(Platform.OS === "web" ? { cursor: "pointer", touchAction: "pan-y", userSelect: "none" } as object : {}) },
  inner: { position: "absolute", left: inset, right: inset, top: 0, bottom: 0, justifyContent: "center" },
  rail: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: palette.border },
  fill: { position: "absolute", left: 0, height: 4, borderRadius: 2, backgroundColor: palette.ink },
  tick: { position: "absolute", width: 6, height: 6, marginLeft: -3, borderRadius: 3, backgroundColor: palette.border },
  tickPassed: { backgroundColor: palette.ink },
  thumb: { position: "absolute", width: thumbSize, height: thumbSize, marginLeft: -inset, borderRadius: inset, backgroundColor: palette.ink, borderWidth: 3, borderColor: palette.surface },
  marks: { height: 18, marginHorizontal: inset },
  mark: { position: "absolute", width: 36, marginLeft: -18, textAlign: "center", color: palette.muted, fontSize: 12, lineHeight: 16 },
  markActive: { color: palette.ink, fontWeight: "700" }
}));
