import type { ExerciseLoadType } from "@/constants/exercises";
import type {
  BodyMeasurementValues,
  CircumferenceUnit,
  GuidedExerciseCategory,
  SplitMuscle,
  UnitSystem
} from "@/types";

/** A real YYYY-MM-DD date, validated at input boundaries by domain/calendar. */
export type CalendarDate = string;
export type CalendarWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Both endpoints are inclusive calendar dates; elapsed hours are not a date range. */
export type CalendarRange = { startDate: CalendarDate; endDate: CalendarDate };

/** Storage units never establish the units in which a person originally entered a value. */
export type UnitSource<U extends string> =
  | { status: "recorded"; unit: U }
  | { status: "unknown"; reason: string };

export type RecordingOrigin = "manual" | "guided" | "import" | "unknown";

/** A projection of a persisted set. Numeric historical evidence is retained, even when invalid. */
export type ObservedSet = {
  id: number;
  exerciseId: number;
  setNumber: number;
  reps: number;
  /** The recorded external load, added load, or assistance in canonical pounds. */
  loadLb: number;
  isWarmup: boolean;
  /** A stored value alone is not evidence that RIR was measured or entered. */
  rir: number | null;
  rirSource: "recorded" | "unknown" | null;
  sourceUnit: UnitSource<UnitSystem>;
  createdAt: string;
};

/** Identity remains the original session ID. A mixed/empty legacy session has no single exercise. */
export type ExerciseEntry = {
  id: number;
  sessionId: number;
  exerciseId: number | null;
  workoutDate: CalendarDate | null;
  notes: string | null;
  machineProfileId: string | null;
  createdAt: string;
  origin: RecordingOrigin;
  sets: ObservedSet[];
};

/** Workout lifecycle/planning metadata references completed entries; it contains no copied set facts. */
export type Workout = {
  id: string;
  kind: "guided" | "standalone";
  status: "active" | "completed";
  entryIds: number[];
  /** Derived only when referenced observations share one valid date; otherwise unknown. */
  workoutDate: CalendarDate | null;
  startedAt: string | null;
  finishedAt: string | null;
  label: string | null;
  notes: string | null;
  templateId: string | null;
  scheduledDayId: string | null;
  plannedMuscles: SplitMuscle[];
  scheduleChanges: string[];
};

/** Adapter-ready observations accepted by the parser; IDs are assigned by persistence, never invented. */
export type ParsedObservedSet = {
  reps: number;
  /** Canonical pounds, irrespective of the current display preference. */
  weight: number;
  isWarmup: boolean;
};

export type PrescribedSet = {
  setNumber: number;
  isWarmup: boolean;
  targetReps: { minimum: number; maximum: number } | null;
  /** A target remains a prescription even when shown in an entry field. */
  targetLoadLb: number | null;
};

/** A recommendation cannot be supplied where persisted observations are required. */
export type Prescription = {
  exerciseId: number;
  category: GuidedExerciseCategory;
  sets: PrescribedSet[];
  generatedAt: string;
  basedOnEntryIds: number[];
  comparisonContext: ComparisonContext | null;
  /** Equipment used to generate this target, independent of later history edits. */
  equipment?: ComparisonEquipment;
};

export type BodyCheckIn = {
  id: number;
  recordedDate: CalendarDate | null;
  recordedAt: string;
  weightLb: number | null;
  circumferencesCm: BodyMeasurementValues;
  weightSourceUnit: UnitSource<UnitSystem> | null;
  circumferenceSourceUnit: UnitSource<CircumferenceUnit> | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Template identity is independent of the weekday on which it is scheduled. */
export type WorkoutTemplate = {
  id: string;
  label: string;
  muscles: SplitMuscle[];
  exerciseIds: number[];
  createdAt: string | null;
  updatedAt: string | null;
};

/** A recurring weekday points to a template. A rest day has a null template reference. */
export type ScheduledDay = {
  id: string;
  weekday: CalendarWeekday;
  templateId: string | null;
};

export type ComparisonMetric = {
  id: string;
  /** Formula/version identity is explicit; this contract does not change existing formulas. */
  version: string;
  unit: string;
  preferredDirection: "increase" | "decrease" | "neutral";
};

export type ComparisonBaseline =
  | { kind: "first_eligible"; range: CalendarRange }
  | { kind: "previous_eligible" }
  | { kind: "best_eligible"; range: CalendarRange }
  | { kind: "entry"; entryId: number }
  | { kind: "body_check_in"; checkInId: number };

export type ComparisonEquipment =
  | { kind: "machine_profile"; machineProfileId: string }
  | { kind: "non_machine"; loadType: Exclude<ExerciseLoadType, "machine_stack"> }
  | { kind: "not_applicable" }
  | { kind: "unknown"; reason: string };

export type ComparisonFreshness = {
  asOfDate: CalendarDate;
  latestObservationDate: CalendarDate | null;
  staleAfterCalendarDays: number;
};

export type ComparisonCoverage = {
  availableObservationCount: number;
  eligibleObservationCount: number;
  includedObservationIds: number[];
  exclusions: Array<{ observationId: number; reason: string }>;
};

/** Calculation inputs and comparison rules must travel with the result, rather than being implicit UI state. */
export type ComparisonContext = {
  contractVersion: string;
  metric: ComparisonMetric;
  baseline: ComparisonBaseline;
  range: CalendarRange;
  equipment: ComparisonEquipment;
  freshness: ComparisonFreshness;
  coverage: ComparisonCoverage;
};
