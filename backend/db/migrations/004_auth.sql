-- Authentication: phone OTP for riders and drivers, password login for staff, rotating refresh tokens, staff audit.

ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

-- One row per OTP sent. Only a keyed hash of the code is stored.
CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('sms', 'voice')),
  ip          text,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone ON otp_challenges (phone, created_at DESC);
CREATE INDEX otp_challenges_ip ON otp_challenges (ip, created_at DESC);

CREATE TABLE staff_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name      text NOT NULL,
  role           text NOT NULL CHECK (role IN ('support', 'finance', 'admin')),
  password_hash  text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Refresh tokens: opaque random strings, stored hashed, rotated on every use. A family is one login on one device;
-- presenting an already-used token means it was stolen or replayed, so the whole family is revoked.
CREATE TABLE auth_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('user', 'staff')),
  subject_id   uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_family ON auth_sessions (family_id);
CREATE INDEX auth_sessions_subject ON auth_sessions (subject_kind, subject_id);

-- Everything staff do that changes something. Append-only.
CREATE TABLE staff_audit_log (
  id          bigserial PRIMARY KEY,
  staff_id    uuid NOT NULL,
  method      text NOT NULL,
  path        text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  status_code integer,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_log_staff ON staff_audit_log (staff_id, created_at DESC);
CREATE TRIGGER staff_audit_log_append_only BEFORE UPDATE OR DELETE ON staff_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
