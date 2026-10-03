-- Admin essentials: driver onboarding review, refunds and adjustments with a second approver, payment exceptions.

-- ---------------------------------------------------------------- driver onboarding
-- A driver applies with a vehicle and documents. Staff approve, ask for changes, or reject. The vehicle row (the
-- thing dispatch uses) is created only when an application is approved.
CREATE TABLE driver_applications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED')),
  vehicle_category text NOT NULL CHECK (vehicle_category IN ('regular', 'comfort', 'package')),
  vehicle_make     text NOT NULL,
  vehicle_colour   text NOT NULL,
  vehicle_plate    text NOT NULL,
  review_note      text,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'SUBMITTED' OR reviewed_by IS NOT NULL)
);
-- one open application per driver
CREATE UNIQUE INDEX driver_applications_one_open ON driver_applications (driver_id) WHERE status IN ('SUBMITTED', 'CHANGES_REQUESTED');
CREATE INDEX driver_applications_queue ON driver_applications (status, submitted_at);

CREATE TABLE application_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES driver_applications(id),
  kind           text NOT NULL CHECK (kind IN ('drivers_licence', 'vehicle_papers', 'insurance', 'road_worthiness', 'selfie')),
  file_ref       text NOT NULL,                  -- storage key; file upload itself is not built yet
  expires_on     date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, kind)
);

CREATE FUNCTION freeze_decided_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'driver application % is % and cannot change', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_applications_freeze BEFORE UPDATE ON driver_applications
  FOR EACH ROW EXECUTE FUNCTION freeze_decided_application();

-- Why an account was suspended or reinstated, and by whom.
CREATE TABLE user_status_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  status     text NOT NULL CHECK (status IN ('active', 'suspended')),
  reason     text NOT NULL,
  actor_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_status_events_user ON user_status_events (user_id, created_at DESC);
CREATE TRIGGER user_status_events_append_only BEFORE UPDATE OR DELETE ON user_status_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- refunds and adjustments
-- Every manual money movement is asked for by one person and posted only after a different person approves.
INSERT INTO ledger_accounts (code, kind, allow_negative) VALUES ('platform:adjustments', 'platform', true);

CREATE TABLE ledger_adjustments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN (
    'refund',            -- money back to a rider for a completed ride, paid by the platform
    'credit',            -- goodwill or correction in the user's favour, paid by the platform
    'debit',             -- recover money from a wallet (e.g. a driver owing the platform)
    'topup_correction')),-- a real Paystack payment that was never credited correctly
  user_id            uuid NOT NULL REFERENCES users(id),
  ride_id            uuid REFERENCES rides(id),
  provider_reference text,
  amount_kobo        bigint NOT NULL CHECK (amount_kobo > 0),
  reason             text NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED')),
  idempotency_key    text NOT NULL UNIQUE,
  requested_by       uuid NOT NULL,
  approved_by        uuid,
  approved_at        timestamptz,
  rejected_by        uuid,
  rejected_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  settled_at         timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status <> 'POSTED' OR approved_by IS NOT NULL),
  CHECK (status <> 'REJECTED' OR rejected_by IS NOT NULL),
  CHECK (kind <> 'refund' OR ride_id IS NOT NULL),
  CHECK (kind <> 'topup_correction' OR provider_reference IS NOT NULL)
);
CREATE INDEX ledger_adjustments_status ON ledger_adjustments (status, created_at DESC);
CREATE INDEX ledger_adjustments_ride ON ledger_adjustments (ride_id) WHERE ride_id IS NOT NULL;
-- the same provider payment can be corrected only once
CREATE UNIQUE INDEX ledger_adjustments_one_correction ON ledger_adjustments (provider_reference)
  WHERE kind = 'topup_correction' AND status <> 'REJECTED';

CREATE FUNCTION freeze_adjustment_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'adjustments cannot be deleted'; END IF;
  IF NEW.kind <> OLD.kind OR NEW.user_id <> OLD.user_id OR NEW.amount_kobo <> OLD.amount_kobo
     OR NEW.ride_id IS DISTINCT FROM OLD.ride_id OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.requested_by <> OLD.requested_by OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'adjustment % terms are immutable once requested', OLD.id;
  END IF;
  IF OLD.status <> 'PENDING_APPROVAL' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'adjustment % is % and cannot change', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_adjustments_freeze BEFORE UPDATE OR DELETE ON ledger_adjustments
  FOR EACH ROW EXECUTE FUNCTION freeze_adjustment_terms();

-- ---------------------------------------------------------------- payment exceptions
-- Something money-related a person has looked at and decided. Money itself is only ever moved through an adjustment;
-- this records the decision, so the same item stops coming back every hour.
CREATE TABLE exception_resolutions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind    text NOT NULL CHECK (source_kind IN ('intent', 'finding', 'payout')),
  source_id      text NOT NULL,                -- intent reference | '<finding kind>:<reference>' | payout id
  resolution     text NOT NULL CHECK (resolution IN ('corrected', 'dismissed', 'contacted_user')),
  note           text NOT NULL,
  adjustment_id  uuid REFERENCES ledger_adjustments(id),
  resolved_by    uuid NOT NULL,
  resolved_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id),
  CHECK (resolution <> 'corrected' OR adjustment_id IS NOT NULL)
);
CREATE TRIGGER exception_resolutions_append_only BEFORE UPDATE OR DELETE ON exception_resolutions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
