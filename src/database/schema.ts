export const schema = `
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  primary_muscle TEXT NOT NULL,
  secondary_muscle TEXT,
  is_strength_exercise INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_date TEXT NOT NULL,
  notes TEXT,
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
  created_at TEXT
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
