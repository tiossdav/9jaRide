-- Paying the parties who share the commission (set in Revenue Setup). A request is made by one person and approved by
-- another; approving moves the money in the ledger. Nothing here is edited afterwards.
CREATE TABLE stakeholder_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder     text NOT NULL CHECK (length(stakeholder) BETWEEN 2 AND 60),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  reference       text,
  note            text,
  status          text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'PAID', 'REJECTED')),
  requested_by    uuid NOT NULL,
  approved_by     uuid,
  approved_at     timestamptz,
  rejected_by     uuid,
  rejected_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK ((status = 'PAID') = (approved_at IS NOT NULL))
);
CREATE INDEX stakeholder_payouts_who ON stakeholder_payouts (lower(stakeholder), created_at DESC);

CREATE FUNCTION stakeholder_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'stakeholder payouts cannot be deleted'; END IF;
  IF OLD.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'stakeholder payout % is % and cannot change', OLD.id, OLD.status; END IF;
  IF NEW.stakeholder <> OLD.stakeholder OR NEW.amount_kobo <> OLD.amount_kobo OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'stakeholder payout % terms are immutable once requested', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stakeholder_payouts_guard BEFORE UPDATE OR DELETE ON stakeholder_payouts
  FOR EACH ROW EXECUTE FUNCTION stakeholder_payout_guard();
