-- 0004_owner_access.sql (ADR-19, docs/owner-access.md "Data model"): passkeys on approved owner devices,
-- device requests, admin recovery codes and the single-use WebAuthn challenges. Additive only: nothing
-- reads these tables or columns while the Worker variable OWNER_HOST is unset.

ALTER TABLE users ADD COLUMN passkey_enrolled_at INTEGER;     -- first passkey of an owner; then no email-code sign-in on the owner host
ALTER TABLE sessions ADD COLUMN passkey_id TEXT;              -- owner_passkeys.id the session signed in with (12 h idle, 7 days absolute)

CREATE TABLE owner_passkeys (                                 -- one WebAuthn credential = one approved device
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL UNIQUE,                         -- base64url, as the authenticator reported it
  public_key TEXT NOT NULL,                                   -- base64url COSE public key (ES256 or RS256)
  sign_count INTEGER NOT NULL DEFAULT 0,                      -- last signature counter; 0 stays 0 for synced passkeys
  transports TEXT,                                            -- JSON array of transport hints
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','desktop','other')),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  removed_at INTEGER,
  removed_by TEXT                                             -- users.id, or 'recovery' when a recovery enrolment replaced it
);
CREATE INDEX owner_passkeys_user ON owner_passkeys(org_id, user_id);

CREATE TABLE owner_device_requests (                          -- "Add this device": approved on a device that has a passkey
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT REFERENCES users(id),                          -- the owner who decided; NULL while pending
  code TEXT NOT NULL,                                         -- 6 digits shown on the new device, compared on the approving one
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','desktop','other')),
  city TEXT,                                                  -- city of the request only, for the approval card
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired')),
  approved_by_credential TEXT,                                -- owner_passkeys.id that approved it
  enrol_token_hash TEXT NOT NULL UNIQUE,                      -- HMAC of the token the new device keeps
  ip_hmac TEXT,
  expires_at INTEGER NOT NULL,                                -- 15 minutes after created_at
  decided_at INTEGER,                                         -- approval opens a 10-minute enrolment window
  used_at INTEGER,                                            -- the new device created its passkey
  created_at INTEGER NOT NULL
);
CREATE INDEX owner_device_requests_status ON owner_device_requests(org_id, status, expires_at);

CREATE TABLE owner_recovery_codes (                           -- issued by an admin with scripts/owner-recovery.mjs
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  issued_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                                -- 24 hours
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE owner_passkey_challenges (                       -- single use, 5 minutes
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('signin','confirm','enrol')),
  challenge TEXT NOT NULL UNIQUE,                             -- base64url, 32 random bytes
  user_id TEXT,                                               -- enrol and confirm: the owner it was issued to
  session_hash TEXT,                                          -- enrol and confirm: the session it was issued to
  passkey_id TEXT,                                            -- confirm: the only credential it accepts
  request_id TEXT,                                            -- enrol through a device request or a recovery code
  ip_hmac TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX owner_passkey_challenges_ip ON owner_passkey_challenges(ip_hmac, created_at);
CREATE INDEX owner_passkey_challenges_org ON owner_passkey_challenges(org_id, created_at);
