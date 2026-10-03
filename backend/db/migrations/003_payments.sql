-- Payments and payouts: Paystack top-ups, webhook audit log, hourly reconciliation, payouts with a second approver.
-- Money stays integer kobo. Money only ever moves through the ledger (001); these tables track the provider side.

-- ---------------------------------------------------------------- top-ups
CREATE TABLE payment_intents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  provider         text NOT NULL DEFAULT 'paystack',
  reference        text NOT NULL UNIQUE,           -- ours; sent to the provider, comes back on the webhook
  amount_kobo      bigint NOT NULL CHECK (amount_kobo > 0),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',          -- waiting for the provider
    'SUCCESS',          -- verified with the provider and credited to the wallet
    'FAILED',           -- the provider says it failed or was abandoned
    'AMOUNT_MISMATCH'   -- provider charged a different amount or currency: NOT credited, needs a person
  )),
  provider_amount_kobo bigint,                     -- what the provider says it collected (kept for AMOUNT_MISMATCH)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  credited_at      timestamptz,
  CHECK ((status = 'SUCCESS') = (credited_at IS NOT NULL))
);
CREATE INDEX payment_intents_pending ON payment_intents (created_at) WHERE status = 'PENDING';
CREATE INDEX payment_intents_user ON payment_intents (user_id, created_at DESC);

-- Every authenticated webhook delivery, as received. Audit only: idempotency lives on the intent and the ledger key.
CREATE TABLE provider_events (
  id          bigserial PRIMARY KEY,
  provider    text NOT NULL,
  event_type  text NOT NULL,
  reference   text,
  payload     jsonb NOT NULL,
  outcome     text,                                -- credited | duplicate | ignored | mismatch | unknown_reference | error
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_events_reference ON provider_events (reference);
CREATE TRIGGER provider_events_no_delete BEFORE DELETE ON provider_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- payouts
-- Requesting a payout moves the money out of the driver wallet into platform:payout straight away, so the same
-- balance cannot be withdrawn twice. A failed or rejected payout posts a reversal. The ledger holds the truth.
CREATE TABLE payout_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          uuid NOT NULL REFERENCES users(id),
  amount_kobo        bigint NOT NULL CHECK (amount_kobo > 0),
  bank_code          text NOT NULL,
  account_number     text NOT NULL CHECK (account_number ~ '^[0-9]{10}$'),
  account_name       text NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN (
    'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED')),
  idempotency_key    text NOT NULL UNIQUE,         -- a retried request must not create a second payout
  provider_reference text UNIQUE,                  -- sent to the provider so a retried transfer cannot pay twice
  requested_by       uuid NOT NULL,                -- the driver, or staff acting for them
  approved_by        uuid,
  approved_at        timestamptz,
  rejected_reason    text,
  failure_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  processing_at      timestamptz,
  settled_at         timestamptz,
  -- nobody approves their own payout (spec: second approver)
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status IN ('PENDING_APPROVAL', 'REJECTED') OR approved_by IS NOT NULL)
);
CREATE INDEX payout_requests_open ON payout_requests (status, created_at)
  WHERE status IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING');
CREATE INDEX payout_requests_driver ON payout_requests (driver_id, created_at DESC);

-- What was approved is what gets paid: the amount, destination and requester are frozen once the row exists.
CREATE FUNCTION freeze_payout_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payout requests cannot be deleted'; END IF;
  IF NEW.driver_id <> OLD.driver_id OR NEW.amount_kobo <> OLD.amount_kobo OR NEW.bank_code <> OLD.bank_code
     OR NEW.account_number <> OLD.account_number OR NEW.account_name <> OLD.account_name
     OR NEW.requested_by <> OLD.requested_by OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'payout % terms are immutable once requested', OLD.id;
  END IF;
  -- terminal states are final
  IF OLD.status IN ('PAID', 'FAILED', 'REJECTED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'payout % is % and cannot change', OLD.id, OLD.status;
  END IF;
  -- an approval, once given, is never replaced
  IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'payout % approval cannot be changed', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_requests_freeze BEFORE UPDATE OR DELETE ON payout_requests
  FOR EACH ROW EXECUTE FUNCTION freeze_payout_terms();

-- ---------------------------------------------------------------- reconciliation
CREATE TABLE reconciliation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  window_from   timestamptz NOT NULL,
  window_to     timestamptz NOT NULL,
  recovered     integer NOT NULL DEFAULT 0,        -- credits/settlements the run completed itself
  findings      integer NOT NULL DEFAULT 0,        -- things a person must look at
  error         text
);

CREATE TABLE reconciliation_findings (
  id          bigserial PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES reconciliation_runs(id),
  kind        text NOT NULL,   -- unknown_reference | amount_mismatch | credit_without_provider_success | payout_stuck | payout_paid_after_failure | ledger_imbalance
  reference   text,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_findings_run ON reconciliation_findings (run_id);
