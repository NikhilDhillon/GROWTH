import { addCalendarDays, assertCalendarDate, isCalendarDate } from "@/domain/calendar";
import type { BodyMeasurementLog } from "@/types";
import { bodyMeasurementDefinitions, type BodyMeasurementKey } from "@/utils/bodyMeasurements";
import { chartRangeDays, type ChartRange } from "@/utils/chartRange";
import { todayIso } from "@/utils/date";

export type BodyMeasurementRange = ChartRange;
export type MeasurementChannel = "scalar" | "single" | "left" | "right" | "average";
export type MeasurementObservation = { checkInId: number; date: string; valueCm: number };
export type MeasurementChannelReport = {
  channel: MeasurementChannel;
  label: string;
  points: MeasurementObservation[];
  start: MeasurementObservation;
  latest: MeasurementObservation;
  previous: MeasurementObservation | null;
  changeFromStartCm: number;
  changeFromPreviousCm: number | null;
};

/** Keep rare tape observations on their recorded dates, independently of weight. */
export function filterBodyMeasurementLogs(logs: BodyMeasurementLog[], range: BodyMeasurementRange, asOfDate = todayIso()) {
  const end = assertCalendarDate(asOfDate);
  const days = chartRangeDays(range);
  const start = days === null ? null : addCalendarDays(end, -(days - 1));
  return logs.filter((log) => isCalendarDate(log.logged_date) && log.logged_date <= end && (start === null || log.logged_date >= start))
    .sort((left, right) => left.logged_date.localeCompare(right.logged_date) || left.created_at.localeCompare(right.created_at) || left.id - right.id);
}

/** Single, left and right measurements each have their own observed baseline.
 * A missing side is missing evidence, never an average or substitute side. */
export function buildBodyMeasurementReport(logs: BodyMeasurementLog[], metric: BodyMeasurementKey, asOfDate = todayIso()): MeasurementChannelReport[] {
  const definition = bodyMeasurementDefinitions.find((item) => item.key === metric);
  if (!definition) return [];
  const ordered = filterBodyMeasurementLogs(logs, "all", asOfDate);
  const channels: MeasurementChannel[] = definition.sided ? ["single", "left", "right"] : ["scalar"];
  return channels.flatMap((channel) => {
    const points = ordered.flatMap((log) => {
      const measurement = log.measurements[metric];
      let value: number | undefined;
      if (channel === "scalar" && typeof measurement === "number") value = measurement;
      else if (typeof measurement === "object" && measurement !== null) {
        if (channel === "single" && measurement.mode === "single") value = measurement.value;
        else if ((channel === "left" || channel === "right") && measurement.mode === "sides") value = measurement[channel];
      }
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? [{ checkInId: log.id, date: log.logged_date, valueCm: value }] : [];
    });
    if (!points.length) return [];
    const start = points[0];
    const latest = points[points.length - 1];
    const previous = points.at(-2) ?? null;
    return [{ channel, label: channel === "scalar" ? definition.label : `${definition.label} · ${channel}`,
      points, start, latest, previous, changeFromStartCm: latest.valueCm - start.valueCm,
      changeFromPreviousCm: previous ? latest.valueCm - previous.valueCm : null }];
  });
}

/** A part can switch between one value and left/right, which leaves neither with a full history.
 * Only then this joins them: each single value, or the average of a left and right from the same
 * check-in. A check-in missing a side is skipped, because one side cannot stand in for the average. */
export function buildAverageMeasurementReport(logs: BodyMeasurementLog[], metric: BodyMeasurementKey, asOfDate = todayIso()): MeasurementChannelReport | null {
  const definition = bodyMeasurementDefinitions.find((item) => item.key === metric);
  if (!definition?.sided) return null;
  let hasSingle = false;
  let hasBothSides = false;
  const points = filterBodyMeasurementLogs(logs, "all", asOfDate).flatMap((log) => {
    const measurement = log.measurements[metric];
    if (typeof measurement !== "object" || measurement === null) return [];
    let value: number | null = null;
    if (measurement.mode === "single") {
      if (usable(measurement.value)) { value = measurement.value; hasSingle = true; }
    } else if (usable(measurement.left) && usable(measurement.right)) {
      value = (measurement.left + measurement.right) / 2;
      hasBothSides = true;
    }
    return value === null ? [] : [{ checkInId: log.id, date: log.logged_date, valueCm: value }];
  });
  if (!hasSingle || !hasBothSides) return null;
  const start = points[0];
  const latest = points[points.length - 1];
  const previous = points.at(-2) ?? null;
  return { channel: "average", label: "Average", points, start, latest, previous, changeFromStartCm: latest.valueCm - start.valueCm,
    changeFromPreviousCm: previous ? latest.valueCm - previous.valueCm : null };
}

