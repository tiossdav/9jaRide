-- Support: problems reported from the rider and driver apps, handled by staff.
CREATE TABLE support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code      text NOT NULL UNIQUE,
  raised_by       uuid NOT NULL REFERENCES users(id),
  raised_role     text NOT NULL CHECK (raised_role IN ('rider', 'driver')),
  ride_id         uuid REFERENCES rides(id),
  topic           text NOT NULL CHECK (topic IN ('trip', 'payment', 'safety', 'account', 'app', 'other')),
  message         text NOT NULL CHECK (length(message) BETWEEN 5 AND 2000),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  assigned_to     uuid,
  resolution      text,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  UNIQUE (raised_by, idempotency_key),
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);
CREATE INDEX support_tickets_queue ON support_tickets (status, created_at);
CREATE INDEX support_tickets_user ON support_tickets (raised_by, created_at DESC);

CREATE TABLE support_notes (
  id         bigserial PRIMARY KEY,
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id),
  staff_id   uuid NOT NULL,
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_notes_ticket ON support_notes (ticket_id, id);
CREATE TRIGGER support_notes_append_only BEFORE UPDATE OR DELETE ON support_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
