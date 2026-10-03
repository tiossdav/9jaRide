-- Fare engine: versioned pricing, 5-minute quotes, immutable per-ride fare snapshots.
-- Rates live in data (spec: "Rates live in data, not code"); money is integer kobo; distance is integer
-- metres and time is integer seconds, so a float like 0.65000000000000001 km can never be stored.

CREATE TABLE pricing_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category                text NOT NULL CHECK (category IN ('regular', 'comfort', 'package')),
  zone                    text NOT NULL DEFAULT 'lagos',
  effective_from          timestamptz NOT NULL,
  base_kobo               bigint NOT NULL CHECK (base_kobo >= 0),
  per_km_kobo             bigint NOT NULL CHECK (per_km_kobo >= 0),
  per_minute_kobo         bigint NOT NULL CHECK (per_minute_kobo >= 0),
  waiting_per_minute_kobo bigint NOT NULL DEFAULT 0 CHECK (waiting_per_minute_kobo >= 0),
  free_waiting_seconds    integer NOT NULL DEFAULT 0 CHECK (free_waiting_seconds >= 0),
  tax_kobo                bigint NOT NULL DEFAULT 0 CHECK (tax_kobo >= 0),
  rounding_step_kobo      bigint NOT NULL DEFAULT 1000 CHECK (rounding_step_kobo > 0),
  -- estimate band around the expected fare, in basis points (8500 = 85%)
  estimate_low_bps        integer NOT NULL DEFAULT 8500 CHECK (estimate_low_bps BETWEEN 1 AND 10000),
  estimate_high_bps       integer NOT NULL DEFAULT 11000 CHECK (estimate_high_bps >= 10000),
  quote_validity_seconds  integer NOT NULL DEFAULT 300 CHECK (quote_validity_seconds > 0),
  -- a fee change needs a second approver; nobody approves their own (spec: "Fee changes")
  created_by              uuid NOT NULL,
  approved_by             uuid,
  approved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, zone, effective_from),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE INDEX pricing_versions_lookup ON pricing_versions (category, zone, effective_from DESC) WHERE approved_at IS NOT NULL;

-- A version can be approved once, then it is frozen: old receipts must always be explainable by it.
CREATE FUNCTION freeze_approved_pricing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_at IS NOT NULL THEN RAISE EXCEPTION 'approved pricing version % cannot be deleted', OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.approved_at IS NOT NULL THEN RAISE EXCEPTION 'approved pricing version % is immutable', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pricing_versions_freeze BEFORE UPDATE OR DELETE ON pricing_versions
  FOR EACH ROW EXECUTE FUNCTION freeze_approved_pricing();

CREATE TABLE fare_quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id           uuid NOT NULL REFERENCES users(id),
  category           text NOT NULL CHECK (category IN ('regular', 'comfort', 'package')),
  pricing_version_id uuid NOT NULL REFERENCES pricing_versions(id),
  distance_m         integer NOT NULL CHECK (distance_m >= 0),
  duration_s         integer NOT NULL CHECK (duration_s >= 0),
  expected_kobo      bigint NOT NULL,
  low_kobo           bigint NOT NULL,
  high_kobo          bigint NOT NULL,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (low_kobo <= expected_kobo AND expected_kobo <= high_kobo)
);

-- The ride remembers which quote and which pricing version priced it (fee changes apply to new rides only).
ALTER TABLE rides
  ADD COLUMN fare_quote_id uuid REFERENCES fare_quotes(id),
  ADD COLUMN pricing_version_id uuid REFERENCES pricing_versions(id);

-- Immutable fare snapshot, written once at completion.
CREATE TABLE ride_fares (
  ride_id              uuid PRIMARY KEY REFERENCES rides(id),
  pricing_version_id   uuid NOT NULL REFERENCES pricing_versions(id),
  distance_m           integer NOT NULL CHECK (distance_m >= 0),
  duration_s           integer NOT NULL CHECK (duration_s >= 0),
  waiting_s            integer NOT NULL CHECK (waiting_s >= 0),
  subtotal_kobo        bigint NOT NULL,   -- sum of the lines before rounding
  rounding_kobo        bigint NOT NULL,   -- shown as its own receipt line
  tax_kobo             bigint NOT NULL,   -- the flat daily tax line, remitted to the LSGA account
  total_kobo           bigint NOT NULL,   -- what the rider is charged
  outside_quote_range  boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (total_kobo = subtotal_kobo + rounding_kobo)
);

CREATE TABLE ride_fare_lines (
  id          bigserial PRIMARY KEY,
  ride_id     uuid NOT NULL REFERENCES ride_fares(ride_id),
  position    smallint NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('service', 'distance', 'time', 'waiting', 'tax', 'rounding')),
  label       text NOT NULL,
  amount_kobo bigint NOT NULL,
  UNIQUE (ride_id, position),
  UNIQUE (ride_id, kind)
);

CREATE TRIGGER ride_fares_append_only BEFORE UPDATE OR DELETE ON ride_fares
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ride_fare_lines_append_only BEFORE UPDATE OR DELETE ON ride_fare_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A receipt's lines must add up to its total. This is the "fare breakdown that does not add up" defect,
-- made impossible: checked at commit, after all of a ride's lines are inserted.
CREATE FUNCTION assert_fare_lines_match_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lines_total bigint; expected bigint;
BEGIN
  SELECT COALESCE(SUM(amount_kobo), 0) INTO lines_total FROM ride_fare_lines WHERE ride_id = NEW.ride_id;
  SELECT total_kobo INTO expected FROM ride_fares WHERE ride_id = NEW.ride_id;
  IF lines_total <> expected THEN
    RAISE EXCEPTION 'fare lines for ride % sum to % kobo but the total is % kobo', NEW.ride_id, lines_total, expected;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ride_fare_lines_match_total AFTER INSERT ON ride_fare_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_fare_lines_match_total();
