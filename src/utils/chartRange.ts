/** Every stop on the chart range slider. `marked` stops also get a label under the track. */
export const chartRanges = [
  { key: "week", short: "1W", label: "Last week", days: 7, marked: true },
  { key: "twoWeeks", short: "2W", label: "Last 2 weeks", days: 14, marked: false },
  { key: "month", short: "1M", label: "Last month", days: 30, marked: true },
  { key: "twoMonths", short: "2M", label: "Last 2 months", days: 60, marked: false },
  { key: "quarter", short: "3M", label: "Last 3 months", days: 90, marked: true },
  { key: "half", short: "6M", label: "Last 6 months", days: 180, marked: true },
  { key: "nineMonths", short: "9M", label: "Last 9 months", days: 270, marked: false },
  { key: "year", short: "1Y", label: "Last year", days: 365, marked: true },
  { key: "all", short: "All", label: "All time", days: null, marked: true }
] as const;

export type ChartRange = (typeof chartRanges)[number]["key"];

export function isChartRange(value: unknown): value is ChartRange {
  return chartRanges.some((range) => range.key === value);
}

/** Days the range covers, or null for all time. */
export function chartRangeDays(range: ChartRange) {
  return chartRanges.find((item) => item.key === range)?.days ?? null;
}

export function chartRangeLabel(range: ChartRange) {
  return chartRanges.find((item) => item.key === range)?.label ?? "All time";
}

/** The stop nearest a finger at `offset` along a track of `width`, whose first and last stops sit `inset` in from its ends. */
export function rangeStopAt(offset: number, width: number, inset: number, stops: number) {
  const usable = width - inset * 2;
  if (usable <= 0 || stops < 2) return 0;
  const fraction = Math.min(1, Math.max(0, (offset - inset) / usable));
  return Math.round(fraction * (stops - 1));
}
