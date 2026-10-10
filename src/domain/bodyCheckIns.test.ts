import { expect, it } from "vitest";
import { BodyMeasurementLog } from "@/types";
import { projectBodyCheckIns } from "./bodyCheckIns";
import { bodyWeightLogsFromMeasurements } from "@/utils/bodyMeasurements";

it("keeps bodyweight as a view of one canonical check-in and preserves unknown input units", () => {
  const log: BodyMeasurementLog = { id: 1, weight: 176, measurements: { waist: 80, arm_flexed: { mode: "sides", left: 34, right: 35 } }, notes: "Measured", logged_date: "2026-10-01", logged_at: "2026-10-01T12:00:00Z", created_at: "2026-10-01", updated_at: "2026-10-01" };
  const checkIn = projectBodyCheckIns([log])[0];
  expect(checkIn.weightLb).toBe(176);
  expect(checkIn.circumferencesCm).toEqual(log.measurements);
  expect(checkIn.weightSourceUnit?.status).toBe("unknown");
  expect(bodyWeightLogsFromMeasurements([log], "kg")[0].weight).toBe(checkIn.weightLb);
  expect(projectBodyCheckIns([{ ...log, weight: null }])[0].weightLb).toBeNull();
});
