-- 1. The active trip status is "In Transit" (it was TRIP_STARTED).
ALTER TABLE rides DROP CONSTRAINT rides_status_check;
UPDATE rides SET status = 'IN_TRANSIT' WHERE status = 'TRIP_STARTED';
UPDATE ride_status_history SET to_status = 'IN_TRANSIT' WHERE to_status = 'TRIP_STARTED';
UPDATE ride_status_history SET from_status = 'IN_TRANSIT' WHERE from_status = 'TRIP_STARTED';
ALTER TABLE rides ADD CONSTRAINT rides_status_check CHECK (status IN (
  'SCHEDULED', 'REQUESTED', 'SEARCHING_DRIVER', 'NO_DRIVER_FOUND',
  'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_TRANSIT', 'TRIP_COMPLETED',
  'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM'));
DROP INDEX rides_one_active_per_driver;
CREATE UNIQUE INDEX rides_one_active_per_driver ON rides (driver_id)
  WHERE driver_id IS NOT NULL AND status IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_TRANSIT');

-- A history row that keeps the same status (a note on the trip, such as a changed drop-off) is not a status change to announce.
CREATE OR REPLACE FUNCTION announce_ride_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.from_status IS DISTINCT FROM NEW.to_status THEN
    PERFORM pg_notify('ride_status', NEW.ride_id::text || ':' || NEW.to_status);
  END IF;
  RETURN NEW;
END $$;

-- 2. Changing the drop-off during a trip replaces "trip extensions". The rider edits the destination once the driver has arrived;
-- the trip stays the same trip. Each change is kept: where the driver was when it happened (the new start of the route), the old and new
-- drop-off, the distance and time still to go, and what the change does to the expected fare (it can go down as well as up).
DROP TABLE ride_extensions;
CREATE TABLE ride_destination_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             uuid NOT NULL REFERENCES rides(id),
  changed_by          uuid NOT NULL REFERENCES users(id),
  from_point          geography(Point, 4326) NOT NULL,
  old_dropoff         geography(Point, 4326) NOT NULL,
  old_address         text,
  new_dropoff         geography(Point, 4326) NOT NULL,
  new_address         text,
  remaining_distance_m integer NOT NULL CHECK (remaining_distance_m >= 0),
  remaining_duration_s integer NOT NULL CHECK (remaining_duration_s >= 0),
  route_source        text NOT NULL CHECK (route_source IN ('google', 'estimate')),
  delta_expected_kobo bigint NOT NULL,
  delta_low_kobo      bigint NOT NULL,
  delta_high_kobo     bigint NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_destination_changes_ride ON ride_destination_changes (ride_id, created_at DESC);

-- 3. Nigeria-wide by default. The service-area rule stays (an admin can propose a narrower area later, and a different admin approves it),
-- but it no longer starts with Lagos alone: one wide area covering the whole country.
INSERT INTO setting_versions (key, value, effective_from, created_by, approved_by, approved_at) VALUES
  ('service_area',
   '{"enabled": true, "areas": [{"name": "Nigeria", "lat": 9.082, "lng": 8.6753, "radiusKm": 800}]}',
   now(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());
