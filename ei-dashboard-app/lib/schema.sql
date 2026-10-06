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
  rc_main_assignments_count INTEGER,  -- count of distinct assignments this Trainer was Main Trainer on, from the Trainer RC Schedule feed (koenigTrainerRcApi.js) — unlike assignments_details above, this feed's TrainerRole field tells a lead trainer apart from a co/backup trainer on the same batch. Feeds the PA Algo's "zero assignments as main trainer" check (lib/paAlgo.js) — not the same population as assignments_count.
  rc_main_assignments_details TEXT,   -- JSON array of {assignmentId, courseName, startDate, endDate}, one per distinct Main Trainer assignment
  skills_count INTEGER,         -- count of skills/courses marked (Trainer only)
  skills_details TEXT,          -- JSON array of {courseId, courseName, isDuplicate, isDiscontinued}
  in_house_skills_count INTEGER,  -- count of courses marked in-house (Trainer only)
  in_house_skills_details TEXT,   -- JSON array of {courseId, courseName, markedBy, trainerName, trainerActive, markDate}
  tech_calls_count INTEGER,     -- count of tech calls attended (Sales only)
  tech_calls_details TEXT,      -- JSON array of raw call records (field names unconfirmed — no live sample data)
  tech_calls_converted INTEGER, -- count of tech calls converted (Trainer only)
  tbt_count INTEGER,            -- count of TBTs requested (Trainer only)
  tbt_details TEXT,             -- JSON array of {topic, requestedOn, tbtDate}
  shoddy_neg_count INTEGER,      -- count of negative shoddy incidents (Sales/Trainer/PT)
  shoddy_neg_details TEXT,        -- JSON array of {name, reportedDate, repMngr, reason, errorId, incidentType, incidentNature}
  shoddy_pos_count INTEGER,      -- count of positive incidents (Sales/Trainer/PT)
  shoddy_pos_details TEXT,        -- JSON array of {name, reportedDate, repMngr, reason, errorId, incidentType, incidentNature}
  polls_participated INTEGER,    -- count of polls participated in (All teams). NULL means the polls dashboard has no record for this email, not a confirmed 0.
  kgt_count INTEGER,             -- count of KGTs (ownership-transfer requests) participated in (All teams). NULL means the polls dashboard has no record for this emp_code, not a confirmed 0.
  kgt_details TEXT,              -- JSON array of {kgt_id, topic, department, submitted_at, release_date, closure_date}
  mgr_feedback_count INTEGER,    -- count of manager feedback entries on file (All teams)
  mgr_feedback_details TEXT,     -- JSON array of {managerEmpCode, managerName, strength, improvement, other, date}
  meetings_count INTEGER,        -- count of Teams meetings tracked from the rep's calendar (Sales only, via Graph API Calls)
  meetings_late_count INTEGER,   -- of those, joined later than ON_TIME_GRACE_SECONDS after scheduled start
  meetings_missed_count INTEGER, -- of those, never joined at all (meeting already ended)
  av_issue_count INTEGER,        -- of those, a matched callRecords webhook flagged an audio/video quality problem
  external_meetings_count INTEGER, -- of those, had at least one non-@koenig-solutions.com attendee/organizer (a "client meeting"). Feeds the "External meetings < 1 per week" Worry Index signal (Sales only).
  unreplied_email_count INTEGER, -- Inbox threads addressed to the employee with no reply from them, older than the grace period, excluding ads/promotional/system mail (counts only, no email content is stored)
  unreplied_email_total INTEGER, -- threads that qualified for the check (denominator for the count above)
  unreplied_synced_at TEXT,
  external_email_count INTEGER,  -- total Outlook Sent Items emails to non-@koenig-solutions.com addresses in the lookback window (Sales only). Purely informational — not a Worry Index signal, since emailing external contacts is the normal shape of a Sales rep's job.
  external_email_details TEXT,   -- JSON array of {address, count, lastSentAt}, top 100 addresses by count
  external_email_daily TEXT,     -- JSON array of {date, count}, oldest to newest, always exactly the last 14 UTC calendar days (zero-filled) — powers the trend graph in the employee modal
  ideas_count INTEGER,           -- count of Non-RMS tasks on file (All teams) — feeds the "Ideas for improvement" Worry Index signal
  ideas_details TEXT,            -- JSON array of {autoTaskId, taskExecutorName, raisedByEmpId, raisedByName, sourceName, taskStatus, taskDescription, createdByActualName, createdDateTime}
  roster_count INTEGER,           -- count of shift entries on file from the Get CSM Roster feed (Sales only). Purely informational, shown on the Graph API Calls screen — not a Worry Index signal.
  roster_details TEXT,            -- JSON array of {startDate, startTime, endDate, endTime}, newest first
  net_payable_month TEXT,         -- 'YYYY-MM' the payroll snapshot below is for (Sales/CSMs and Trainers only — see PA Algo). Not a Worry Index signal, not exposed directly on the dashboard — PA Algo's salary-multiple criteria only.
  net_payable_details TEXT,       -- JSON: raw Koenig "Net Payable Details" row for that month (Leave_BF, Leave_Granted, Payable_Days, PayScale, PF, TDS, Salary, ...)
  common_index_points REAL,       -- Koenig "Common Index" TotalPoint (All teams). Shown plainly in every dept table — not a Worry Index signal.
  country TEXT,                   -- from Koenig "Get Employee Details (PMS)" (Sales/CSMs and Trainers — see PA Algo). Used to scope PA Algo's salary-multiple criteria to India-based CSMs first. NULL = not yet synced.
  emp_city TEXT,                  -- same feed, same scope — informational only.
  emp_state TEXT,                 -- same feed, same scope — informational only.
  is_overseas INTEGER,            -- same feed's Is_oversease flag, same scope — cross-check against country, not authoritative on its own.
  designation TEXT,               -- same feed's designation_name, same scope — informational only.
  util_monthly_details TEXT,      -- JSON array of {month: 'MMM YYYY', hours, util} (Trainer only), oldest to newest, full ~14-month history from the Koenig Utilization feed (metric1-6 only ever kept the trailing 6 months as display strings). Powers the Trainer PA Algo's 180/270/360-day trailing-utilization windows (approximated as 6/9/12 trailing calendar months).
  rc_fully_booked_week TEXT,      -- ISO week (e.g. '2026-W40') the two columns below were last computed for, from the 'rcfullybooked' sync feed (Trainer only). weeklyReportRunner's Monday check-in send only trusts rc_fully_booked_sc_hours when this matches the current week — otherwise it fails open (sends the check-in) rather than trusting stale/missing data.
  rc_fully_booked_sc_hours REAL,  -- total 'SC' (Scheduled Class) hours this Trainer is booked for in the week named above. >= 40 means they're skipped from that week's check-in send (see FULLY_BOOKED_SC_HOURS in lib/weeklyReportRunner.js). Precomputed by its own ~8AM IST cron so the 9AM weeklyreport cron doesn't have to call Koenig's RC Schedule API live, per Trainer, inside its own 60s function limit (that inline loop timed the whole send out on 2026-09-28).
  nr_monthly_details TEXT,        -- JSON array of {month: 'Mon-YYYY', nr: <number>} (Sales only), oldest to newest, ~13-month trailing history from the Koenig CC/ENR feed (metric1-6 only ever kept the trailing 6 months as pre-formatted "₹X.XL" display strings). Powers the Sales PA Algo's ROI-since-joining and trailing-12-month-average NR checks (lib/paAlgo.js's computeSalesPaAlgoFlag).
  quarter_target_pct REAL,        -- Achieved_Percentage for this employee's most recent quarter on file, from the Koenig "Get Target Achieved Details" feed (Sales only). NULL = not yet synced / no record for this employee. Purely informational — not a Worry Index or PA Algo signal.
  quarter_target_name TEXT,       -- e.g. 'Q2' — which quarter quarter_target_pct is for
  quarter_target_year TEXT,       -- e.g. '2026' — which year quarter_target_pct is for
  quarter_target_remarks TEXT,    -- Koenig's own Remarks field for that quarter, if any
  quarter_target_amount REAL,     -- current-quarter CSM target amount (rupees) from the Koenig "Get Targets Data" feed (Sales only) — the achievement % Sales PA Algo shows is computed from this against nr_monthly_details, not from quarter_target_pct above (that feed has never returned data).
  pipeline_months TEXT,           -- JSON array of {mon, monDate, expectedNR, deals}, the current month plus the next 5, from the Koenig Sales Pipeline feed (Sales/CSM only). Purely informational — not a Worry Index or PA Algo signal.
  pipeline_undated_nr REAL,       -- expectedNR of the feed's "No date" bucket — real pipeline with no training month attached yet, kept separate per the feed's own guidance rather than folded into a month.
  pipeline_undated_deals INTEGER,
  pipeline_total_nr REAL,         -- sum of pipeline_months + pipeline_undated_nr
  pipeline_total_deals INTEGER,
  nr_future_details TEXT,         -- JSON array of {month: 'Mon-YYYY', nr: <number>} (Sales only), the 6 calendar months AFTER the current one, from the same Koenig CC/ENR feed as nr_monthly_details but with a future end date. Kept out of nr_monthly_details on purpose: PA Algo trailing-average/ROI checks must only ever see past + current months.
  pipeline_synced_at TEXT         -- ISO timestamp of the last successful sync for this employee — each CSM is a separate ~3s API call, so this can lag by longer than other feeds mid-run.
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
  state TEXT NOT NULL,          -- Pending | Received (Overdue is derived live, not stored)
  q1 TEXT, a1 TEXT,
  q2 TEXT, a2 TEXT,
  ai_rating TEXT,
  ai_rating_reason TEXT,        -- one-sentence rationale Claude gave for ai_rating
  token TEXT UNIQUE,            -- public submission-link token
  shoddy_marked_at TEXT,         -- set once a shoddy incident has been marked with Koenig for this non-response, so the job doesn't double-mark on a re-run
  shoddy_incident_id TEXT        -- Koenig's IncidentId for that marked shoddy, if it returned one
);

