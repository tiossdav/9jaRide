-- Business rules that admins can change without a release: commission, how tax is treated, who shares the commission,
-- and the cancellation policy. Each change is a new version with a start time, proposed by one admin and approved by a
-- different one. An approved version never changes, so a past trip can always be explained by the rules in force then.
CREATE TABLE setting_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL CHECK (key IN ('revenue', 'cancellation')),
  value          jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  created_by     uuid NOT NULL,
  approved_by    uuid,
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, effective_from),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE INDEX setting_versions_lookup ON setting_versions (key, effective_from DESC) WHERE approved_at IS NOT NULL;

CREATE FUNCTION freeze_approved_setting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_at IS NOT NULL THEN RAISE EXCEPTION 'approved setting version % cannot be deleted', OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.approved_at IS NOT NULL THEN RAISE EXCEPTION 'approved setting version % is immutable', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setting_versions_freeze BEFORE UPDATE OR DELETE ON setting_versions
  FOR EACH ROW EXECUTE FUNCTION freeze_approved_setting();

-- Starting values: what the system already did before these became editable. Two different system ids satisfy the
-- "approved by someone else" rule for these seeds only.
INSERT INTO setting_versions (key, value, effective_from, created_by, approved_by, approved_at) VALUES
  ('revenue',
   '{"commissionBps": 1200, "taxBase": "excluded", "shares": [{"name": "Platform", "bps": 10000}]}',
   '1970-01-01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now()),
  ('cancellation',
   '{"enabled": false, "windowDays": 7, "minRequests": 10, "tiers": [{"fromPct": 20, "toPct": 34, "penaltyMinutes": 2}, {"fromPct": 35, "toPct": 49, "penaltyMinutes": 5}, {"fromPct": 50, "toPct": 100, "penaltyMinutes": 10}]}',
   '1970-01-01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());
