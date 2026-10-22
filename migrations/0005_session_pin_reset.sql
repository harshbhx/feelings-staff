-- 0005_session_pin_reset.sql (docs/owner-access.md, Passkeys flow 6: forgotten owner PIN).
-- A session-scoped window, like step_up_until: until then this owner session may set a new owner PIN
-- without the old one. Only a fresh sign-in sets it (6-digit code, magic link, or on the owner host a
-- passkey sign-in or first-device enrolment), to the session's created_at + 15 minutes. A password
-- sign-in never does. Any PIN set or change in the session clears it (one reset per sign-in).
-- Additive only: NULL for staff, door and older sessions, and NULL is closed.
-- Numbered after 0004_owner_access.sql (owner access slice 4); the two do not depend on each other.

ALTER TABLE sessions ADD COLUMN pin_reset_until INTEGER;
