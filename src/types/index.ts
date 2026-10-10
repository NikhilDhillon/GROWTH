export type MuscleGroup = "Chest" | "Back" | "Shoulders" | "Traps" | "Biceps" | "Triceps" | "Legs" | "Core" | "Forearms";

export type UnitSystem = "lb" | "kg";
export type CircumferenceUnit = "in" | "cm";
export type GuidedExerciseCategory = "hypertrophy" | "strength" | "top_set" | "unguided";
export type MachineStackUnit = UnitSystem | "plate";
export type MachineProfileType =
  | "single_pulley"
  | "dual_pulley"
  | "lat_pulldown"
  | "low_row"
  | "cable_crossover"
  | "selectorized";

export type MachineProfile = {
  id: string;
  label: string;
  machineType: MachineProfileType;
  stackUnit: MachineStackUnit;
  increment: number;
  minLoad: number;
  maxLoad: number;
  pulleyRatio: "unknown" | "1:1" | "2:1" | "4:1";
  location?: string;
  modelName?: string;
  notes?: string;
  exerciseIds: number[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
};

export type GuidedWorkoutPreferences = {
  hypertrophyTargetReps: number;
  hypertrophyRepDecrement: number;
  strengthTargetReps: number;
  topSetTargetReps: number;
  backoffPercentage: number;
  inactivityDays: number;
  exerciseCategories: Record<string, GuidedExerciseCategory>;
};

export type Exercise = {
  id: number;
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscle?: MuscleGroup | null;
  is_strength_exercise: number;
  created_at: string;
};

export type UserExercisePreference = {
  user_id: number | string;
  exercise_id: number;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type WorkoutSession = {
  id: number;
  workout_date: string;
  notes?: string | null;
  machine_profile_id?: string | null;
  /** Unit of the current recorded revision; historical rows may not have this evidence. */
  input_unit?: UnitSystem | null;
  /** Capture origin, independent of the editable observation values. */
  recording_origin?: "manual" | "guided" | "import" | null;
  created_at: string;
};

export type WorkoutSet = {
  id: number;
  session_id: number;
  exercise_id: number;
  set_number: number;
  reps: number;
  weight: number;
  rir?: number | null;
  is_warmup?: number | boolean | null;
  created_at: string;
};

export type BodyWeightLog = {
  id: number;
  weight: number;
  unit: UnitSystem;
  logged_at: string;
  logged_date?: string;
  created_at: string;
};

export type BodyUnitPreferences = {
  weight: UnitSystem;
  circumference: CircumferenceUnit;
};

export type BodyLimbMeasurement =
  | { mode: "single"; value: number }
  | { mode: "sides"; left?: number; right?: number };

export type BodyMeasurementValues = {
  arm_unflexed?: BodyLimbMeasurement;
  arm_flexed?: BodyLimbMeasurement;
  calves?: BodyLimbMeasurement;
  chest?: number;
  forearm?: BodyLimbMeasurement;
  abdomen?: number;
  thinnest_waist?: number;
  thigh?: BodyLimbMeasurement;
  waist?: number;
};

export type BodyMeasurementLog = {
  id: number;
  weight: number | null;
  measurements: BodyMeasurementValues;
  notes?: string | null;
  logged_at: string;
  logged_date: string;
  created_at: string;
  updated_at: string;
  weight_input_unit?: UnitSystem | null;
  circumference_input_unit?: CircumferenceUnit | null;
};

export type User = {
  id: number | string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export type Friend = {
  id: string;
  name: string;
  email?: string | null;
  status: "pending" | "accepted" | "declined";
  direction: "sent" | "received";
  split_sync_status?: "none" | "sent" | "received" | "synced";
  split_sync_request_id?: string | null;
  created_at: string;
};

export type FriendInvite = {
  id: string;
  token: string;
  invite_url: string;
  expires_at: string;
  accepted_by?: string | null;
  created_at: string;
};

export type LeaderboardEntry = {
  user_id: string;
  name: string;
  exercise_id: number;
  exercise_name: string;
  best_estimated_1rm: number;
  best_sets?: Array<{ weight: number; reps: number }>;
  achieved_at: string;
};

export type SocialData = {
  friends: Friend[];
  invites: FriendInvite[];
  leaderboard: LeaderboardEntry[];
  /** Explicit direct consenting recipients of weekly plan edits, including self. */
  syncMemberIds?: string[];
  notice?: string | null;
};

export type SplitMuscle = "Chest" | "Triceps" | "Back" | "Biceps" | "Legs" | "Shoulders" | "Traps" | "Forearms" | "Abs";

export type TrainingSplitDay = {
  key: string;
  label: string;
  muscles: SplitMuscle[];
};

export type TrainingSplit = {
  days: TrainingSplitDay[];
  updated_at: string | null;
  updated_by: string | null;
};

export type MuscleStrengthConfig = {
  id: number;
  muscle_group: MuscleGroup;
  exercise_id: number;
  weight_factor: number;
};

export type LoggedSetDraft = {
  reps: string;
  weight: string;
  isWarmup?: boolean;
  /** Explicit guided confirmation, valid only for the entered values and recording context. */
  observationConfirmation?: string;
};

export type ActiveWorkoutExerciseDraft = {
  /** The prescription shown for this draft; it never supplies performed observations. */
  prescription?: import("@/domain/types").Prescription;
  /** Persisted operation identity, never a second copy of completed observations. */
  requestId?: string;
  /** Explicit unit bound to entered values and pending writes, so retries cannot reinterpret them. */
  requestUnit?: UnitSystem;
  muscle: MuscleGroup | null;
  exerciseId: number | null;
  machineProfileId?: string | null;
  sets: LoggedSetDraft[];
  notes: string;
  barWeight: string;
  plateCounts: Record<string, number>;
};

export type CompletedWorkoutExercise = {
  exerciseId: number;
  sessionId?: number;
  machineProfileId?: string | null;
  machineProfileLabel?: string | null;
  exerciseName: string;
  muscle: MuscleGroup;
  sets: LoggedSetDraft[];
  completedAt: string;
  guidedOutcome?: GuidedSessionOutcome;
};

export type GuidedSessionOutcome = {
  category: GuidedExerciseCategory;
  celebrated: boolean;
  messages: string[];
};

export type ActiveWorkout = {
  /** Durable aggregate identity, independent of its start time. Legacy drafts are upgraded explicitly. */
  workoutId?: string;
  /** Optimistic concurrency token assigned by persistence. */
  revision?: number;
  startedAt: string;
  workoutDate: string;
  todayDayKey: string;
  sourceDayKey: string;
  workoutLabel?: string;
  /** Explicit template identity; historical labels do not imply a template ID. */
  templateId?: string;
  plannedMuscles: SplitMuscle[];
  completedExercises: CompletedWorkoutExercise[];
  currentExercise: ActiveWorkoutExerciseDraft;
  pendingMuscle: MuscleGroup | null;
  schedulePrompt: "off_plan" | "replace" | null;
  scheduleChanges: string[];
};

export type CompletedGuidedWorkout = ActiveWorkout & {
  id: string;
  finishedAt: string;
};

export type WorkoutRecommendationRow = {
  setNumber: number;
  weight: number;
  priorReps: number;
  minimumReps: number;
  maximumReps: number;
  requiresLoadChange: boolean;
};

export type ExerciseScorePoint = {
  exerciseId: number;
  sessionId: number;
  exerciseName: string;
  date: string;
  performancePoints: number;
  estimated1RM: number;
  failureVolume: number;
  fatigueResistance: number;
  normalizedStrength: number;
  normalizedVolume: number;
  normalizedResistance: number;
  score: number;
  volume: number;
  topSet: number;
  workingSets: Array<{ weight: number; reps: number }>;
  /** Historical calculations always use the first eligible entry in this context. */
  metricVersion?: string;
  comparisonKey?: string;
  baselineSessionId?: number;
  comparisonContext?: import("@/domain/types").ComparisonContext;
  comparability?: "comparable" | "self_context";
  machineProfileId?: string | null;
  loadType?: import("@/constants/exercises").ExerciseLoadType;
  bodyWeightEstimate?: BodyWeightEstimationEvidence | null;
};

export type BodyWeightEstimationEvidence = {
  observationId: number;
  observationDate: string;
  ageCalendarDays: number;
  weightLb: number;
  /** The weight is an observation; carrying it to another day is an estimate. */
  isEstimated: boolean;
};

export type MuscleScoreCoverage = {
  source: "configured" | "first_observed";
  cohortStartDate: string | null;
  members: Array<{ exerciseId: number; comparisonKey: string | null; weightFactor: number }>;
  includedSessionIds: number[];
  includedObservations: Array<{ exerciseId: number; sessionId: number; date: string; comparisonKey: string; score: number }>;
  missingExerciseIds: number[];
  staleExerciseIds: number[];
  exclusions: Array<{ sessionId: number; reason: string }>;
  totalWeight: number;
  availableWeight: number;
  complete: boolean;
};

export type MuscleScorePoint = {
  muscle: MuscleGroup;
  date: string;
  /** Missing or stale cohort members withhold the full aggregate. */
  score: number | null;
  metricVersion?: string;
  cohortKey?: string;
  coverage?: MuscleScoreCoverage;
};

export type BulkAnalyticsRange = "7d" | "14d" | "30d" | "60d" | "90d" | "all";

export type BulkAnalyticsScope =
  | { scope: "exercise"; exerciseId: number; comparisonKey?: string }
  | { scope: "muscle"; muscleGroup: MuscleGroup }
  | { scope: "overall" };
