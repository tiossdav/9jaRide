-- During a trip either side can propose going on past the destination. The other side sees the extra distance and fare and says yes
-- or no. Nothing about the ride or the money changes until it is accepted, and a "no" leaves the original trip exactly as it was.
-- Rows are kept as the record of what was asked, by whom, at what price, and what the answer was.
CREATE TABLE ride_extensions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             uuid NOT NULL REFERENCES rides(id),
  requested_by        text NOT NULL CHECK (requested_by IN ('rider', 'driver')),
  requester_id        uuid NOT NULL REFERENCES users(id),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
  old_dropoff         geography(Point, 4326) NOT NULL,
  old_address         text,
  new_dropoff         geography(Point, 4326) NOT NULL,
  new_address         text,
  extra_distance_m    integer NOT NULL CHECK (extra_distance_m > 0),
  extra_duration_s    integer NOT NULL CHECK (extra_duration_s >= 0),
  extra_expected_kobo bigint NOT NULL CHECK (extra_expected_kobo >= 0),
  extra_low_kobo      bigint NOT NULL CHECK (extra_low_kobo >= 0),
  extra_high_kobo     bigint NOT NULL CHECK (extra_high_kobo >= 0),
  decline_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  responded_at        timestamptz
);
CREATE INDEX ride_extensions_ride ON ride_extensions (ride_id, created_at DESC);
-- only one question is open at a time on a ride
CREATE UNIQUE INDEX ride_extensions_one_open ON ride_extensions (ride_id) WHERE status = 'PENDING';
