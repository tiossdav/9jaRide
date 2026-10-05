-- Where a driver is paid out, and whether they have finished the settlement step that follows approval.
CREATE TABLE driver_payout_accounts (
  driver_id      uuid PRIMARY KEY REFERENCES users(id),
  bank_name      text NOT NULL,
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{10}$'),
  account_name   text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN settlement_done_at timestamptz;
-- Drivers who were approved before this step existed are not sent through it.
UPDATE users SET settlement_done_at = now() WHERE role = 'driver' AND EXISTS (SELECT 1 FROM driver_applications a WHERE a.driver_id = users.id AND a.status = 'APPROVED');