-- Graph API Calls: one row per Teams meeting instance found on a Sales rep's
-- Outlook calendar, with their own join/leave times pulled from the
-- meeting's attendanceReports. call_record_id/av_issue* stay NULL until a
-- matching notification lands on the callRecords webhook (see
-- app/api/graph/callrecords-webhook) — there is no way to fetch call quality
-- on demand, only via that push notification.
-- A recurring meeting keeps the same join_url across every occurrence, so
-- the natural key is (employee, join_url, scheduled_start) rather than just
-- (employee, join_url).
CREATE TABLE IF NOT EXISTS graph_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  subject TEXT,
  organizer_email TEXT,
  scheduled_start TEXT NOT NULL,  -- ISO UTC
  scheduled_end TEXT,             -- ISO UTC
  join_url TEXT NOT NULL,
  online_meeting_id TEXT,         -- NULL when resolveOnlineMeeting couldn't find it (e.g. organized outside this tenant)
  joined_at TEXT,                 -- this employee's earliest join, ISO UTC — NULL if they never joined
  left_at TEXT,
  attendance_seconds INTEGER,
  delay_seconds INTEGER,          -- joined_at minus scheduled_start, negative means they joined early
  timing_status TEXT NOT NULL,    -- On Time | Late | Did Not Join | No Data
  call_record_id TEXT,
  av_issue INTEGER,               -- 0/1, NULL until a call record is matched
  av_issue_details TEXT,          -- JSON: which streams/metrics tripped the audio/video thresholds
  client_emails TEXT,             -- JSON array of attendee/organizer addresses whose domain isn't @koenig-solutions.com — empty array means no external participant (an internal-only meeting), not "not checked yet"
  recording_count INTEGER,        -- Teams recordings found for this occurrence (0 = none made), NULL = not checkable (no online_meeting_id) or not checked yet
  recording_checked_at TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(employee_id, join_url, scheduled_start)
);

