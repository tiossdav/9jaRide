-- Cards in the "For you" strip on the rider home screen. Staff change the words and the Invite & Earn amount without a new app.
CREATE TABLE home_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('invite', 'announcement', 'safety', 'promo', 'feature')),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  amount_kobo bigint CHECK (amount_kobo IS NULL OR amount_kobo >= 0),   -- the reward on an invite card
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO home_cards (kind, title, body, amount_kobo, sort_order) VALUES
  ('invite', 'Invite & Earn {amount}', 'Invite your friends to 9jaRide and earn rewards when they complete their first eligible ride.', 100000, 10),
  ('announcement', 'Welcome to 9jaRide', 'Safe, fairly priced rides across Lagos. Book now or schedule ahead.', NULL, 20),
  ('safety', 'Check before you ride', 'Verify your driver''s name, photo and vehicle plate before you get in.', NULL, 30),
  ('safety', 'Share your trip', 'Let someone you trust know where you are going, and keep the SOS button within reach.', NULL, 40),
  ('feature', 'Schedule ahead', 'Book a ride for later, or set it to repeat every week.', NULL, 50);
