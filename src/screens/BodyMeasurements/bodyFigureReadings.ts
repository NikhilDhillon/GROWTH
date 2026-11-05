import type { MeasurementChannel, MeasurementOverview, MeasurementOverviewRow } from "@/services/body/bodyMeasurementReport";
import type { BodyFigureRegion, BodySide } from "@/screens/BodyMeasurements/bodyFigureShapes";
import type { CircumferenceUnit } from "@/types";
import { BodyMeasurementKey, roundCircumferenceChange } from "@/utils/bodyMeasurements";

/** Tape error is a few millimetres, so a tiny change must never look large just because nothing moved more. */
const minimumScaleCm = 2;
const weakestTint = 0.3;

export type BodyFigureReading = {
  key: BodyMeasurementKey;
  /** The channel this side reads from. Null when the part was measured but never on this side. */
  channel: MeasurementChannel | null;
  changeCm: number | null;
};

/** What one side of one region shows. A side never borrows the opposite side's number.
 * The figure has one arm, so it shows flexed if measured and unflexed otherwise. */
export function bodyFigureReading(rows: MeasurementOverviewRow[], region: BodyFigureRegion, side: BodySide): BodyFigureReading | null {
  const find = (key: BodyMeasurementKey) => rows.find((row) => row.key === key);
  const row = region === "arm" ? find("arm_flexed") ?? find("arm_unflexed") : find(region);
  if (!row) return null;
  if (row.average) return { key: row.key, channel: "average", changeCm: row.average.changeCm };
  const channel = row.channels.find((item) => item.channel === side)
    ?? row.channels.find((item) => item.channel === "single" || item.channel === "scalar");
  return { key: row.key, channel: channel?.channel ?? null, changeCm: channel?.changeCm ?? null };
}

/** Direction and strength for a muscle. "steady" was measured and stayed the same; null has nothing to compare. */
export function bodyFigureTint(changeCm: number | null, unit: CircumferenceUnit, domain: MeasurementOverview["changeDomainCm"]) {
  if (changeCm === null) return null;
  if (roundCircumferenceChange(changeCm, unit) === 0) return { direction: "steady" as const, strength: 1 };
  const fullScale = Math.max(minimumScaleCm, Math.abs(domain.min), Math.abs(domain.max));
  return { direction: changeCm > 0 ? "grew" as const : "shrank" as const, strength: weakestTint + (1 - weakestTint) * Math.min(1, Math.abs(changeCm) / fullScale) };
}

/** The range every row's bar is drawn against, which always includes zero. */
export function changeBarScale({ min, max }: MeasurementOverview["changeDomainCm"]) {
  if (max - min >= minimumScaleCm) return { low: min, high: max };
  return min < 0 && max === 0 ? { low: max - minimumScaleCm, high: max } : { low: min, high: min + minimumScaleCm };
}
