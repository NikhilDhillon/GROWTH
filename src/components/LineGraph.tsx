import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { Body } from "@/components/Text";
import { palette } from "@/utils/theme";

type Point = {
  key?: string;
  date?: string;
  label: string;
  value: number;
  details?: string[];
};

export function LineGraph({
  points,
  height = 180,
  suffix = "",
  emptyMessage = "Log more workouts to draw a trend.",
  xLabels,
  maxPoints = 8,
  showTrendLine = false,
  scrollable = false
}: {
  points: Point[];
  height?: number;
  suffix?: string;
  emptyMessage?: string;
  xLabels?: string[];
  maxPoints?: number;
  showTrendLine?: boolean;
  scrollable?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = scrollable ? Math.max(340, points.length * 82 + 56) : 340;
  const padding = { top: 28, right: 12, bottom: 30, left: 44 };
  const pointLimit = Math.max(1, maxPoints);
  const domain = (xLabels?.length ? xLabels : points.map(pointDomainValue)).slice(-pointLimit);
  const recent = xLabels?.length
    ? points.filter((point) => domain.includes(pointDomainValue(point))).slice(-pointLimit)
    : points.slice(-pointLimit);

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
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const domainTimes = domain.map(dateTimestamp);
  const useTimeAxis = !scrollable && domainTimes.every((time) => time !== null) && recent.every((point) => dateTimestamp(pointDomainValue(point)) !== null);
  const timeStart = useTimeAxis ? Math.min(...domainTimes as number[]) : null;
  const timeEnd = useTimeAxis ? Math.max(...domainTimes as number[]) : null;
  const timeSpan = timeStart !== null && timeEnd !== null ? timeEnd - timeStart : 0;
  const coordinates = recent.map((point) => {
    const domainIndex = scrollable ? recent.indexOf(point) : Math.max(0, domain.indexOf(pointDomainValue(point)));
    const pointTime = dateTimestamp(pointDomainValue(point));
    const x = useTimeAxis && pointTime !== null && timeStart !== null && timeEnd !== null
      ? timeStart === timeEnd
        ? padding.left + plotWidth / 2
        : padding.left + ((pointTime - timeStart) / timeSpan) * plotWidth
      : recent.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (domainIndex / (recent.length - 1)) * plotWidth;
    const y = padding.top + (1 - (point.value - min) / span) * plotHeight;
    return { x, y, point };
  });
  const trendLine = showTrendLine && coordinates.length > 1 ? buildTrendLine(coordinates) : null;
  const timeTicks = timeStart !== null && timeEnd !== null ? buildTimeTicks(timeStart, timeEnd) : [];
  const activePoint = activeIndex === null ? null : coordinates[activeIndex];
  const tooltipLines = activePoint ? [activePoint.point.label, `${activePoint.point.value.toFixed(1)}${suffix}`, ...(activePoint.point.details ?? [])] : [];
  const detailLines = tooltipLines.slice(2);
  const tooltipWidth = 220;
  const tooltipHeight = 62 + detailLines.length * 20;
  const tooltipX = activePoint ? Math.max(8, Math.min(activePoint.x - tooltipWidth / 2, width - tooltipWidth - 8)) : 0;
  const tooltipY = activePoint ? Math.max(8, activePoint.y - tooltipHeight - 14) : 0;

  const graph = (
    <Svg width={scrollable ? width : "100%"} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke={palette.border} strokeWidth={1} />
        <Line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke={palette.border} strokeWidth={1} />
        <SvgText x={2} y={padding.top + 4} fill={palette.muted} fontSize="11">{max.toFixed(1)}{suffix}</SvgText>
        <SvgText x={2} y={height - padding.bottom - 4} fill={palette.muted} fontSize="11">{min.toFixed(1)}{suffix}</SvgText>
        {timeTicks.map((time, index) => {
          const x = timeStart === timeEnd
            ? padding.left + plotWidth / 2
            : padding.left + ((time - timeStart!) / timeSpan) * plotWidth;
          const textAnchor = index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle";
          return (
            <SvgText key={`tick-${time}`} x={x} y={height - 8} textAnchor={textAnchor} fill={palette.muted} fontSize="10">
              {formatTimeTick(time, timeSpan)}
            </SvgText>
          );
        })}
        {coordinates.length > 1 ? (
          <Polyline points={coordinates.map((item) => `${item.x},${item.y}`).join(" ")} fill="none" stroke={palette.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {trendLine ? (
          <Line
            x1={trendLine.x1}
            y1={trendLine.y1}
            x2={trendLine.x2}
            y2={trendLine.y2}
            stroke={palette.blue}
            strokeWidth={2}
            strokeDasharray="6 5"
            strokeLinecap="round"
          />
        ) : null}
        {coordinates.map((item, index) => (
          <Circle key={`${item.x}-${item.y}-${index}`} cx={item.x} cy={item.y} r={4} fill={palette.ink} />
        ))}
        {coordinates.map((item, index) => (
          <Circle
            key={`hit-${item.x}-${item.y}-${index}`}
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
  );

  return scrollable ? (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scrollContent}>
      {graph}
    </ScrollView>
  ) : <View style={styles.wrap}>{graph}</View>;
}

function pointDomainValue(point: Point) {
  return point.date ?? point.key ?? point.label;
}

function dateTimestamp(value: string) {
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return null;
  const dateValue = value.length === 7 ? `${value}-01` : value;
  const timestamp = new Date(`${dateValue}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildTimeTicks(start: number, end: number) {
  if (start === end) return [start];
  if (end - start < 2 * 24 * 60 * 60 * 1000) return [start, end];
  return [start, start + (end - start) / 2, end];
}

function buildTrendLine(points: Array<{ x: number; y: number }>) {
  const count = points.length;
  const sumX = points.reduce((total, point) => total + point.x, 0);
  const sumY = points.reduce((total, point) => total + point.y, 0);
  const sumXY = points.reduce((total, point) => total + point.x * point.y, 0);
  const sumXX = points.reduce((total, point) => total + point.x * point.x, 0);
  const denominator = count * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const x1 = points[0].x;
  const x2 = points[count - 1].x;
  return {
    x1,
    y1: slope * x1 + intercept,
    x2,
    y2: slope * x2 + intercept
  };
}

function formatTimeTick(timestamp: number, span: number) {
  const date = new Date(timestamp);
  const options: Intl.DateTimeFormatOptions = span >= 365 * 24 * 60 * 60 * 1000
    ? { month: "short", year: "2-digit" }
    : { month: "short", day: "numeric" };
  return date.toLocaleDateString(undefined, options);
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%"
  },
  scrollContent: {
    minWidth: "100%"
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8
  }
});
