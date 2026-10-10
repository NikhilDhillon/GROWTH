import { useEffect, useRef, useState } from "react";
import { GestureResponderEvent, Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";

import { Body } from "@/components/Text";
import { isCalendarDate } from "@/domain/calendar";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

type Point = {
  key?: string;
  date?: string;
  label: string;
  value: number;
  details?: string[];
};

/**
 * Portfolio-style trend chart: the header always shows the value under the
 * cursor (or the latest value) with its change from the first visible point,
 * the line is tinted by direction, and dragging across the chart scrubs points.
 */
export function LineGraph({
  points,
  height = 200,
  suffix = "",
  emptyMessage = "Log more workouts to draw a trend.",
  xLabels,
  maxPoints = Number.POSITIVE_INFINITY,
  showTrendLine = false,
  tone = "trend",
  formatValue = defaultFormat
}: {
  points: Point[];
  height?: number;
  suffix?: string;
  emptyMessage?: string;
  xLabels?: string[];
  maxPoints?: number;
  showTrendLine?: boolean;
  /** "trend" tints the line green/red by direction; "neutral" for measures where up is not better. */
  tone?: "trend" | "neutral";
  formatValue?: (value: number) => string;
  /** @deprecated The chart now always fits its range; kept so older call sites still compile. */
  scrollable?: boolean;
}) {
  const { palette, styles } = useStyles();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(340);
  const chartRef = useRef<View>(null);
  const gradientId = useRef(`line-graph-area-${Math.random().toString(36).slice(2, 10)}`).current;
  const pointLimit = showAll ? Number.POSITIVE_INFINITY : Math.max(1, maxPoints);
  const domainSource = xLabels?.length ? xLabels : points.map(pointDomainValue);
  const domain = Number.isFinite(pointLimit) ? domainSource.slice(-pointLimit) : domainSource;
  const filtered = xLabels?.length ? points.filter((point) => domain.includes(pointDomainValue(point))) : points;
  const recent = Number.isFinite(pointLimit) ? filtered.slice(-pointLimit) : filtered;
  const selectionSignature = recent.map(pointIdentity).join("\n");
  useEffect(() => {
    if (activeKey !== null && !recent.some((point) => pointIdentity(point) === activeKey)) setActiveKey(null);
    if (hoverKey !== null && !recent.some((point) => pointIdentity(point) === hoverKey)) setHoverKey(null);
  }, [activeKey, hoverKey, selectionSignature]);

  if (!recent.length) {
    return (
      <View style={[styles.empty, { height }]}>
        <Body style={styles.emptyText}>{emptyMessage}</Body>
      </View>
    );
  }

  const width = Math.max(120, viewportWidth);
  const padding = { top: 18, right: 46, bottom: 26, left: 6 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const plotBottom = height - padding.bottom;
  const values = recent.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawSpan = rawMax - rawMin;
  const pad = rawSpan ? rawSpan * 0.12 : Math.max(Math.abs(rawMax) * 0.04, 1);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const domainTimes = domain.map(dateTimestamp);
  const useTimeAxis = domainTimes.length > 0 && domainTimes.every((time) => time !== null) && recent.every((point) => dateTimestamp(pointDomainValue(point)) !== null);
  const timeStart = useTimeAxis ? Math.min(...domainTimes as number[]) : null;
  const timeEnd = useTimeAxis ? Math.max(...domainTimes as number[]) : null;
  const timeSpan = timeStart !== null && timeEnd !== null ? timeEnd - timeStart : 0;
  const yFor = (value: number) => padding.top + (1 - (value - min) / span) * plotHeight;
  const coordinates = recent.map((point, index) => {
    const pointTime = dateTimestamp(pointDomainValue(point));
    const domainIndex = Math.max(0, domain.indexOf(pointDomainValue(point)));
    const x = useTimeAxis && pointTime !== null && timeStart !== null
      ? timeSpan === 0 ? padding.left + plotWidth / 2 : padding.left + ((pointTime - timeStart) / timeSpan) * plotWidth
      : recent.length === 1 && domain.length <= 1
        ? padding.left + plotWidth / 2
        : padding.left + ((xLabels?.length ? domainIndex : index) / Math.max(1, (xLabels?.length ? domain.length : recent.length) - 1)) * plotWidth;
    return { x, y: yFor(point.value), point };
  });

  const first = coordinates[0];
  const latest = coordinates[coordinates.length - 1];
  const activePoint = activeKey === null ? null : coordinates.find((item) => pointIdentity(item.point) === activeKey) ?? null;
  const hoverPoint = hoverKey === null ? null : coordinates.find((item) => pointIdentity(item.point) === hoverKey) ?? null;
  const focused = hoverPoint ?? activePoint;
  const displayed = focused ?? latest;
  const delta = coordinates.length > 1 ? displayed.point.value - first.point.value : null;
  const percent = delta !== null && first.point.value !== 0 ? delta / Math.abs(first.point.value) * 100 : null;
  const overallDelta = coordinates.length > 1 ? latest.point.value - first.point.value : 0;
  const lineColor = tone === "neutral" ? palette.blue : overallDelta < 0 ? palette.danger : palette.success;
  const deltaColor = tone === "neutral" || delta === null || delta === 0 ? palette.muted : delta > 0 ? palette.success : palette.danger;
  const best = coordinates.reduce((top, item) => item.point.value > top.point.value ? item : top, first);
  const showBest = tone === "trend" && coordinates.length >= 3 && best !== latest && best.point.value > first.point.value;
  const showDots = coordinates.length <= 32;
  const linePath = buildSmoothPath(coordinates);
  const areaPath = coordinates.length > 1 ? `${linePath} L ${latest.x} ${plotBottom} L ${first.x} ${plotBottom} Z` : null;
  const trendLine = showTrendLine && coordinates.length > 1 ? buildTrendLine(coordinates) : null;
  const xTicks = buildXTicks(coordinates, useTimeAxis, timeStart, timeEnd, padding.left, plotWidth);
  const yTicks = [rawMax, (rawMax + rawMin) / 2, rawMin].filter((value, index, all) => all.indexOf(value) === index);

  function nearestTo(locationX: number) {
    return coordinates.reduce((closest, item) => Math.abs(item.x - locationX) < Math.abs(closest.x - locationX) ? item : closest, coordinates[0]);
  }

  function chartX(event: GestureResponderEvent | { nativeEvent: Record<string, any> }) {
    const native = event.nativeEvent as Record<string, any>;
    const node = chartRef.current as unknown as { getBoundingClientRect?: () => { left: number } } | null;
    if (Platform.OS === "web" && node?.getBoundingClientRect) {
      const touch = native.touches?.[0] ?? native.changedTouches?.[0];
      const clientX = touch?.clientX ?? native.clientX;
      if (typeof clientX === "number") return clientX - node.getBoundingClientRect().left;
    }
    return typeof native.locationX === "number" ? native.locationX : null;
  }

  function scrubTo(event: GestureResponderEvent) {
    const x = chartX(event);
    if (x !== null) setActiveKey(pointIdentity(nearestTo(x).point));
  }

  const webPointer = Platform.OS === "web" ? {
    onPointerMove: (event: { nativeEvent: Record<string, any> }) => {
      if (event.nativeEvent.pointerType !== "mouse") return;
      const x = chartX(event);
      if (x !== null) setHoverKey(pointIdentity(nearestTo(x).point));
    },
    onPointerLeave: () => setHoverKey(null)
  } : {};

  return (
    <View style={styles.wrap} onLayout={(event) => setViewportWidth(Math.max(1, event.nativeEvent.layout.width))}>
      <View style={styles.header} accessibilityLiveRegion="polite">
        <Body style={styles.value}>{formatValue(displayed.point.value)}{suffix}</Body>
        <View style={styles.deltaRow}>
          {delta === null ? <Body style={styles.deltaContext}>First recorded entry</Body> : <>
            <Body style={[styles.delta, { color: deltaColor }]}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {signedNumber(delta, formatValue)}{suffix}{percent === null ? "" : ` (${signedNumber(percent, (value) => value.toFixed(1))}%)`}</Body>
            <Body style={styles.deltaContext} numberOfLines={1}>{focused ? pointDateLabel(displayed.point) : `since ${first.point.label}`}</Body>
          </>}
        </View>
      </View>

      <View
        ref={chartRef}
        style={[styles.chart, { height }]}
        onTouchStart={scrubTo}
        onTouchMove={scrubTo}
        {...webPointer}
      >
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1={padding.top} x2="0" y2={plotBottom} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={lineColor} stopOpacity={0.24} />
              <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {yTicks.map((value) => (
            <Line key={`grid-${value}`} x1={padding.left} x2={padding.left + plotWidth} y1={yFor(value)} y2={yFor(value)} stroke={palette.border} strokeWidth={1} strokeOpacity={0.7} />
          ))}
          {yTicks.map((value) => (
            <SvgText key={`y-${value}`} x={width - padding.right + 8} y={yFor(value) + 3.5} textAnchor="start" fill={palette.muted} fontSize="10" fontWeight="600" fontFamily={chartFont}>
              {compactNumber(value, formatValue)}
            </SvgText>
          ))}
          {coordinates.length > 1 ? <Line x1={padding.left} x2={padding.left + plotWidth} y1={first.y} y2={first.y} stroke={palette.muted} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="2 4" /> : null}
          {areaPath ? <Path d={areaPath} fill={`url(#${gradientId})`} /> : null}
          {trendLine ? <Line x1={trendLine.x1} y1={trendLine.y1} x2={trendLine.x2} y2={trendLine.y2} stroke={palette.muted} strokeWidth={1.5} strokeDasharray="6 5" strokeLinecap="round" /> : null}
          {coordinates.length > 1 ? <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
          {showDots ? coordinates.map((item, index) => item === latest || item === focused ? null : (
            <Circle key={`dot-${index}`} cx={item.x} cy={item.y} r={2.5} fill={palette.surface} stroke={lineColor} strokeWidth={1.5} />
          )) : null}
          {showBest && best !== focused ? <>
            <Circle cx={best.x} cy={best.y} r={3.5} fill={lineColor} />
            <SvgText x={clamp(best.x, padding.left + 14, padding.left + plotWidth - 14)} y={Math.max(11, best.y - 9)} textAnchor="middle" fill={palette.ink} fontSize="10" fontWeight="700" fontFamily={chartFont}>Best</SvgText>
          </> : null}
          {focused ? <Line x1={focused.x} x2={focused.x} y1={padding.top - 6} y2={plotBottom} stroke={palette.ink} strokeOpacity={0.45} strokeWidth={1} /> : null}
          {latest !== focused ? <>
            <Circle cx={latest.x} cy={latest.y} r={8} fill={lineColor} fillOpacity={0.18} />
            <Circle cx={latest.x} cy={latest.y} r={4} fill={lineColor} stroke={palette.surface} strokeWidth={1.5} />
          </> : null}
          {focused ? <>
            <Circle cx={focused.x} cy={focused.y} r={9} fill={lineColor} fillOpacity={0.2} />
            <Circle cx={focused.x} cy={focused.y} r={5} fill={palette.surface} stroke={lineColor} strokeWidth={2.5} />
          </> : null}
          {xTicks.map((tick, index) => (
            <SvgText key={`x-${index}`} x={tick.x} y={height - 7} textAnchor={tick.anchor} fill={palette.muted} fontSize="10" fontWeight="600" fontFamily={chartFont}>{tick.label}</SvgText>
          ))}
        </Svg>
        {coordinates.map((item, index) => (
          <Pressable
            key={`hit-${index}`}
            accessible
            accessibilityRole="button"
            accessibilityLabel={pointDescription(item.point, suffix, formatValue)}
            accessibilityHint="Show the full recorded date, value and details"
            accessibilityState={{ selected: pointIdentity(item.point) === activeKey }}
            onPress={() => setActiveKey(pointIdentity(item.point))}
            style={[styles.pointTarget, { left: item.x - 22, top: item.y - 22 }]}
          />
        ))}
      </View>

      {recent.length < points.length ? (
        <View style={styles.limitRow}>
          <Body style={styles.limitText}>{`Showing latest ${recent.length} of ${points.length} points.`}</Body>
          <Pressable accessibilityRole="button" accessibilityLabel={`Show all ${points.length} chart points`} onPress={() => setShowAll(true)} style={pressableFeedback(styles.textButton)}>
            <Body style={styles.textButtonLabel}>Show all</Body>
          </Pressable>
        </View>
      ) : null}

      {activePoint ? (
        <View style={styles.details} accessibilityLiveRegion="polite">
          <View style={styles.detailsHeader}>
            <Body style={styles.detailHeading}>{pointDateLabel(activePoint.point)}</Body>
            <Pressable accessibilityRole="button" accessibilityLabel="Close chart point details" onPress={() => setActiveKey(null)} style={pressableFeedback(styles.textButton)}>
              <Body style={styles.textButtonLabel}>Done</Body>
            </Pressable>
          </View>
          <Body style={styles.detailValue}>{`${formatValue(activePoint.point.value)}${suffix}`}</Body>
          {(activePoint.point.details ?? []).map((detail, index) => <Body key={index} style={styles.detailLine}>{detail}</Body>)}
        </View>
      ) : coordinates.length > 1 ? <Body style={styles.hint}>Drag across the chart or tap a point to inspect it.</Body> : null}
    </View>
  );
}

const chartFont = Platform.OS === "web" ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : undefined;

function defaultFormat(value: number) {
  return value.toFixed(1);
}

function signedNumber(value: number, format: (value: number) => string) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;
}

function compactNumber(value: number, format: (value: number) => string) {
  if (Math.abs(value) >= 10000) return `${(value / 1000).toFixed(1)}k`;
  if (Math.abs(value) >= 1000) return Math.round(value).toString();
  return format(value);
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function pointIdentity(point: Point) {
  return point.key ?? JSON.stringify([point.date ?? null, point.label, point.value]);
}

function pointDateLabel(point: Point) {
  return point.date && point.date !== point.label ? `${point.date} · ${point.label}` : point.label;
}

function pointDescription(point: Point, suffix: string, format: (value: number) => string) {
  return [pointDateLabel(point), `${format(point.value)}${suffix}`, ...(point.details ?? [])].join(". ");
}

function pointDomainValue(point: Point) {
  return point.date ?? point.key ?? point.label;
}

function dateTimestamp(value: string) {
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return null;
  const dateValue = value.length === 7 ? `${value}-01` : value;
  if (!isCalendarDate(dateValue)) return null;
  const timestamp = new Date(`${dateValue}T00:00:00.000Z`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

type Coordinate = { x: number; y: number };

/** Monotone cubic interpolation (Fritsch–Carlson): smooth, but never overshoots a recorded value. */
export function buildSmoothPath(points: Coordinate[]) {
  if (!points.length) return "";
  if (points.length < 3) return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const count = points.length;
  const dx: number[] = [];
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    dx[index] = points[index + 1].x - points[index].x;
    slopes[index] = dx[index] === 0 ? 0 : (points[index + 1].y - points[index].y) / dx[index];
  }
  const tangents: number[] = [slopes[0]];
  for (let index = 1; index < count - 1; index += 1) {
    tangents[index] = slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  }
  tangents[count - 1] = slopes[count - 2];
  for (let index = 0; index < count - 1; index += 1) {
    if (slopes[index] === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index] / slopes[index];
    const b = tangents[index + 1] / slopes[index];
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slopes[index];
      tangents[index + 1] = scale * b * slopes[index];
    }
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < count - 1; index += 1) {
    const third = dx[index] / 3;
    const start = points[index];
    const end = points[index + 1];
    path += ` C ${start.x + third} ${start.y + tangents[index] * third} ${end.x - third} ${end.y - tangents[index + 1] * third} ${end.x} ${end.y}`;
  }
  return path;
}

function buildXTicks(coordinates: Array<Coordinate & { point: Point }>, useTimeAxis: boolean, start: number | null, end: number | null, left: number, plotWidth: number) {
  const anchors = ["start", "middle", "end"] as const;
  if (useTimeAxis && start !== null && end !== null) {
    if (start === end) return [{ x: left + plotWidth / 2, label: formatTimeTick(start, 0), anchor: "middle" as const }];
    const span = end - start;
    const times = span < 2 * 24 * 60 * 60 * 1000 ? [start, end] : [start, start + span / 2, end];
    return times.map((time, index) => ({
      x: left + ((time - start) / span) * plotWidth,
      label: formatTimeTick(time, span),
      anchor: times.length === 2 ? (index === 0 ? "start" as const : "end" as const) : anchors[index]
    }));
  }
  if (coordinates.length === 1) return [{ x: coordinates[0].x, label: coordinates[0].point.label, anchor: "middle" as const }];
  const firstPoint = coordinates[0];
  const lastPoint = coordinates[coordinates.length - 1];
  return [
    { x: firstPoint.x, label: firstPoint.point.label, anchor: "start" as const },
    { x: lastPoint.x, label: lastPoint.point.label, anchor: "end" as const }
  ];
}

function buildTrendLine(points: Coordinate[]) {
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
  return { x1, y1: slope * x1 + intercept, x2, y2: slope * x2 + intercept };
}

function formatTimeTick(timestamp: number, span: number) {
  const date = new Date(timestamp);
  const options: Intl.DateTimeFormatOptions = span >= 300 * 24 * 60 * 60 * 1000
    ? { month: "short", year: "2-digit" }
    : { month: "short", day: "numeric" };
  return date.toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  wrap: {
    width: "100%",
    gap: spacing.sm
  },
  header: {
    gap: 2
  },
  value: {
    color: palette.ink,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.6,
    fontVariant: ["tabular-nums"]
  },
  deltaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: spacing.sm
  },
  delta: {
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"]
  },
  deltaContext: {
    color: palette.muted,
    fontSize: 13,
    flexShrink: 1
  },
  chart: {
    width: "100%",
    ...(Platform.OS === "web" ? { touchAction: "pan-y", cursor: "crosshair", userSelect: "none" } as object : {})
  },
  pointTarget: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22
  },
  limitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  limitText: {
    color: palette.muted,
    fontSize: 12,
    flexShrink: 1
  },
  textButton: {
    minHeight: 36,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt
  },
  textButtonLabel: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700"
  },
  details: {
    gap: 4,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt
  },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  detailHeading: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1
  },
  detailValue: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"]
  },
  detailLine: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18
  },
  hint: {
    color: palette.muted,
    fontSize: 12
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    padding: spacing.lg
  },
  emptyText: {
    textAlign: "center"
  }
}));
