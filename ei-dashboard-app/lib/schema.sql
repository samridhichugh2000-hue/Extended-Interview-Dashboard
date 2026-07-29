-- EI Dashboard schema — matches the data model in the PRD build notes.

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,          -- e.g. EMP4861
  name TEXT NOT NULL,
  email TEXT,
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
  metric4 TEXT,
  metric5 TEXT,
  metric6 TEXT,
  alert TEXT,                   -- short inline alert label shown in dept table
  active INTEGER NOT NULL DEFAULT 1,  -- 0 once Koenig reports a DOR/LWD (exited)
  neg_audits INTEGER,           -- count of below-satisfactory enquiry audits (Sales only)
  audit_remarks TEXT,           -- JSON array of {createdOn, rating, remark} for below-satisfactory audits
  sc_raised INTEGER,            -- count of SCs (service contracts) raised (Sales only)
  sc_details TEXT,              -- JSON array of {scId, createdOn, status, quotationStatus}
  exam_pass INTEGER,            -- exams passed (Trainer only)
  exam_fail INTEGER,            -- exams failed (Trainer only)
  exam_total INTEGER,           -- total exams taken (Trainer only)
  exam_not_updated INTEGER,     -- exams with result not yet updated (Trainer only)
  neg_feedback INTEGER,         -- count of negative feedback reports (Trainer only)
  neg_feedback_details TEXT,    -- JSON array of {assignmentId, feedbackDate, clientName, question, answer, deliveryMode}
  assignments_count INTEGER,    -- count of training assignments delivered (Trainer only)
  assignments_details TEXT,     -- JSON array of {assignmentId, courseName, startDate, endDate, totalPax, deliveryMode, batchType}
  skills_count INTEGER,         -- count of skills/courses marked (Trainer only)
  skills_details TEXT,          -- JSON array of {courseId, courseName, isDuplicate, isDiscontinued}
  tech_calls_count INTEGER,     -- count of tech calls attended (Sales only)
  tech_calls_details TEXT,      -- JSON array of raw call records (field names unconfirmed — no live sample data)
  tech_calls_converted INTEGER  -- count of tech calls converted (Trainer only)
);

CREATE TABLE IF NOT EXISTS pip_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,           -- PA | PIP
  issued_on TEXT,
  review_by TEXT,
  breaches TEXT,                -- JSON array of breach labels
  comment TEXT,                 -- full incident letter text from Koenig
  is_active INTEGER NOT NULL DEFAULT 1,
  source_id INTEGER             -- Koenig's own incident Id, for idempotent re-sync
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
