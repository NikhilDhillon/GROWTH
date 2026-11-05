import { useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { bodyFigureReading, bodyFigureTint } from "@/screens/BodyMeasurements/bodyFigureReadings";
import { BodyFigureLimb, BodyFigureTorso, BodySide, femaleBodyFigure, maleBodyFigure } from "@/screens/BodyMeasurements/bodyFigureShapes";
import type { MeasurementChannel, MeasurementOverview } from "@/services/body/bodyMeasurementReport";
import type { BodyFigureChoice, CircumferenceUnit } from "@/types";
import { BodyMeasurementKey, formatCircumferenceChange } from "@/utils/bodyMeasurements";
import { mixHexColors } from "@/utils/color";
import { createThemedStyles } from "@/utils/themedStyles";

const figures = { male: maleBodyFigure, female: femaleBodyFigure };
const maxCanvasWidth = 380;
const maxFigureHeight = 350;
/** Room kept beside the body for the callouts. */
const minimumColumn = 50;
const lineInset = 44;
const chartFont = Platform.OS === "web" ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : undefined;
const limbs: Array<{ limb: BodyFigureLimb; name: string }> = [
  { limb: "arm", name: "Arm" }, { limb: "forearm", name: "Forearm" }, { limb: "thigh", name: "Thigh" }, { limb: "calves", name: "Calf" }
];
const torso: BodyFigureTorso[] = ["chest", "thinnest_waist", "waist", "abdomen"];
/** On the web the SVG library's onPress adds touch props the browser rejects, so use a plain click.
 * The library overwrites onClick unless onPress is exactly null. */
/** Numbers, lines and dots sit on top of the muscles, so they must let a tap through to the muscle below. */
const passTouches = { pointerEvents: "none" as const };
const pressProps = (onPress: () => void): object => Platform.OS === "web" ? { onClick: onPress, onPress: null, style: { cursor: "pointer" } } : { onPress };

/** The body, tinted by how much each part changed. Numbers sit on it or beside it; the rows below name everything. */
export function BodyFigure({ overview, figure, unit, onOpen }: {
  overview: MeasurementOverview;
  figure: BodyFigureChoice;
  unit: CircumferenceUnit;
  onOpen: (key: BodyMeasurementKey, channel: MeasurementChannel) => void;
}) {
  const { palette, styles } = useStyles();
  const [width, setWidth] = useState(0);
  const data = figures[figure];
  const { rows, changeDomainCm } = overview;

  const shapes = useMemo(() => data.shapes.map((shape) => {
    const reading = shape.region && shape.side ? bodyFigureReading(rows, shape.region, shape.side) : null;
    const tint = reading ? bodyFigureTint(reading.changeCm, unit, changeDomainCm) : null;
    const base = shape.hair ? palette.muscleHair : palette.muscle;
    return { d: shape.d, reading, fill: tint ? mixHexColors(base, palette[tint.direction], tint.strength) : base };
  }), [data, rows, changeDomainCm, unit, palette]);

  const canvas = Math.min(width, maxCanvasWidth);
  const height = Math.min(maxFigureHeight, (canvas - minimumColumn * 2) * data.bounds.height / data.bounds.width);
  const ready = canvas > minimumColumn * 2;
  const scale = ready ? (height - 4) / data.bounds.height : 1;
  const offsetX = (canvas - data.bounds.width * scale) / 2 - data.bounds.x * scale;
  const offsetY = 2 - data.bounds.y * scale;
  const canvasX = (x: number) => offsetX + x * scale;
  const canvasY = (y: number) => offsetY + y * scale;

  function open(reading: NonNullable<(typeof shapes)[number]["reading"]>) {
    const channel = reading.channel ?? rows.find((row) => row.key === reading.key)?.channels[0]?.channel;
    if (channel) onOpen(reading.key, channel);
  }
  const display = (changeCm: number | null) => changeCm === null ? "—" : formatCircumferenceChange(changeCm, unit);

  function torsoLabel(region: BodyFigureTorso) {
    const reading = bodyFigureReading(rows, region, "left");
    if (!reading) return null;
    const shared = { ...passTouches, x: canvasX(data.midX), y: canvasY(data.torso[region]) + 4, textAnchor: "middle" as const, fontSize: 12, fontWeight: "700" as const, fontFamily: chartFont };
    // The number sits on the gap between the left and right muscles, so it gets its own tap area,
    // drawn above the text because Android text catches touches even when told to let them through.
    return <G key={region}>
      <SvgText {...shared} fill={palette.surface} stroke={palette.surface} strokeWidth={3} strokeLinejoin="round">{display(reading.changeCm)}</SvgText>
      <SvgText {...shared} fill={palette.ink}>{display(reading.changeCm)}</SvgText>
      <Rect x={shared.x - 24} y={shared.y - 14} width={48} height={18} fill="transparent" {...pressProps(() => open(reading))} />
    </G>;
  }

  function callout(limb: BodyFigureLimb, name: string, side: BodySide) {
    const reading = bodyFigureReading(rows, limb, side);
    if (!reading) return null;
    // One number covers both limbs, so it is labelled once rather than looking like two separate measurements.
    const shared = reading.channel === "single" || reading.channel === "average";
    if (shared && side === "right") return null;
    const onRight = side === "left";
    const anchor = data.limbs[limb][side];
    const x = canvasX(anchor.x);
    const y = canvasY(anchor.y);
    const textX = onRight ? canvas - 2 : 2;
    const textAnchor = onRight ? "end" as const : "start" as const;
    const part = reading.key === "arm_flexed" ? "Arm, flexed" : reading.key === "arm_unflexed" ? "Arm, unflexed" : name;
    const label = reading.channel === "single" ? `${part}, both` : reading.channel === "average" ? `${part}, avg` : part;
    return <G key={`${limb}-${side}`}>
      <Line {...passTouches} x1={x} y1={y} x2={onRight ? canvas - lineInset : lineInset} y2={y} stroke={palette.muted} strokeWidth={0.75} />
      <Circle {...passTouches} cx={x} cy={y} r={2.2} fill={palette.ink} />
      <SvgText {...passTouches} x={textX} y={y - 4} textAnchor={textAnchor} fontSize={11} fill={palette.muted} fontFamily={chartFont}>{label}</SvgText>
      <SvgText {...passTouches} x={textX} y={y + 11} textAnchor={textAnchor} fontSize={13} fontWeight="700" fill={palette.ink} fontFamily={chartFont}>{display(reading.changeCm)}</SvgText>
    </G>;
  }

  return (
    <View style={styles.wrap} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {ready ? (
        <View accessible accessibilityRole="image" accessibilityLabel="Body map of tape changes. The list below has the same values." style={{ width: canvas, height }}>
          <Svg width={canvas} height={height}>
            <G transform={`translate(${offsetX},${offsetY}) scale(${scale})`}>
              {shapes.map((shape, index) => (
                <Path key={index} d={shape.d} fill={shape.fill} stroke={palette.muscleEdge} strokeWidth={0.84 / scale}
                  {...(shape.reading ? pressProps(() => open(shape.reading!)) : {})} />
              ))}
            </G>
            {torso.map(torsoLabel)}
            {limbs.flatMap(({ limb, name }) => (["right", "left"] as const).map((side) => callout(limb, name, side)))}
            <SvgText {...passTouches} x={2} y={12} fontSize={11} fontWeight="700" fill={palette.muted} fontFamily={chartFont}>Right</SvgText>
            <SvgText {...passTouches} x={canvas - 2} y={12} textAnchor="end" fontSize={11} fontWeight="700" fill={palette.muted} fontFamily={chartFont}>Left</SvgText>
          </Svg>
        </View>
      ) : <View style={styles.placeholder} />}
    </View>
  );
}

const useStyles = createThemedStyles(() => StyleSheet.create({
  wrap: { width: "100%", alignItems: "center" },
  placeholder: { height: maxFigureHeight }
}));
