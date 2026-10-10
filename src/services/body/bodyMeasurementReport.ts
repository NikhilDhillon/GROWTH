import { addCalendarDays, assertCalendarDate, isCalendarDate } from "@/domain/calendar";
import type { BodyMeasurementLog } from "@/types";
import { bodyMeasurementDefinitions, type BodyMeasurementKey } from "@/utils/bodyMeasurements";
import { todayIso } from "@/utils/date";

export type BodyMeasurementRange = "week" | "month" | "year" | "all";
export type MeasurementChannel = "scalar" | "single" | "left" | "right";
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
  const days = range === "week" ? 7 : range === "month" ? 30 : 365;
  const start = range === "all" ? null : addCalendarDays(end, -(days - 1));
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
