import type { BodyMeasurementLog } from "@/types";
import type { BodyCheckIn } from "./types";
import { isCalendarDate } from "./calendar";

/** The weight-only history is a view of check-ins, never another observation authority. */
export function projectBodyCheckIns(logs: readonly BodyMeasurementLog[]): BodyCheckIn[] {
  return logs.map((log) => ({
    id: log.id, recordedDate: isCalendarDate(log.logged_date) ? log.logged_date : null,
    recordedAt: log.logged_at, weightLb: log.weight, circumferencesCm: log.measurements,
    weightSourceUnit: log.weight === null ? null : log.weight_input_unit ? { status: "recorded", unit: log.weight_input_unit } : { status: "unknown", reason: "The original input unit was not stored on this check-in." },
    circumferenceSourceUnit: Object.keys(log.measurements).length ? log.circumference_input_unit ? { status: "recorded", unit: log.circumference_input_unit } : { status: "unknown", reason: "The original tape unit was not stored on this check-in." } : null,
    notes: log.notes ?? null, createdAt: log.created_at, updatedAt: log.updated_at
  }));
}
