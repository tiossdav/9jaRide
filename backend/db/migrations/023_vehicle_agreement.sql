-- A driver who pays toward a vehicle someone else owns has to agree to it before they can go online or have anything taken
-- from their earnings. Vehicles the driver owns have nothing to agree to.
ALTER TABLE vehicle_assignments
  ADD COLUMN agreement_accepted_at timestamptz,
  ADD COLUMN agreed_bps integer;       -- the share the driver saw and agreed to
-- arrangements that were already running count as agreed (the history guard is paused for this one correction, including ended ones)
ALTER TABLE vehicle_assignments DISABLE TRIGGER vehicle_assignments_history;
UPDATE vehicle_assignments SET agreement_accepted_at = started_at, agreed_bps = deduction_bps;
ALTER TABLE vehicle_assignments ENABLE TRIGGER vehicle_assignments_history;
