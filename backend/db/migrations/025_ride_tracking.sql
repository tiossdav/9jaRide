-- Distance the driver really travelled, from the sequence of GPS readings, kept apart for the two parts of a booking:
-- getting to the pickup, and the trip with the rider. The trip distance is the ride's official tracked distance.
CREATE TABLE ride_tracking (
  ride_id         uuid PRIMARY KEY REFERENCES rides(id),
  pickup_leg_m    integer NOT NULL DEFAULT 0 CHECK (pickup_leg_m >= 0),
  trip_m          integer NOT NULL DEFAULT 0 CHECK (trip_m >= 0),
  pickup_anchor   jsonb,           -- last reading kept on the way to the pickup
  trip_anchor     jsonb,           -- last reading kept on the trip
  pickup_jumps    smallint NOT NULL DEFAULT 0,
  trip_jumps      smallint NOT NULL DEFAULT 0,
  accepted_points integer NOT NULL DEFAULT 0,
  ignored_points  integer NOT NULL DEFAULT 0,
  finished_at     timestamptz,     -- set when the trip is completed; the distances are final from then on
  updated_at      timestamptz NOT NULL DEFAULT now()
);
