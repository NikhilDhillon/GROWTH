export const bodyMeasurementSchema = `
CREATE TABLE IF NOT EXISTS body_measurement_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weight REAL,
  measurements TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  logged_at TEXT NOT NULL,
  logged_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  weight_input_unit TEXT CHECK (weight_input_unit IN ('lb', 'kg')),
  circumference_input_unit TEXT CHECK (circumference_input_unit IN ('cm', 'in'))
);

CREATE INDEX IF NOT EXISTS body_measurement_logs_logged_at_idx ON body_measurement_logs(logged_at DESC);
`;

export const baseSchema = `
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  primary_muscle TEXT NOT NULL,
  secondary_muscle TEXT,
  is_strength_exercise INTEGER DEFAULT 1,
  created_at TEXT,
  creator_id INTEGER,
  load_type TEXT CHECK (load_type IN ('external', 'machine_stack', 'bodyweight_plus_load', 'bodyweight_minus_assistance'))
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_date TEXT NOT NULL,
  notes TEXT,
  machine_profile_id TEXT,
  input_unit TEXT CHECK (input_unit IN ('lb', 'kg')),
  recording_origin TEXT CHECK (recording_origin IN ('manual', 'guided', 'import')),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  set_number INTEGER,
  reps INTEGER,
  weight REAL,
  rir REAL,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  performed_at TEXT,
  evidence TEXT CHECK (evidence IN ('typed', 'flow', 'planned', 'recalled')),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_write_requests (
  request_id TEXT PRIMARY KEY,
  session_id INTEGER,
  payload TEXT NOT NULL
);

-- Receipts identify one complete body check-in write. They remain after the
-- observation is deleted, so a delayed retry cannot recreate that observation.
CREATE TABLE IF NOT EXISTS body_check_in_write_requests (
  request_id TEXT PRIMARY KEY,
  body_id INTEGER,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_records (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_entry_references (
  session_id INTEGER PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workout_records(id),
  prescription TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS workout_entry_references_workout_idx ON workout_entry_references(workout_id);

CREATE TABLE IF NOT EXISTS retired_active_workouts (
  workout_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS body_weight_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weight REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'lb',
  logged_at TEXT NOT NULL,
  logged_date TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS body_weight_logs_logged_at_idx ON body_weight_logs(logged_at DESC);

CREATE TABLE IF NOT EXISTS muscle_strength_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muscle_group TEXT NOT NULL,
  exercise_id INTEGER NOT NULL,
  weight_factor REAL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS user_exercise_preferences (
  user_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id INTEGER NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const schema = `${baseSchema}\n${bodyMeasurementSchema}`;
