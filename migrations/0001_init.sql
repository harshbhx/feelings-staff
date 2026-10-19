-- Feelings Staff initial schema. Copied exactly from docs/PRD.md section 8.2.
-- Never edit after release: later changes go in new files (0002_*.sql, ...).

-- Tenancy and people ------------------------------------------------------
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  owner_display_name TEXT NOT NULL,          -- "Urmi" in staff copy
  address TEXT,
  phone_e164 TEXT,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  settings_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  name TEXT NOT NULL,
  phone_e164 TEXT,                            -- required for staff and managers
  email TEXT,                                 -- required for the owner
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','gu')),
  status TEXT NOT NULL CHECK (status IN ('invited','active','suspended','exited')),
  pin_hash TEXT, pin_salt TEXT, pin_set_at INTEGER,
  pin_failures INTEGER NOT NULL DEFAULT 0,
  pin_failures_24h INTEGER NOT NULL DEFAULT 0,
  pin_window_start INTEGER,
  pin_locked_until INTEGER,
  password_hash TEXT, password_salt TEXT, password_iter INTEGER,
  permissions_json TEXT CHECK (permissions_json IS NULL OR json_valid(permissions_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  exited_at INTEGER
);
CREATE UNIQUE INDEX users_org_phone ON users(org_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND status <> 'exited';
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX users_org_role ON users(org_id, role, status);

CREATE TABLE shift_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  segments_json TEXT NOT NULL CHECK (json_valid(segments_json)), -- [{"start":"10:00","end":"20:00"}]
  break_min INTEGER NOT NULL DEFAULT 0 CHECK (break_min BETWEEN 0 AND 180),
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX shift_templates_org ON shift_templates(org_id, active);

CREATE TABLE staff_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  employee_code TEXT,
  designation TEXT NOT NULL,
  join_date TEXT NOT NULL,
  exit_date TEXT,
  exit_reason TEXT,
  default_template_id TEXT NOT NULL REFERENCES shift_templates(id),
  week_off_dow INTEGER CHECK (week_off_dow BETWEEN 0 AND 6),   -- 0 = Sunday
  selfie_required INTEGER,                     -- NULL = org default
  strong_mode INTEGER NOT NULL DEFAULT 0,
  divisor_override TEXT CHECK (divisor_override IN ('calendar','fixed30','fixed26','working')),
  ot_rate_override_json TEXT CHECK (ot_rate_override_json IS NULL OR json_valid(ot_rate_override_json)),
  enrolled_photo_key TEXT,                     -- R2 key, only if selfies are on
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX staff_profiles_org ON staff_profiles(org_id);

CREATE TABLE salary_history (                  -- effective-dated pay
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  effective_from TEXT NOT NULL,                -- YYYY-MM-DD
  salary_type TEXT NOT NULL CHECK (salary_type IN ('monthly','daily')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX salary_history_user ON salary_history(user_id, effective_from);

-- Auth --------------------------------------------------------------------
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,              -- HMAC(SESSION_SECRET, code)
  purpose TEXT NOT NULL CHECK (purpose IN ('join','pin_reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  failed_tries INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX invites_user ON invites(user_id, created_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  public_jwk TEXT NOT NULL CHECK (json_valid(public_jwk)),
  jwk_thumbprint TEXT NOT NULL UNIQUE,         -- RFC 7638
  label TEXT NOT NULL,                         -- "Redmi Note 12 · Chrome"
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','desktop','other')),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
  requested_at INTEGER NOT NULL,
  decided_at INTEGER, decided_by TEXT,
  approved_at INTEGER,
  revoked_reason TEXT,
  last_seen_at INTEGER
);
CREATE UNIQUE INDEX devices_one_approved ON devices(user_id) WHERE status = 'approved';
CREATE INDEX devices_org_status ON devices(org_id, status);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                 -- SHA-256 of the cookie token
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL CHECK (kind IN ('user','door')),
  user_id TEXT REFERENCES users(id),
  device_id TEXT,                              -- devices.id or door_devices.id
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  step_up_until INTEGER,
  ip_hmac TEXT,
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE challenges (                      -- login challenges and punch nonces
  nonce TEXT PRIMARY KEY,                      -- 32 random bytes, base64url
  org_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','punch','offline')),
  user_id TEXT, device_id TEXT,
  expires_at INTEGER NOT NULL,                 -- 5 min (login, punch), 24 h (offline)
  used_at INTEGER
);
CREATE INDEX challenges_expiry ON challenges(expires_at);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  ip_hmac TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX magic_links_email ON magic_links(email, created_at);

-- Places ------------------------------------------------------------------
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL CHECK (kind IN ('salon','venue')),
  name TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  radius_m INTEGER NOT NULL CHECK (radius_m BETWEEN 50 AND 500),
  max_accuracy_m INTEGER NOT NULL CHECK (max_accuracy_m BETWEEN 30 AND 100),
  active INTEGER NOT NULL DEFAULT 1,
  valid_from INTEGER, valid_to INTEGER,        -- venues only
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sites_org ON sites(org_id, kind, active);

CREATE TABLE door_devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  label TEXT NOT NULL,
  secret_enc TEXT NOT NULL,                    -- AES-GCM with QR_MASTER_KEY
  secret_version INTEGER NOT NULL DEFAULT 1,
  pairing_code_hash TEXT, pairing_expires_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pairing','active','revoked')),
  paired_at INTEGER, last_seen_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE calibration_samples (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  session_id TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, accuracy_m REAL NOT NULL,
  platform TEXT, taken_at INTEGER NOT NULL
);
CREATE INDEX calibration_site ON calibration_samples(site_id, session_id);

CREATE TABLE salon_networks (                  -- positive risk signal
  org_id TEXT NOT NULL,
  ip_hmac TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (org_id, ip_hmac)
);

-- Schedule ----------------------------------------------------------------
CREATE TABLE roster_overrides (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('template','week_off','no_shift')),
  template_id TEXT REFERENCES shift_templates(id),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_date)
);
CREATE INDEX roster_org_date ON roster_overrides(org_id, work_date);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1,
  worked_comp TEXT NOT NULL DEFAULT 'extra_pay' CHECK (worked_comp IN ('comp_off','extra_pay','both')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX holidays_org_date ON holidays(org_id, date);

CREATE TABLE blackout_days (
  org_id TEXT NOT NULL, date TEXT NOT NULL, note TEXT,
  PRIMARY KEY (org_id, date)
);

CREATE TABLE offsite_duties (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT REFERENCES sites(id),          -- NULL for mode 'anywhere'
  work_date TEXT NOT NULL,
  start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL CHECK (end_ts > start_ts),
  mode TEXT NOT NULL CHECK (mode IN ('geofence','anywhere','approval')),
  ot_preapproved INTEGER NOT NULL DEFAULT 1,
  place_name TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX offsite_org_date ON offsite_duties(org_id, work_date);
CREATE TABLE offsite_duty_staff (
  duty_id TEXT NOT NULL REFERENCES offsite_duties(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (duty_id, user_id)
);
CREATE INDEX offsite_staff_user ON offsite_duty_staff(user_id);

CREATE TABLE ot_preapprovals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
  note TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX ot_pre_user_date ON ot_preapprovals(user_id, work_date);

-- Attendance --------------------------------------------------------------
CREATE TABLE punches (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT,                              -- NULL for owner/auto
  kind TEXT NOT NULL CHECK (kind IN ('in','out','break_start','break_end')),
  server_ts INTEGER NOT NULL,                  -- first receipt
  effective_ts INTEGER NOT NULL,               -- the time used for pay
  client_ts INTEGER,
  work_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('online','offline','owner','auto')),
  site_id TEXT REFERENCES sites(id),
  offsite_duty_id TEXT REFERENCES offsite_duties(id),
  place_name TEXT,                             -- unplanned venue
  lat REAL, lng REAL,                          -- best fix, 5 decimals; NULLed after 90 days
  accuracy_m REAL,
  distance_m INTEGER,
  distance_bucket TEXT CHECK (distance_bucket IN ('0-50','50-100','100-200','200-500','500+')),
  fence_result TEXT CHECK (fence_result IN ('pass','uncertain','outside','approximate','none')),
  samples_n INTEGER, samples_spread_m REAL,
  qr_step INTEGER,                             -- floor(t/30) of the accepted door token
  pin_verified INTEGER NOT NULL DEFAULT 0,
  sig_verified INTEGER NOT NULL DEFAULT 0,
  selfie_key TEXT, selfie_sha256 TEXT, selfie_deleted_at INTEGER,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(risk_reasons_json)),
  status TEXT NOT NULL CHECK (status IN ('accepted','flagged','pending','rejected','superseded')),
  pending_reason TEXT,
  ip_country TEXT, ip_asn INTEGER,
  device_tz TEXT, clock_skew_ms INTEGER,
  app_version TEXT, client_duration_ms INTEGER,
  idempotency_key TEXT NOT NULL,
  note TEXT,
  reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT,
  replaces_punch_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX punches_idem ON punches(user_id, idempotency_key);
CREATE UNIQUE INDEX punches_qr_once ON punches(user_id, qr_step) WHERE qr_step IS NOT NULL;
CREATE INDEX punches_user_date ON punches(user_id, work_date);
CREATE INDEX punches_org_date ON punches(org_id, work_date);
CREATE INDEX punches_review ON punches(org_id, status) WHERE status IN ('flagged','pending');

CREATE TABLE attendance_days (                 -- derived, recomputed by the engine
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('work','WO','HO','NE')),
  template_id TEXT,
  scheduled_min INTEGER NOT NULL DEFAULT 0,
  worked_min INTEGER NOT NULL DEFAULT 0,
  break_min INTEGER NOT NULL DEFAULT 0,
  late_min INTEGER NOT NULL DEFAULT 0, late_billable_min INTEGER NOT NULL DEFAULT 0,
  early_min INTEGER NOT NULL DEFAULT 0, early_billable_min INTEGER NOT NULL DEFAULT 0,
  overbreak_min INTEGER NOT NULL DEFAULT 0,
  makeup_min INTEGER NOT NULL DEFAULT 0,
  undertime_min INTEGER NOT NULL DEFAULT 0,
  ot_preapproved_min INTEGER NOT NULL DEFAULT 0,
  ot_candidate_min INTEGER NOT NULL DEFAULT 0,
  ot_approved_min INTEGER NOT NULL DEFAULT 0,
  ot_status TEXT NOT NULL DEFAULT 'none' CHECK (ot_status IN ('none','pending','approved','partial','rejected')),
  status TEXT NOT NULL CHECK (status IN ('P','H','A','L','LOP','WO','HO','NE','OPEN')),
  leave_type_code TEXT,
  offday_credit REAL NOT NULL DEFAULT 0 CHECK (offday_credit IN (0, 0.5, 1)),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  override_json TEXT CHECK (override_json IS NULL OR json_valid(override_json)),
  engine_version TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  payroll_run_id TEXT,
  PRIMARY KEY (user_id, work_date)
);
CREATE INDEX attendance_org_date ON attendance_days(org_id, work_date);
CREATE INDEX attendance_org_status ON attendance_days(org_id, status, work_date);

CREATE TABLE ot_decisions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL, work_date TEXT NOT NULL,
  candidate_min INTEGER NOT NULL, approved_min INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','partial','rejected','auto')),
  decided_by TEXT, decided_at INTEGER NOT NULL, note TEXT
);
CREATE INDEX ot_decisions_user_date ON ot_decisions(user_id, work_date);

CREATE TABLE regularisations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('missed_in','missed_out','wrong_time','offsite_unplanned')),
  target_punch_id TEXT,
  proposed_in_ts INTEGER, proposed_out_ts INTEGER,
  place_name TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT, decided_at INTEGER, decision_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX regularisation_open ON regularisations(user_id, work_date) WHERE status = 'pending';
CREATE INDEX regularisation_org ON regularisations(org_id, status);

-- Leave -------------------------------------------------------------------
CREATE TABLE leave_types (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  code TEXT NOT NULL CHECK (code IN ('CL','SL','EL','CO','LOP')),
  name TEXT NOT NULL,
  paid INTEGER NOT NULL,
  annual_quota REAL,
  accrual TEXT NOT NULL CHECK (accrual IN ('annual','earned','event','none')),
  carry_max REAL,
  usable_after_days INTEGER NOT NULL DEFAULT 0,
  notice_days INTEGER NOT NULL DEFAULT 0,
  backdate_days INTEGER NOT NULL DEFAULT 0,
  expiry_days INTEGER,                         -- comp-off
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX leave_types_org_code ON leave_types(org_id, code);

CREATE TABLE leave_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit','debit','expire','adjust')),
  days REAL NOT NULL CHECK (days * 2 = CAST(days * 2 AS INTEGER)),
  ref_type TEXT, ref_id TEXT,
  expires_on TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX leave_ledger_user ON leave_ledger(user_id, leave_type_id, entry_date);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  half TEXT NOT NULL DEFAULT 'none' CHECK (half IN ('none','first','second')),
  days_paid REAL NOT NULL, days_unpaid REAL NOT NULL,
  reason TEXT,
  blackout_hit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT, decided_at INTEGER, decision_note TEXT,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX leave_requests_org ON leave_requests(org_id, status, from_date);
CREATE INDEX leave_requests_user ON leave_requests(user_id, from_date);

-- Money -------------------------------------------------------------------
CREATE TABLE advances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  given_on TEXT,
  mode TEXT CHECK (mode IN ('cash','upi','bank')),
  reason TEXT,
  plan TEXT NOT NULL CHECK (plan IN ('full','instalments')),
  instalments_n INTEGER CHECK (instalments_n BETWEEN 1 AND 12),
  first_month TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','active','closed','rejected','cancelled')),
  staff_ack TEXT NOT NULL DEFAULT 'pending' CHECK (staff_ack IN ('pending','confirmed','disputed')),
  staff_ack_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX advances_user ON advances(user_id, status);

CREATE TABLE advance_recoveries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  advance_id TEXT NOT NULL REFERENCES advances(id),
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL,
  scheduled_paise INTEGER NOT NULL,
  recovered_paise INTEGER NOT NULL,
  carried_paise INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX advance_recovery_once ON advance_recoveries(advance_id, payroll_run_id);

CREATE TABLE fines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL,
  month TEXT NOT NULL, rule_code TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  show_cause_at INTEGER NOT NULL,
  staff_response TEXT, acknowledged_at INTEGER, owner_confirmed_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed','applied','waived','lapsed')),
  payroll_run_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  month TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('draft','finalised','superseded')),
  settings_snapshot_json TEXT NOT NULL CHECK (json_valid(settings_snapshot_json)),
  engine_version TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  opened_at INTEGER,
  finalised_by TEXT, finalised_at INTEGER,
  reopened_reason TEXT
);
CREATE UNIQUE INDEX payroll_runs_month ON payroll_runs(org_id, month, revision);

CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('incentive','bonus','other_earning','arrears','damage','other_deduction','recovery')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note TEXT NOT NULL,
  show_cause_ref TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX adjustments_run_user ON adjustments(payroll_run_id, user_id);

CREATE TABLE payslips (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)), -- PayslipResult + display data
  gross_paise INTEGER NOT NULL, deductions_paise INTEGER NOT NULL,
  net_paise INTEGER NOT NULL, rounding_paise INTEGER NOT NULL,
  pdf_key TEXT,
  pdf_status TEXT NOT NULL DEFAULT 'pending' CHECK (pdf_status IN ('pending','ready','failed')),
  verify_token TEXT NOT NULL UNIQUE,
  paid_on TEXT, pay_mode TEXT CHECK (pay_mode IN ('cash','upi','bank')), pay_ref TEXT,
  paid_marked_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX payslips_run_user ON payslips(payroll_run_id, user_id);