function usable(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The charts a body part can show, with the joined history first when there is one. */
export function buildBodyMeasurementSeries(logs: BodyMeasurementLog[], metric: BodyMeasurementKey, asOfDate = todayIso()) {
  const average = buildAverageMeasurementReport(logs, metric, asOfDate);
  return [...(average ? [average] : []), ...buildBodyMeasurementReport(logs, metric, asOfDate)];
}

export type MeasurementOverviewChannel = {
  channel: MeasurementChannel;
  /** Observations inside the range, oldest first. */
  points: MeasurementObservation[];
  /** Newest observation on record, which may fall before the range. */
  latest: MeasurementObservation;
  /** First to last observation inside the range; null until the range holds two. */
  changeCm: number | null;
};
export type MeasurementOverviewRow = {
  key: BodyMeasurementKey;
  label: string;
  group: (typeof bodyMeasurementDefinitions)[number]["group"];
  channels: MeasurementOverviewChannel[];
  /** Set only when the range mixes one value with left/right. It then replaces the separate changes. */
  average: MeasurementOverviewChannel | null;
};
export type MeasurementOverview = {
  rows: MeasurementOverviewRow[];
  /** Body parts with no observation on record, which get no row. */
  unmeasured: string[];
  /** First and last dates inside the range, across every body part. */
  window: { start: string; end: string } | null;
  /** Largest fall and rise across every change shown, shared by every bar and tint. */
  changeDomainCm: { min: number; max: number };
};

/** Top of the body to the bottom, so the rows read in the same order as the figure. */
export const overviewOrder: BodyMeasurementKey[] = ["chest", "thinnest_waist", "waist", "abdomen", "arm_flexed", "arm_unflexed", "forearm", "thigh", "calves"];

/** Every body part over the same range. Each channel measures change from its own first entry.
 * Sides stay separate and gaps are never filled, unless a part switched how it was measured. */
export function buildBodyMeasurementOverview(logs: BodyMeasurementLog[], range: BodyMeasurementRange, asOfDate = todayIso()): MeasurementOverview {
  const inRange = new Set(filterBodyMeasurementLogs(logs, range, asOfDate).map((log) => log.id));
  const toChannel = (report: MeasurementChannelReport): MeasurementOverviewChannel => {
    const points = report.points.filter((point) => inRange.has(point.checkInId));
    return { channel: report.channel, points, latest: report.latest, changeCm: points.length > 1 ? points[points.length - 1].valueCm - points[0].valueCm : null };
  };
  const rows: MeasurementOverviewRow[] = [];
  const unmeasured: string[] = [];
  const dates: string[] = [];
  let min = 0;
  let max = 0;
  for (const key of overviewOrder) {
    const definition = bodyMeasurementDefinitions.find((item) => item.key === key)!;
    const reports = buildBodyMeasurementReport(logs, key, asOfDate);
    if (!reports.length) {
      unmeasured.push(definition.label);
      continue;
    }
    const channels = reports.map(toChannel);
    const hasEntries = (channel: MeasurementChannel) => channels.some((item) => item.channel === channel && item.points.length > 0);
    const mixed = hasEntries("single") && (hasEntries("left") || hasEntries("right"));
    const averageReport = mixed ? buildAverageMeasurementReport(logs, key, asOfDate) : null;
    const averageChannel = averageReport ? toChannel(averageReport) : null;
    const average = averageChannel?.changeCm != null ? averageChannel : null;
    for (const channel of average ? [average] : channels) {
      if (channel.changeCm !== null) {
        min = Math.min(min, channel.changeCm);
        max = Math.max(max, channel.changeCm);
      }
    }
    dates.push(...channels.flatMap((channel) => channel.points.map((point) => point.date)));
    rows.push({ key, label: definition.label, group: definition.group, channels, average });
  }
  dates.sort();
  return { rows, unmeasured, window: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null, changeDomainCm: { min, max } };
}

/** The sizes to show as "now": once a part has switched, only the way it is measured today. */
export function currentMeasurementChannels(row: MeasurementOverviewRow) {
  if (!row.average) return row.channels;
  const newest = (channel: MeasurementOverviewChannel) => channel.latest.date;
  const single = row.channels.find((channel) => channel.channel === "single");
  const sides = row.channels.filter((channel) => channel.channel === "left" || channel.channel === "right");
  const singleIsNewest = single && sides.every((channel) => newest(single) > newest(channel));
  return singleIsNewest ? [single] : sides;
}
