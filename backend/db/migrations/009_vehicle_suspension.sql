-- A suspended vehicle blocks its driver from going online, because the driver is the one who operates it.
ALTER TABLE vehicles
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_reason text;

CREATE TABLE vehicle_status_events (
  id         bigserial PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  status     text NOT NULL CHECK (status IN ('active', 'suspended', 'retired')),
  reason     text NOT NULL,
  actor_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_status_events_vehicle ON vehicle_status_events (vehicle_id, id DESC);
CREATE TRIGGER vehicle_status_events_append_only BEFORE UPDATE OR DELETE ON vehicle_status_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
