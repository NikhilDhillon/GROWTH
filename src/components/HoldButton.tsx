import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Body } from "@/components/Text";
import { confirmHaptic } from "@/utils/haptics";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";

/**
 * A destructive action you hold to confirm: the button fills while you hold
 * and fires when it is full; letting go early does nothing.
 */
export function HoldButton({ label, onConfirm, disabled = false, holdMs = 900 }: { label: string; onConfirm: () => void; disabled?: boolean; holdMs?: number }) {
  const { styles } = useStyles();
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function start() {
    const started = Date.now();
    const run = () => {
      const filled = Math.min(1, (Date.now() - started) / holdMs);
      setProgress(filled);
      frame.current = filled < 1 ? requestAnimationFrame(run) : null;
    };
    frame.current = requestAnimationFrame(run);
  }

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setProgress(0);
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Hold to confirm" disabled={disabled}
      onPressIn={start} onPressOut={stop} delayLongPress={holdMs} onLongPress={() => { stop(); confirmHaptic(); onConfirm(); }}
      style={[styles.button, disabled && styles.disabled]}>
      <View pointerEvents="none" style={[styles.fill, { width: `${progress * 100}%` }]} />
      <Body style={styles.text}>{progress > 0 ? "Keep holding…" : label}</Body>
    </Pressable>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  button: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, overflow: "hidden" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: palette.danger, opacity: 0.22 },
  text: { color: palette.danger, fontWeight: "800" },
  disabled: { opacity: 0.45 }
}));
