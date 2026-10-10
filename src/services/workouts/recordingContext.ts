import type { BodyWeightEstimationEvidence, UnitSystem } from "@/types";
import type { BodyWeightLookup } from "@/services/body/bodyWeightService";
import { formatBodyWeight } from "@/utils/units";

export function bodyweightEvidenceMessage(evidence: BodyWeightEstimationEvidence, unit: UnitSystem) {
  return `Bodyweight ${formatBodyWeight(evidence.weightLb, unit)}, recorded ${evidence.observationDate}. ${evidence.isEstimated
    ? `Estimated for this workout date from an observation ${evidence.ageCalendarDays} calendar days old.` : "Same-day observed weight."}`;
}
export function bodyweightLookupMessage(lookup: BodyWeightLookup, unit: UnitSystem) {
  if (lookup.status === "available") return bodyweightEvidenceMessage(lookup, unit);
  if (lookup.reason === "stale_prior_observation") return `Bodyweight-dependent feedback is unavailable: the latest prior weight was recorded ${lookup.latestObservationDate}, ${lookup.ageCalendarDays} calendar days earlier. The limit is 14 days. Sets can still be saved.`;
  return "Bodyweight-dependent feedback is unavailable: no valid prior weight exists for this workout date. Sets can still be saved.";
}
