-- 9jaRide core schema: identity stubs, rides, dispatch offers, ledger, safety.
-- Conventions (spec: "Data model"): UUID primary keys, integer kobo for all money,
-- timestamptz everywhere, append-only ledger and audit tables.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- identity (minimal)
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  role        text NOT NULL CHECK (role IN ('rider', 'driver')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES users(id),
  category    text NOT NULL CHECK (category IN ('regular', 'comfort', 'package')),
  make        text NOT NULL,
  colour      text NOT NULL,
  plate       text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX vehicles_one_active_per_driver ON vehicles (driver_id) WHERE active;

-- ---------------------------------------------------------------- rides
CREATE TABLE rides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code       text NOT NULL UNIQUE,
  rider_id         uuid NOT NULL REFERENCES users(id),
  driver_id        uuid REFERENCES users(id),
  category         text NOT NULL CHECK (category IN ('regular', 'comfort', 'package')),
  status           text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'SCHEDULED', 'REQUESTED', 'SEARCHING_DRIVER', 'NO_DRIVER_FOUND',
    'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED',
    'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM')),
  -- payment status is separate from ride status (spec: receipts show "Completed" and "Paid")
  payment_status   text NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'HELD', 'PAID', 'REFUNDED')),
  payment_method   text NOT NULL CHECK (payment_method IN ('cash', 'wallet')),
  pickup           geography(Point, 4326) NOT NULL,
  dropoff          geography(Point, 4326) NOT NULL,
  idempotency_key  text NOT NULL,
  search_started_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- a retry on a bad network must never create a second ride
  UNIQUE (rider_id, idempotency_key)
);
CREATE INDEX rides_status_created ON rides (status, created_at);
CREATE INDEX rides_rider_created ON rides (rider_id, created_at DESC);
CREATE INDEX rides_driver_created ON rides (driver_id, created_at DESC);
-- belt and braces for "one driver is never on two rides": database-level guarantee
CREATE UNIQUE INDEX rides_one_active_per_driver ON rides (driver_id)
  WHERE driver_id IS NOT NULL
    AND status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED');

CREATE TABLE ride_status_history (
  id          bigserial PRIMARY KEY,
  ride_id     uuid NOT NULL REFERENCES rides(id),
  from_status text,
  to_status   text NOT NULL,
  actor_id    uuid,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ride_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES rides(id),
  driver_id   uuid NOT NULL REFERENCES users(id),
  status      text NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'LOST')),
  offered_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (ride_id, driver_id)
);
CREATE INDEX ride_offers_driver_open ON ride_offers (driver_id) WHERE status = 'OFFERED';

-- ---------------------------------------------------------------- ledger
-- Double-entry, append-only. Balances are derived, never stored or edited.
CREATE TABLE ledger_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,            -- e.g. 'platform:cash', 'wallet:<user id>'
  kind        text NOT NULL CHECK (kind IN ('platform', 'wallet', 'commission', 'bonus', 'tax', 'payout', 'stakeholder')),
  owner_id    uuid REFERENCES users(id),
  -- platform/system accounts may go negative; user wallets are guarded in the service layer
  allow_negative boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per business event; its entries must sum to zero.
CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,              -- topup, trip_wallet, trip_cash, bonus, payout, ...
  reference        text NOT NULL,              -- provider reference or ride id
  idempotency_key  text NOT NULL UNIQUE,       -- duplicate webhooks / retries become no-ops
  memo             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              bigserial PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id      uuid NOT NULL REFERENCES ledger_accounts(id),
  -- signed integer kobo: credit positive, debit negative. Never floats.
  amount_kobo     bigint NOT NULL CHECK (amount_kobo <> 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account ON ledger_entries (account_id);
CREATE INDEX ledger_entries_tx ON ledger_entries (transaction_id);

-- Append-only: block UPDATE and DELETE on ledger tables.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Every transaction must balance to zero. Deferred so all entries can be inserted first.
CREATE FUNCTION assert_transaction_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM(amount_kobo), 0) INTO total FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced by % kobo', NEW.transaction_id, total;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();

-- Derived balances.
CREATE VIEW ledger_balances AS
  SELECT account_id, SUM(amount_kobo)::bigint AS balance_kobo
  FROM ledger_entries GROUP BY account_id;

-- Holds reserve wallet money for an assigned ride so it cannot be spent in between.
CREATE TABLE wallet_holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES ledger_accounts(id),
  ride_id     uuid NOT NULL REFERENCES rides(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CAPTURED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id)
);

-- ---------------------------------------------------------------- safety
CREATE TABLE sos_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,        -- the app retries until it gets "stored"
  raised_by       uuid NOT NULL REFERENCES users(id),
  raised_by_role  text NOT NULL CHECK (raised_by_role IN ('rider', 'driver')),
  ride_id         uuid REFERENCES rides(id),
  vehicle_id      uuid REFERENCES vehicles(id),
  location        geography(Point, 4326),
  location_accuracy_m real,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  assigned_to     uuid,
  resolved_at     timestamptz,
  escalated_at    timestamptz,                 -- set when the 60 s on-call escalation fires
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sos_events_open ON sos_events (created_at) WHERE status = 'OPEN';

-- Evidence timeline and call-back log for the Safety Center.
CREATE TABLE sos_timeline (
  id          bigserial PRIMARY KEY,
  sos_id      uuid NOT NULL REFERENCES sos_events(id),
  kind        text NOT NULL CHECK (kind IN ('created', 'location', 'acknowledged', 'assigned', 'escalated', 'sms_sent', 'callback', 'note', 'resolved')),
  actor_id    uuid,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sos_timeline_sos ON sos_timeline (sos_id, created_at);
CREATE TRIGGER sos_timeline_append_only BEFORE UPDATE OR DELETE ON sos_timeline
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Platform accounts every environment needs.
INSERT INTO ledger_accounts (code, kind, allow_negative) VALUES
  ('platform:cash',        'platform',   true),
  ('platform:commission',  'commission', true),
  ('platform:bonus',       'bonus',      true),
  ('platform:tax',         'tax',        true),
  ('platform:payout',      'payout',     true);