CREATE INDEX payslips_user ON payslips(user_id, created_at);

-- Notifications, consent, audit, ops ---------------------------------------
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT REFERENCES users(id),
  device_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  platform TEXT,
  created_at INTEGER NOT NULL,
  last_success_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subs_user ON push_subscriptions(user_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                          -- N1..N31 codes, e.g. 'late_checkin'
  title TEXT NOT NULL, body TEXT,
  url TEXT NOT NULL,
  data_json TEXT CHECK (data_json IS NULL OR json_valid(data_json)),
  priority TEXT NOT NULL CHECK (priority IN ('high','normal')),
  topic TEXT, batch_key TEXT,
  push_status TEXT NOT NULL DEFAULT 'none' CHECK (push_status IN ('none','held','queued','sent','failed')),
  push_sent_at INTEGER, opened_at INTEGER,
  wa_status TEXT, email_status TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);
CREATE INDEX notifications_held ON notifications(org_id, push_status) WHERE push_status = 'held';

CREATE TABLE notification_prefs (
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  push INTEGER NOT NULL DEFAULT 1,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  email INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, event_type)
);

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('privacy_notice','selfie','night_work','fines_notice')),
  version TEXT NOT NULL, lang TEXT NOT NULL,
  accepted_at INTEGER NOT NULL, withdrawn_at INTEGER
);
CREATE INDEX consents_user ON consents(user_id, kind);

CREATE TABLE audit_log (                       -- append-only: no UPDATE or DELETE except retention
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('change','security','access','export')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system','door')),
  actor_id TEXT,
  action TEXT NOT NULL,                        -- e.g. 'punch.reject', 'settings.update'
  entity TEXT NOT NULL, entity_id TEXT,
  before_json TEXT, after_json TEXT,
  reason TEXT,
  ip_hmac TEXT, request_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_org_time ON audit_log(org_id, created_at);
CREATE INDEX audit_entity ON audit_log(entity, entity_id);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL, format TEXT NOT NULL CHECK (format IN ('csv','pdf')),
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','ready','failed')),
  r2_key TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE cron_runs (                       -- idempotency for scheduled rules
  job TEXT NOT NULL, org_id TEXT NOT NULL, slot TEXT NOT NULL,   -- slot: e.g. '2026-10-19|late|<userId>'
  ran_at INTEGER NOT NULL, result TEXT,
  PRIMARY KEY (job, org_id, slot)
);

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- min_app_version, schema notes
