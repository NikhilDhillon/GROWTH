export type MuscleGroup = "Chest" | "Back" | "Shoulders" | "Traps" | "Biceps" | "Triceps" | "Legs" | "Core" | "Forearms";

export type TrendStatus = "Increasing" | "Stable" | "Decreasing";
export type UnitSystem = "lb" | "kg";
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
};

export type ActiveWorkoutExerciseDraft = {
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
  startedAt: string;
  workoutDate: string;
  todayDayKey: string;
  sourceDayKey: string;
  workoutLabel?: string;
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
};

export type MuscleScorePoint = {
  muscle: MuscleGroup;
  date: string;
  score: number;
};

export type MuscleSummary = {
  muscle: MuscleGroup;
  score: number;
  percentChange: number;
  trend: TrendStatus;
  contributors: string[];
};

export type BulkAnalyticsRange = "7d" | "14d" | "30d" | "60d" | "90d" | "all";

export type BulkAnalyticsScope =
  | { scope: "exercise"; exerciseId: number }
  | { scope: "muscle"; muscleGroup: MuscleGroup }
  | { scope: "overall" };
