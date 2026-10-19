-- 0003_time_credits_presence.sql (WP-9, PRD 8.2.1): the Time credits ledger and the presence tables.
-- Never an edit of 0001. Settings (timeCredits, presence) live in orgs.settings_json.
-- Two tables are rebuilt because SQLite cannot alter a CHECK: consents (kind gains 'presence_checks')
-- and challenges (purpose gains 'presence', the nonce of a foreground check).

-- Settings live in orgs.settings_json: timeCredits { enabled, startDate, legalOt2x (default true) }, presence { enabled, rollCallTimes[], stepOut, foreground { enabled, intervalMin }, quietDuringBreaks }
ALTER TABLE staff_profiles ADD COLUMN time_credits INTEGER CHECK (time_credits IN (0,1));    -- NULL = org default; 0 = excluded
ALTER TABLE staff_profiles ADD COLUMN presence_enabled INTEGER CHECK (presence_enabled IN (0,1));
ALTER TABLE shift_templates ADD COLUMN break_start TEXT;                  -- optional usual break start "HH:MM" (presence break window)
ALTER TABLE attendance_days ADD COLUMN away_min INTEGER NOT NULL DEFAULT 0;   -- confirmed away minutes of the day
-- consents.kind gains 'presence_checks' (table rebuilt); the manager permission list gains 'rollcall'

-- Time credits (owner only; never exposed on a staff route) ----------------
CREATE TABLE credit_entries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('late','early','away','ot','ot_legal')),
  minutes INTEGER NOT NULL CHECK (minutes <> 0),            -- signed: minus for late/early/away, plus for ot
  source_kind TEXT NOT NULL CHECK (source_kind IN ('punch','presence','ot_decision')),
  source_id TEXT NOT NULL,                                  -- punch id, away_intervals id or ot_decisions id
  confirmed_by TEXT, confirmed_at INTEGER,                  -- owner for away and ot; NULL = automatic
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  engine_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX credit_entries_day_kind ON credit_entries(user_id, work_date, kind)
  WHERE status = 'active' AND kind <> 'away';
CREATE UNIQUE INDEX credit_entries_away ON credit_entries(source_id) WHERE status = 'active' AND kind = 'away';
CREATE INDEX credit_entries_user_date ON credit_entries(org_id, user_id, work_date);

CREATE TABLE credit_adjustments (                           -- owner edits of credits; survive a recompute
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('late','early','away','ot','ot_legal')),
  delta_min INTEGER NOT NULL CHECK (delta_min <> 0),        -- signed change to that day and kind
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  voided_by TEXT, voided_at INTEGER, void_reason TEXT
);
CREATE INDEX credit_adj_user_date ON credit_adjustments(org_id, user_id, work_date);

CREATE TABLE credit_settlements (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  month TEXT NOT NULL,                                      -- period end = last day of this month
  balance_min INTEGER NOT NULL,                             -- signed balance at the period end, before this step
  settle_min INTEGER NOT NULL DEFAULT 0,                    -- owner's choice, signed like the balance, 0 allowed
  applied_min INTEGER NOT NULL DEFAULT 0,                   -- after the 50% cap
  amount_paise INTEGER NOT NULL DEFAULT 0,                  -- signed: negative = cut, positive = earning (1x value of applied_min)
  rate_json TEXT NOT NULL CHECK (json_valid(rate_json)),    -- r_day fraction and S_std used
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings_json)),   -- existing payroll warnings at the time of the step
  status TEXT NOT NULL CHECK (status IN ('draft','applied','void')),
  decided_by TEXT NOT NULL, decided_at INTEGER NOT NULL,
  note TEXT
);
CREATE UNIQUE INDEX credit_settlements_run_user ON credit_settlements(payroll_run_id, user_id) WHERE status <> 'void';
CREATE INDEX credit_settlements_user ON credit_settlements(org_id, user_id, month);

