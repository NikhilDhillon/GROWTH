import { Pressable, StyleSheet, View } from "react-native";

import { createThemedStyles } from "@/utils/themedStyles";
import { fastTouchStyle, pressableFeedback, touchHitSlop } from "@/utils/touch";
import { createEmptyPlateCounts } from "@/utils/workout";
import { plateWeights, PlateWeight } from "@/constants/plates";

export { plateWeights } from "@/constants/plates";
export type { PlateWeight } from "@/constants/plates";
export type PlateCounts = Record<PlateWeight, number>;

export const plateVisuals: Record<PlateWeight, { backgroundColor: string; height: number; width: number }> = {
  45: { backgroundColor: "#2563eb", height: 34, width: 8 },
  35: { backgroundColor: "#eab308", height: 30, width: 8 },
  25: { backgroundColor: "#16a34a", height: 26, width: 7 },
  10: { backgroundColor: "#64748b", height: 21, width: 6 },
  5: { backgroundColor: "#dc2626", height: 17, width: 5 }
};

/** A barbell drawn with the app's plate colours (or one tint); counts are plates per side. */
export function LoadedBar({
  counts,
  large = false,
  tint,
  onPlatePress
}: {
  counts: PlateCounts;
  large?: boolean;
  /** Draws every part in this colour, e.g. for a faded silhouette. */
  tint?: string;
  onPlatePress?: (plate: PlateWeight) => void;
}) {
  const { palette, styles } = useStyles();
  function renderPlate(side: "left" | "right", plate: PlateWeight, index: number) {
    const plateView = <View style={[styles.plate, plateVisuals[plate], large && styles.plateLarge, tint ? { backgroundColor: tint } : null]} />;
    if (!onPlatePress) return <View key={`${side}-${plate}-${index}`}>{plateView}</View>;
    return (
      <Pressable
        key={`${side}-${plate}-${index}`}
        accessibilityLabel={`Remove ${plate} lb plate from bar`}
        hitSlop={touchHitSlop}
        onPress={() => onPlatePress(plate)}
        style={pressableFeedback(styles.loadedPlateHandle)}
      >
        {plateView}
      </Pressable>
    );
  }

  return (
    <View style={[styles.loadedBar, large && styles.loadedBarLarge]}>
      <View style={[styles.plateStack, styles.plateStackLeft]}>
        {[...plateWeights].reverse().flatMap((plate) => plateCopies(counts[plate]).map((_, index) => renderPlate("left", plate, index)))}
      </View>
      <View style={[styles.sleeve, tint ? { backgroundColor: tint } : null]} />
      <View style={[styles.shaft, large && styles.shaftLarge, tint ? { backgroundColor: tint, opacity: 0.8 } : null]} />
      <View style={[styles.sleeve, tint ? { backgroundColor: tint } : null]} />
      <View style={[styles.plateStack, styles.plateStackRight]}>
        {plateWeights.flatMap((plate) => plateCopies(counts[plate]).map((_, index) => renderPlate("right", plate, index)))}
      </View>
    </View>
  );
}

/** Plates per side for a target total, largest first. */
export function calculatePlateCounts(totalLoad: string, currentBarWeight: string) {
  let remainingPerSide = Math.max(0, (parseLoad(totalLoad) - parseLoad(currentBarWeight)) / 2);
  return plateWeights.reduce<PlateCounts>((counts, plate) => {
    const count = Math.floor((remainingPerSide + Number.EPSILON) / plate);
    counts[plate] = count;
    remainingPerSide -= count * plate;
    return counts;
  }, createEmptyPlateCounts());
}

export function parseLoad(value: string) {
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function plateCopies(count: number) {
  return Array.from({ length: Math.min(5, Math.max(0, Number(count) || 0)) });
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  loadedBar: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center"
  },
  loadedBarLarge: {
    minHeight: 62
  },
  plateStack: {
    minWidth: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 1
  },
  plateStackLeft: {
    justifyContent: "flex-end"
  },
  plateStackRight: {
    justifyContent: "flex-start"
  },
  plate: {
    borderRadius: 2
  },
  plateLarge: {
    transform: [{ scaleY: 1.18 }]
  },
  loadedPlateHandle: {
    borderRadius: 4,
    ...fastTouchStyle
  },
  sleeve: {
    width: 10,
    height: 8,
    backgroundColor: palette.ink
  },
  shaft: {
    width: 44,
    height: 5,
    backgroundColor: palette.muted
  },
  shaftLarge: {
    width: 94
  }
}));
