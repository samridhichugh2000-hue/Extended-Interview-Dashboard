-- EI Dashboard schema — matches the data model in the PRD build notes.

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,          -- e.g. EMP4861
  name TEXT NOT NULL,
  team TEXT NOT NULL,           -- Sales | Trainer | PT Team
  manager TEXT NOT NULL,
  doj TEXT NOT NULL,            -- date of joining, display format
  tenure_days INTEGER NOT NULL,
  status TEXT NOT NULL,         -- In Progress | PA Issued | PIP Issued | Confirmed
  score REAL NOT NULL,          -- current Worry Index
  trend_note TEXT,
  hr_note TEXT,
  metric1 TEXT,                 -- role-specific dept metrics, e.g. net revenue / utilisation / tasks
  metric2 TEXT,
  metric3 TEXT,
  alert TEXT                    -- short inline alert label shown in dept table
);

CREATE TABLE IF NOT EXISTS pip_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,           -- PA | PIP
  issued_on TEXT,
  review_by TEXT,
  breaches TEXT                 -- JSON array of breach labels
);

CREATE TABLE IF NOT EXISTS hr_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  label TEXT NOT NULL,          -- e.g. "Tech calls attended (4)"
  weight TEXT NOT NULL,         -- minor | average | major
  points REAL NOT NULL,         -- signed credit points
  recorded_on TEXT
);

CREATE TABLE IF NOT EXISTS manager_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  milestone TEXT NOT NULL,      -- d30 | d60 | d90
  quality TEXT NOT NULL,        -- below | satisfactory | above
  comment TEXT
);

CREATE TABLE IF NOT EXISTS weekly_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  week TEXT NOT NULL,           -- e.g. 2026-W30
  sent_at TEXT,
  received_at TEXT,
  state TEXT NOT NULL,          -- Received | Overdue
  q1 TEXT, a1 TEXT,
  q2 TEXT, a2 TEXT,
  ai_rating TEXT
);
