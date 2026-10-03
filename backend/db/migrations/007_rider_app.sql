-- What the rider app needs: street addresses on rides, ratings.

-- The apps show addresses, not coordinates. They are typed text from the rider's search, kept as given.
ALTER TABLE rides          ADD COLUMN pickup_address text, ADD COLUMN dropoff_address text;
ALTER TABLE ride_schedules ADD COLUMN pickup_address text, ADD COLUMN dropoff_address text;

-- A rider rates the driver once, after the trip.
CREATE TABLE ride_ratings (
  ride_id    uuid PRIMARY KEY REFERENCES rides(id),
  rater_id   uuid NOT NULL REFERENCES users(id),
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags       text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ride_ratings_append_only BEFORE UPDATE OR DELETE ON ride_ratings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
