-- A rider and their driver can write to each other while a trip is on. Messages are never edited or deleted (staff can read them
-- when a trip is disputed). `client_id` is made by the phone for each message, so sending the same one twice (a retry after a
-- dropped connection) stores it once.
CREATE TABLE ride_messages (
  id         bigserial PRIMARY KEY,
  ride_id    uuid NOT NULL REFERENCES rides(id),
  sender_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  client_id  text CHECK (client_id IS NULL OR length(client_id) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_messages_ride ON ride_messages (ride_id, id);
CREATE UNIQUE INDEX ride_messages_once ON ride_messages (ride_id, sender_id, client_id) WHERE client_id IS NOT NULL;
CREATE TRIGGER ride_messages_append_only BEFORE UPDATE OR DELETE ON ride_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- How far each person has read, so the other side's new messages can be counted as unread.
CREATE TABLE ride_chat_reads (
  ride_id      uuid NOT NULL REFERENCES rides(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (ride_id, user_id)
);
