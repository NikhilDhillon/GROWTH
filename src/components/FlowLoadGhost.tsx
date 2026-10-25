import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { calculatePlateCounts, LoadedBar, plateVisuals } from "@/components/LoadedBar";
import type { PlateWeight } from "@/constants/plates";
import { FlowLoadGhostKind, standingPlates } from "@/services/workouts/loadGhost";
import { createThemedStyles } from "@/utils/themedStyles";

const stackWidth = 64;
const standingScale = 1.7;
const leanDegrees = 20;
const plateGap = 2.5;

/**
 * A faint picture of the load above flow mode's numbers, fading down before it
 * reaches them: the plate calculator's bar, a cable stack with its pin, or added
 * plates standing on the floor. It shows the settled load only, dims while the
 * wheel spins, and bumps when the load changes.
 */
export function FlowLoadGhost({ visual, load, dimmed }: { visual: FlowLoadGhostKind; load: number; dimmed: boolean }) {
  const { palette, styles } = useStyles();
  const bump = useRef(new Animated.Value(0)).current;
  const tip = useRef(new Animated.Value(1)).current;
  const shown = useRef(load);
  const native = Platform.OS !== "web";
  useEffect(() => {
    if (dimmed || shown.current === load) return;
    shown.current = load;
    bump.setValue(0);
    tip.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(bump, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.spring(bump, { toValue: 0, friction: 4, tension: 140, useNativeDriver: native })
      ]),
      Animated.spring(tip, { toValue: 1, friction: 5, tension: 90, useNativeDriver: native })
    ]).start();
  }, [bump, tip, dimmed, load, native]);
  const lift = bump.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <View pointerEvents="none" style={styles.ghost}>
      <Animated.View style={[styles.picture, dimmed && styles.dimmed, { transform: [{ translateY: lift }] }]}>
        {visual.kind === "barbell" ? <LoadedBar counts={calculatePlateCounts(String(load), String(visual.barWeight))} tint={palette.ink} />
          : visual.kind === "stack" ? <Stack load={load} plateSize={visual.plateSize} plates={visual.plates} />
          : <StandingPlates load={load} tip={tip} />}
      </Animated.View>
      {/* Fades the lower part into the page at full strength, so the picture never sits behind the numbers. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 10 10">
        <Defs>
          <LinearGradient id="flowGhostFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={visual.kind === "stack" ? "0.55" : visual.kind === "plates" ? "0.5" : "0.45"} stopColor={palette.background} stopOpacity={0} />
            <Stop offset="1" stopColor={palette.background} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="10" height="10" fill="url(#flowGhostFade)" />
      </Svg>
    </View>
  );
}

/** Selected plates hang from the cable; an in-between load adds the small add-on weight on top. */
function Stack({ load, plateSize, plates }: { load: number; plateSize: number; plates: number }) {
  const { palette, styles } = useStyles();
  const size = plateSize > 0 ? plateSize : 1;
  const selected = Math.max(0, Math.floor((load + 1e-9) / size));
  const addOn = load - selected * size > 1e-6;
  const total = Math.min(20, Math.max(plates, selected + 3));
  return (
    <View style={styles.stack}>
      <View style={[styles.cable, { backgroundColor: palette.ink }]} />
      {addOn ? <View style={[styles.addOn, { backgroundColor: palette.ink }]} /> : null}
      {Array.from({ length: total }, (_, index) => (
        <View key={index} style={[styles.stackPlate, { backgroundColor: palette.ink, opacity: index < selected ? 1 : 0.32 }]} />
      ))}
      {selected ? <View style={[styles.pin, { backgroundColor: palette.ink, top: 16 + (addOn ? 6 : 0) + selected * 7.5 - 5.5 }]} /> : null}
    </View>
  );
}

/** Added weight like one side of a bar without the bar: plates standing in a row, the last one leaning in from the left. */
function StandingPlates({ load, tip }: { load: number; tip: Animated.Value }) {
  const { palette, styles } = useStyles();
  const plates = standingPlates(load) as PlateWeight[];
  if (!plates.length) return <View style={[styles.floor, styles.emptyFloor, { backgroundColor: palette.ink }]} />;
  const size = (plate: PlateWeight) => ({ width: plateVisuals[plate].width * standingScale, height: plateVisuals[plate].height * standingScale });
  const upright = plates.length > 1 ? plates.slice(0, -1) : plates;
  const leaning = plates.length > 1 ? size(plates[plates.length - 1]) : null;
  // Room on the left for the leaning plate, whose top rests against the first upright plate.
  const leanRoom = leaning ? leaning.width + leaning.height * Math.sin(leanDegrees * Math.PI / 180) : 0;
  const rowWidth = upright.reduce((sum, plate) => sum + size(plate).width, 0) + (upright.length - 1) * plateGap;
  const height = Math.max(...plates.map((plate) => size(plate).height));
  let left = leanRoom;
  return (
    <View style={{ width: leanRoom + rowWidth, height }}>
      {upright.map((plate, index) => {
        const box = size(plate);
        const x = left;
        left += box.width + plateGap;
        return <View key={index} style={[styles.standing, { left: x, width: box.width, height: box.height, backgroundColor: palette.ink }]} />;
      })}
      {leaning ? <Animated.View style={[styles.standing, {
        left: 0, width: leaning.width, height: leaning.height, backgroundColor: palette.ink, transformOrigin: "100% 100%",
        transform: [{ rotate: tip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${leanDegrees}deg`] }) }]
      }]} /> : null}
      <View style={[styles.floor, { backgroundColor: palette.ink }]} />
    </View>
  );
}

const useStyles = createThemedStyles(() => StyleSheet.create({
  ghost: { alignSelf: "center", alignItems: "center", marginBottom: 16 },
  picture: { opacity: 0.16 },
  dimmed: { opacity: 0.05 },
  stack: { width: stackWidth, alignItems: "center", position: "relative" },
  cable: { width: 1.5, height: 16 },
  addOn: { width: stackWidth * 0.4, height: 4, borderRadius: 1.5, marginBottom: 2 },
  stackPlate: { width: stackWidth, height: 5, borderRadius: 1.5, marginBottom: 2.5 },
  pin: { position: "absolute", right: -10, width: 5, height: 5, borderRadius: 3 },
  standing: { position: "absolute", bottom: 0, borderRadius: 2.5 },
  floor: { position: "absolute", left: -12, right: -12, bottom: -1, height: 1, opacity: 0.5 },
  emptyFloor: { position: "relative", width: 80, left: 0 }
}));
