export type MuscleGroup = "Chest" | "Back" | "Shoulders" | "Biceps" | "Triceps" | "Legs" | "Core";

export type TrendStatus = "Increasing" | "Stable" | "Decreasing";
export type UnitSystem = "lb" | "kg";

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
  achieved_at: string;
};

export type SocialData = {
  friends: Friend[];
  invites: FriendInvite[];
  leaderboard: LeaderboardEntry[];
  notice?: string | null;
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
