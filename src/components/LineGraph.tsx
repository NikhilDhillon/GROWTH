import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { Body } from "@/components/Text";
import { palette } from "@/utils/theme";

type Point = {
  key?: string;
  label: string;
  value: number;
  details?: string[];
};

export function LineGraph({
  points,
  height = 180,
  suffix = "",
  emptyMessage = "Log more workouts to draw a trend.",
  xLabels
}: {
  points: Point[];
  height?: number;
  suffix?: string;
  emptyMessage?: string;
  xLabels?: string[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 340;
  const padding = 28;
  const domain = (xLabels?.length ? xLabels : points.map((point) => point.key ?? point.label)).slice(-8);
  const recent = xLabels?.length
    ? points.filter((point) => domain.includes(point.key ?? point.label)).slice(-8)
    : points.slice(-8);

  if (!recent.length) {
    return (
      <View style={[styles.empty, { height }]}>
        <Body>{emptyMessage}</Body>
      </View>
    );
  }

  const values = recent.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const coordinates = recent.map((point) => {
    const domainIndex = Math.max(0, domain.indexOf(point.key ?? point.label));
    const x = domain.length === 1 ? width / 2 : padding + (domainIndex / (domain.length - 1)) * plotWidth;
    const y = padding + (1 - (point.value - min) / span) * plotHeight;
    return { x, y, point };
  });
  const activePoint = activeIndex === null ? null : coordinates[activeIndex];
  const tooltipLines = activePoint ? [activePoint.point.label, `${activePoint.point.value.toFixed(1)}${suffix}`, ...(activePoint.point.details ?? [])] : [];
  const detailLines = tooltipLines.slice(2);
  const tooltipWidth = 220;
  const tooltipHeight = 62 + detailLines.length * 20;
  const tooltipX = activePoint ? Math.max(8, Math.min(activePoint.x - tooltipWidth / 2, width - tooltipWidth - 8)) : 0;
  const tooltipY = activePoint ? Math.max(8, activePoint.y - tooltipHeight - 14) : 0;

  return (
    <View style={styles.wrap}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke={palette.border} strokeWidth={1} />
        <Line x1={padding} x2={padding} y1={padding} y2={height - padding} stroke={palette.border} strokeWidth={1} />
        <SvgText x={padding} y={18} fill={palette.muted} fontSize="11">{max.toFixed(1)}{suffix}</SvgText>
        <SvgText x={padding} y={height - 8} fill={palette.muted} fontSize="11">{min.toFixed(1)}{suffix}</SvgText>
        {coordinates.length > 1 ? (
          <Polyline points={coordinates.map((item) => `${item.x},${item.y}`).join(" ")} fill="none" stroke={palette.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {coordinates.map((item) => (
          <Circle key={`${item.x}-${item.y}`} cx={item.x} cy={item.y} r={4} fill={palette.ink} />
        ))}
        {coordinates.map((item, index) => (
          <Circle
            key={`hit-${item.x}-${item.y}`}
            cx={item.x}
            cy={item.y}
            r={13}
            fill="transparent"
            onPressIn={() => setActiveIndex(index)}
            onPressOut={() => setActiveIndex(null)}
            {...({
              onMouseEnter: () => setActiveIndex(index),
              onMouseLeave: () => setActiveIndex(null)
            } as object)}
          />
        ))}
        {activePoint ? (
          <>
            <Rect pointerEvents="none" x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx={8} fill={palette.ink} />
            <SvgText pointerEvents="none" x={tooltipX + 14} y={tooltipY + 22} fill={palette.surfaceAlt} fontSize="13" fontWeight="800">
              {tooltipLines[0]}
            </SvgText>
            <SvgText pointerEvents="none" x={tooltipX + 14} y={tooltipY + 47} fill={palette.surface} fontSize="18" fontWeight="900">
              {tooltipLines[1]}
            </SvgText>
            {detailLines.map((line, index) => (
              <SvgText pointerEvents="none" key={`${line}-${index}`} x={tooltipX + 14} y={tooltipY + 72 + index * 20} fill={palette.surfaceAlt} fontSize="13" fontWeight="700">
                {line.length > 28 ? `${line.slice(0, 27)}...` : line}
              </SvgText>
            ))}
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%"
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8
  }
});
