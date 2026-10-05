-- Where to send push notifications: one row per phone (Firebase registration token). A token moves to whoever signs in on that phone.
CREATE TABLE push_tokens (
  token       text PRIMARY KEY CHECK (length(token) BETWEEN 20 AND 4096),
  user_id     uuid NOT NULL REFERENCES users(id),
  app         text NOT NULL CHECK (app IN ('rider', 'driver')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user ON push_tokens (user_id);

-- Every change of a ride's status is announced, so the server can tell the rider (driver on the way, arrived, trip over...)
-- without each place that changes a status having to remember to.
CREATE FUNCTION announce_ride_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('ride_status', NEW.ride_id::text || ':' || NEW.to_status);
  RETURN NEW;
END $$;
CREATE TRIGGER ride_status_announce AFTER INSERT ON ride_status_history FOR EACH ROW EXECUTE FUNCTION announce_ride_status();
