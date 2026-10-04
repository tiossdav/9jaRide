-- How a driver gets the car they drive. Chosen at sign-up, so the rest of onboarding (what to ask, what to check,
-- what to set up when approved) follows from it. A lookup table, not a CHECK, so operations can add an arrangement
-- later (for example a fleet-partner lease) without a migration.
CREATE TABLE vehicle_arrangements (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  -- what the driver must give when applying
  needs_vehicle_details boolean NOT NULL,   -- plate, make, colour (otherwise the platform assigns the car)
  needs_owner_details   boolean NOT NULL,   -- name and phone of the person who owns the car
  -- what staff must set up before approving
  needs_plan            boolean NOT NULL,   -- a payment plan for a platform vehicle
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);
INSERT INTO vehicle_arrangements (code, name, description, needs_vehicle_details, needs_owner_details, needs_plan, sort_order) VALUES
  ('own',           'I own my vehicle',            'You drive your own car.',                                                     true,  false, false, 1),
  ('platform_plan', 'Get a vehicle through 9jaRide', 'We assign you a car and you pay for it in instalments from what you earn.', false, false, true,  2),
  ('third_party',   'I drive someone else''s car', 'The car belongs to a person or company that lets you drive it.',               true,  true,  false, 3);

ALTER TABLE driver_applications
  ADD COLUMN arrangement text NOT NULL DEFAULT 'own' REFERENCES vehicle_arrangements(code),
  ADD COLUMN owner_name  text,
  ADD COLUMN owner_phone text,
  ALTER COLUMN vehicle_make   DROP NOT NULL,
  ALTER COLUMN vehicle_colour DROP NOT NULL,
  ALTER COLUMN vehicle_plate  DROP NOT NULL;
ALTER TABLE application_documents DROP CONSTRAINT IF EXISTS application_documents_kind_check;
ALTER TABLE application_documents ADD CONSTRAINT application_documents_kind_check
  CHECK (kind IN ('drivers_licence', 'vehicle_papers', 'insurance', 'road_worthiness', 'selfie', 'owner_consent'));

-- Who owns each vehicle on the road.
ALTER TABLE vehicles
  ADD COLUMN arrangement text NOT NULL DEFAULT 'own' REFERENCES vehicle_arrangements(code),
  ADD COLUMN owner_name  text,
  ADD COLUMN owner_phone text;

-- ---------------------------------------------------------------- vehicle payment plans
-- A platform vehicle sold to a driver in instalments. One row per agreement; the money itself is in the payments table
-- below, so "paid so far" and "still owed" are always worked out from the record and can never drift from it.
CREATE TABLE vehicle_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        uuid NOT NULL REFERENCES users(id),
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  total_kobo       bigint NOT NULL CHECK (total_kobo > 0),          -- the full price the driver agreed to pay
  deposit_kobo     bigint NOT NULL DEFAULT 0 CHECK (deposit_kobo >= 0 AND deposit_kobo <= total_kobo),
  instalment_kobo  bigint NOT NULL CHECK (instalment_kobo > 0),
  frequency        text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  starts_on        date NOT NULL,
  -- how instalments are collected. 'manual' = staff record what the driver paid; 'earnings' is for taking them from
  -- trip earnings automatically, which is not built yet but fits here without changing the table.
  collection       text NOT NULL DEFAULT 'manual' CHECK (collection IN ('manual', 'earnings')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'defaulted', 'cancelled')),
  notes            text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- a car is on one live plan at a time, and a driver has one live plan at a time
CREATE UNIQUE INDEX vehicle_plans_one_live_per_vehicle ON vehicle_plans (vehicle_id) WHERE status IN ('active', 'defaulted');
CREATE UNIQUE INDEX vehicle_plans_one_live_per_driver  ON vehicle_plans (driver_id)  WHERE status IN ('active', 'defaulted');
CREATE INDEX vehicle_plans_status ON vehicle_plans (status, starts_on);

-- Append-only. A wrong entry is fixed by a 'reversal' row, never by editing or deleting.
CREATE TABLE vehicle_plan_payments (
  id           bigserial PRIMARY KEY,
  plan_id      uuid NOT NULL REFERENCES vehicle_plans(id),
  kind         text NOT NULL CHECK (kind IN ('deposit', 'instalment', 'reversal')),
  amount_kobo  bigint NOT NULL CHECK (amount_kobo > 0),            -- a reversal is stored positive and subtracts
  method       text NOT NULL CHECK (method IN ('cash', 'transfer', 'earnings', 'other')),
  reference    text,
  note         text,
  paid_on      date NOT NULL DEFAULT current_date,
  recorded_by  uuid,
  -- room for the day instalments are posted to the ledger; nothing writes to it yet
  ledger_transaction_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_plan_payments_plan ON vehicle_plan_payments (plan_id, id);
CREATE TRIGGER vehicle_plan_payments_append_only BEFORE UPDATE OR DELETE ON vehicle_plan_payments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- a reference (bank transfer id, receipt number) can be entered once per plan, so a double submit cannot record twice
CREATE UNIQUE INDEX vehicle_plan_payments_reference ON vehicle_plan_payments (plan_id, reference) WHERE reference IS NOT NULL;
