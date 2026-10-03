-- Team management: a phone number, a "must change password" flag for invited staff, and the last sign-in time.
ALTER TABLE staff_users
  ADD COLUMN phone text,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN invited_by uuid;