-- Presence (staff may read their own rows; credits stay owner only) -----------
CREATE TABLE roll_calls (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  work_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,                                  -- "15:00", from settings
  slot_ts INTEGER NOT NULL,
  reminded_at INTEGER,                                      -- N32 sent
  submitted_by TEXT, submitted_at INTEGER,                  -- owner or manager; NULL = not done
  edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX roll_calls_slot ON roll_calls(org_id, work_date, slot_time);

CREATE TABLE roll_call_marks (                              -- one row per person who was checked in at the slot
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  roll_call_id TEXT NOT NULL REFERENCES roll_calls(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  mark TEXT NOT NULL CHECK (mark IN ('here','not_here')),
  away_interval_id TEXT REFERENCES away_intervals(id),      -- set for not_here
  marked_by TEXT NOT NULL, marked_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX roll_call_marks_person ON roll_call_marks(roll_call_id, user_id);

CREATE TABLE away_intervals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('roll_call','step_out','mixed')),
  reason TEXT CHECK (reason IN ('personal','lunch','errand','other')),   -- step-out reason chip; NULL for roll-call
  reason_note TEXT, staff_note TEXT,
  start_ts INTEGER NOT NULL, end_ts INTEGER,                -- end NULL while open
  end_reason TEXT CHECK (end_reason IN ('back','roll_call_here','check_out','auto_close','shift_end','owner_edit')),
  back_missing INTEGER NOT NULL DEFAULT 0,                  -- closed without an I'm back
  minutes INTEGER NOT NULL DEFAULT 0,                       -- clipped per §7.18
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','pending','confirmed','work','ignored')),
  roll_call_id TEXT REFERENCES roll_calls(id),
  opened_by TEXT NOT NULL,                                  -- the staff member, or the owner or manager who marked
  decided_by TEXT, decided_at INTEGER,
  edited_by TEXT, edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX away_user_date ON away_intervals(user_id, work_date);
CREATE INDEX away_pending ON away_intervals(org_id, state) WHERE state = 'pending';

CREATE TABLE presence_checks (                              -- optional foreground check; a hint only, no coordinates
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  check_ts INTEGER NOT NULL,                                -- server time
  result TEXT NOT NULL CHECK (result IN ('inside','edge','outside','no_fix')),
  fence_result TEXT CHECK (fence_result IN ('pass','uncertain','outside','approximate')),
  distance_m INTEGER, accuracy_m REAL,                      -- NULLed after 90 days
  distance_bucket TEXT CHECK (distance_bucket IN ('0-50','50-100','100-200','200-500','500+')),
  risk_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(risk_reasons_json)),
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX presence_checks_idem ON presence_checks(user_id, idempotency_key);
CREATE INDEX presence_checks_user_date ON presence_checks(user_id, work_date, check_ts);


-- consents.kind gains 'presence_checks' (table rebuilt) -------------------------------------------
CREATE TABLE consents_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('privacy_notice','selfie','night_work','fines_notice','presence_checks')),
  version TEXT NOT NULL, lang TEXT NOT NULL,
  accepted_at INTEGER NOT NULL, withdrawn_at INTEGER
);
INSERT INTO consents_new (id, org_id, user_id, kind, version, lang, accepted_at, withdrawn_at)
  SELECT id, org_id, user_id, kind, version, lang, accepted_at, withdrawn_at FROM consents;
DROP TABLE consents;
ALTER TABLE consents_new RENAME TO consents;
CREATE INDEX consents_user ON consents(user_id, kind);

-- challenges.purpose gains 'presence' (table rebuilt) ---------------------------------------------
CREATE TABLE challenges_new (
  nonce TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','punch','offline','presence')),
  user_id TEXT, device_id TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
INSERT INTO challenges_new (nonce, org_id, purpose, user_id, device_id, expires_at, used_at)
  SELECT nonce, org_id, purpose, user_id, device_id, expires_at, used_at FROM challenges;
DROP TABLE challenges;
ALTER TABLE challenges_new RENAME TO challenges;
CREATE INDEX challenges_expiry ON challenges(expires_at);
