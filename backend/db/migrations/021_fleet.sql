-- Who owns a vehicle, a central list of vehicles businesses supply, who drives which one, and what comes off a driver's
-- earnings toward it. Added next to the existing tables: nothing here changes how a driver who owns their car works.

-- ---------------------------------------------------------------- businesses and owners
CREATE TABLE businesses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 120),
  contact_name  text,
  phone         text,
  email         text,
  -- the share of a driver's earnings this business usually takes toward its vehicles; it is the starting value when a vehicle is assigned
  default_deduction_bps integer NOT NULL DEFAULT 2000 CHECK (default_deduction_bps BETWEEN 0 AND 9000),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The party that is paid when a deduction is taken: an individual who lends their car, or a business.
CREATE TABLE vehicle_owners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('individual', 'business')),
  name        text NOT NULL,
  phone       text,
  business_id uuid REFERENCES businesses(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'business') = (business_id IS NOT NULL))
);
CREATE UNIQUE INDEX vehicle_owners_one_per_business ON vehicle_owners (business_id) WHERE business_id IS NOT NULL;

-- Owners are paid from their own ledger account, `owner:<id>`.
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_kind_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind_check CHECK (kind IN ('platform', 'wallet', 'commission', 'bonus', 'tax', 'payout', 'stakeholder', 'owner'));

-- ---------------------------------------------------------------- the vehicle list
CREATE TABLE fleet_vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES vehicle_owners(id),
  business_id  uuid REFERENCES businesses(id),
  plate        text NOT NULL UNIQUE CHECK (plate ~ '^[A-Z0-9]{5,10}$'),
  make_model   text NOT NULL CHECK (length(make_model) BETWEEN 2 AND 80),
  colour       text NOT NULL CHECK (length(colour) BETWEEN 2 AND 30),
  category     text NOT NULL REFERENCES asset_types(code),
  model_year   integer CHECK (model_year BETWEEN 1990 AND 2100),
  vin          text,
  notes        text,
  -- "verified" means the vehicle has been checked and may be given to a driver
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended', 'retired')),
  verified_by  uuid,
  verified_at  timestamptz,
  vehicle_id   uuid REFERENCES vehicles(id),      -- the live vehicle record while a driver has it
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);
CREATE INDEX fleet_vehicles_business ON fleet_vehicles (business_id, status);

CREATE TABLE fleet_vehicle_images (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  file_id          uuid NOT NULL REFERENCES uploaded_files(id),
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fleet_vehicle_id, file_id)
);

-- Files can now be uploaded by staff as well as by drivers, so the owner is no longer tied to the users table.
ALTER TABLE uploaded_files DROP CONSTRAINT IF EXISTS uploaded_files_owner_id_fkey;
ALTER TABLE uploaded_files ADD COLUMN owner_kind text NOT NULL DEFAULT 'user' CHECK (owner_kind IN ('user', 'staff'));

-- ---------------------------------------------------------------- who drives what
CREATE TABLE vehicle_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        uuid NOT NULL REFERENCES users(id),
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  fleet_vehicle_id uuid REFERENCES fleet_vehicles(id),
  owner_id         uuid REFERENCES vehicle_owners(id),          -- empty when the driver owns the car
  -- share of the driver's earnings that goes to the owner, in basis points (2000 = 20%)
  deduction_bps    integer NOT NULL DEFAULT 0 CHECK (deduction_bps BETWEEN 0 AND 9000),
  -- deductions stop once this much has been paid (the price of the vehicle); empty means they carry on
  target_kobo      bigint CHECK (target_kobo IS NULL OR target_kobo > 0),
  -- who chose the percentage. When it is the owner, the driver cannot change it.
  deduction_set_by text NOT NULL DEFAULT 'driver' CHECK (deduction_set_by IN ('driver', 'owner')),
  assigned_by      uuid,
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  ended_reason     text,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (deduction_bps = 0 OR owner_id IS NOT NULL)
);
-- a driver drives one vehicle at a time
CREATE UNIQUE INDEX vehicle_assignments_one_live_per_driver ON vehicle_assignments (driver_id) WHERE ended_at IS NULL;
CREATE INDEX vehicle_assignments_vehicle ON vehicle_assignments (vehicle_id, started_at DESC);
CREATE INDEX vehicle_assignments_owner ON vehicle_assignments (owner_id) WHERE ended_at IS NULL;

-- A vehicle is with one driver at a time. (Sharing one vehicle between drivers is not supported yet: the vehicle record has a
-- single driver. If it is ever wanted, this is the rule to relax, together with that record.)
CREATE FUNCTION enforce_single_driver() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ended_at IS NULL AND EXISTS (
    SELECT 1 FROM vehicle_assignments a WHERE a.vehicle_id = NEW.vehicle_id AND a.ended_at IS NULL AND a.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'vehicle % is already with another driver', NEW.vehicle_id USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_assignments_single_driver BEFORE INSERT OR UPDATE ON vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_single_driver();

-- The record of an assignment is kept for good: only its end can be written, never its terms or its history deleted.
CREATE FUNCTION protect_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'assignments are history and cannot be deleted'; END IF;
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'assignment % has ended and cannot change', OLD.id; END IF;
  IF NEW.driver_id <> OLD.driver_id OR NEW.vehicle_id <> OLD.vehicle_id OR NEW.started_at <> OLD.started_at OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'who drives what cannot be rewritten; end the assignment and make a new one';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_assignments_history BEFORE UPDATE OR DELETE ON vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_assignment_history();

-- ---------------------------------------------------------------- what was taken
-- One row per trip that had a deduction. The money itself is in the ledger; this says why, and how much is left to pay.
CREATE TABLE vehicle_deductions (
  id                 bigserial PRIMARY KEY,
  ride_id            uuid NOT NULL UNIQUE REFERENCES rides(id),
  assignment_id      uuid NOT NULL REFERENCES vehicle_assignments(id),
  owner_id           uuid NOT NULL REFERENCES vehicle_owners(id),
  driver_id          uuid NOT NULL REFERENCES users(id),
  bps                integer NOT NULL,
  driver_share_kobo  bigint NOT NULL,       -- what the driver earned from the trip before the deduction
  amount_kobo        bigint NOT NULL CHECK (amount_kobo > 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_deductions_driver ON vehicle_deductions (driver_id, created_at DESC);
CREATE INDEX vehicle_deductions_assignment ON vehicle_deductions (assignment_id);
CREATE TRIGGER vehicle_deductions_append_only BEFORE UPDATE OR DELETE ON vehicle_deductions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- applications
ALTER TABLE driver_applications ADD COLUMN deduction_bps integer CHECK (deduction_bps IS NULL OR deduction_bps BETWEEN 100 AND 9000);

-- A driver who borrows a car from someone else says what share of their earnings goes toward it.
-- A new way to get a vehicle: a business supplies it and sets the terms. The earlier "platform plan" stays for old records.
INSERT INTO vehicle_arrangements (code, name, description, needs_vehicle_details, needs_owner_details, needs_plan, sort_order) VALUES
  ('business_vehicle', 'Drive a business''s vehicle', 'A business gives you a vehicle and takes an agreed share of your earnings toward it.', false, false, false, 2);
UPDATE vehicle_arrangements SET active = false WHERE code = 'platform_plan';
UPDATE vehicle_arrangements SET name = 'I drive someone else''s car', description = 'The car belongs to a person. You choose the share of your earnings that goes toward it.' WHERE code = 'third_party';