-- Raw landing zone for Graph's callRecords webhook notifications. There is no
-- list/filter API for call records, only a push notification per completed
-- call, so every one that arrives is kept here and best-effort matched to a
-- graph_meetings row by organizer + time proximity (matched flips to 1 once
-- that happens, so a retried/duplicate notification doesn't re-match).
CREATE TABLE IF NOT EXISTS graph_call_records (
  id TEXT PRIMARY KEY,
  organizer_email TEXT,
  start_datetime TEXT,
  end_datetime TEXT,
  has_audio_issue INTEGER,
  has_video_issue INTEGER,
  quality_summary TEXT,           -- JSON, per-stream metrics behind the two flags above
  matched INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);

-- Lifecycle of the Graph subscription that drives the callRecords webhook —
-- subscriptions on this resource expire (~70h max) and must be renewed
-- before then or notifications stop arriving silently.
CREATE TABLE IF NOT EXISTS graph_subscriptions (
  id TEXT PRIMARY KEY,            -- Graph's subscription id
  resource TEXT NOT NULL,
  expiration_datetime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  renewed_at TEXT
);

-- One row per scheduled/on-demand email job, overwritten on every attempt —
-- a "last run" status, not a history log. Lets the dashboard show "Email
-- trigger failed" for weeklyreport / weeklyresponsereport / report15
-- without a separate monitoring system.
CREATE TABLE IF NOT EXISTS job_runs (
  job TEXT PRIMARY KEY,         -- weeklyreport | weeklyresponsereport | report15 | trainerrc | rcfullybooked
  status TEXT NOT NULL,         -- ok | error | started (written before the real work begins, see recordJobStarted in lib/jobStatus.js, so a hard kill like a 60s function timeout leaves a trace instead of nothing — getFailedJobRuns treats one stuck at 'started' past a few minutes as a probable timeout/crash)
  message TEXT,
  ran_at TEXT NOT NULL          -- ISO timestamp of the last attempt
);
