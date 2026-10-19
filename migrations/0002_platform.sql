-- Platform tables added by WP-1 on top of PRD 8.2 (see docs/data-model.md):
-- request idempotency for decision and payroll endpoints (PRD 9.1), and the preview/local outbox
-- that captures pushes, emails and WhatsApp messages instead of sending them (PRD 9.4 test routes).

CREATE TABLE idempotency_keys (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_created ON idempotency_keys(created_at);

CREATE TABLE test_outbox (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push','email','whatsapp')),
  to_addr TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL
);
CREATE INDEX test_outbox_org ON test_outbox(org_id, created_at);
