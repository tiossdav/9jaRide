-- Scheduled and weekly rides, rider cancellation, driver trip trails, remote app config.

-- ---------------------------------------------------------------- scheduled and weekly rides
-- A booking is a series (one ride, or one ride a week for N weeks). Every occurrence is a real ride row in status
-- SCHEDULED. It is priced and the wallet money is held only when dispatch starts for it, not when it is booked.
CREATE TABLE ride_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id         uuid NOT NULL REFERENCES users(id),
  category         text NOT NULL CHECK (category IN ('regular', 'comfort', 'package')),
  payment_method   text NOT NULL CHECK (payment_method IN ('cash', 'wallet')),
  pickup           geography(Point, 4326) NOT NULL,
  dropoff          geography(Point, 4326) NOT NULL,
  est_distance_m   integer NOT NULL CHECK (est_distance_m > 0),
  est_duration_s   integer NOT NULL CHECK (est_duration_s >= 0),
  first_pickup_at  timestamptz NOT NULL,
  repeat           text NOT NULL CHECK (repeat IN ('none', 'weekly')),
  occurrences      integer NOT NULL CHECK (occurrences BETWEEN 1 AND 52),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  idempotency_key  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rider_id, idempotency_key),
  CHECK ((repeat = 'none') = (occurrences = 1))
);

ALTER TABLE rides
  ADD COLUMN scheduled_for         timestamptz,
  ADD COLUMN schedule_id           uuid REFERENCES ride_schedules(id),
  ADD COLUMN est_distance_m        integer,
  ADD COLUMN est_duration_s        integer,
  ADD COLUMN search_window_seconds integer CHECK (search_window_seconds > 0),  -- null = the global default
  ADD COLUMN cancel_reason         text,
  ADD CONSTRAINT rides_scheduled_has_time CHECK (status <> 'SCHEDULED' OR scheduled_for IS NOT NULL);
CREATE INDEX rides_scheduled_due ON rides (scheduled_for) WHERE status = 'SCHEDULED';
CREATE INDEX rides_schedule ON rides (schedule_id) WHERE schedule_id IS NOT NULL;

-- ---------------------------------------------------------------- driver trip trail
-- Location points kept only while a driver is on a trip. Used to check the distance the driver reports at the end.
-- Idempotent on (driver, recorded time) so an offline batch that is uploaded twice stores once.
CREATE TABLE driver_location_points (
  driver_id    uuid NOT NULL REFERENCES users(id),
  recorded_at  timestamptz NOT NULL,
  location     geography(Point, 4326) NOT NULL,
  accuracy_m   real,
  speed_kmh    real,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, recorded_at)
);
CREATE INDEX driver_location_points_received ON driver_location_points (received_at);  -- for retention deletes

-- One row per completed ride: what the driver said against what the trail shows.
CREATE TABLE trip_distance_checks (
  ride_id      uuid PRIMARY KEY REFERENCES rides(id),
  claimed_m    integer NOT NULL,
  trail_m      integer,
  trail_points integer NOT NULL,
  flagged      boolean NOT NULL,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_distance_checks_open ON trip_distance_checks (created_at) WHERE flagged AND reviewed_at IS NULL;

-- ---------------------------------------------------------------- remote app config
CREATE TABLE app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
