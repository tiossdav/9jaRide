-- The NIN is checked by a verification service instead of a photo of the card.
ALTER TABLE driver_applications
  ADD COLUMN nin_status      text NOT NULL DEFAULT 'not_checked' CHECK (nin_status IN ('not_checked', 'pending', 'verified', 'failed')),
  ADD COLUMN nin_checked_at  timestamptz,
  ADD COLUMN nin_reason      text,       -- why it failed, or who accepted it by hand
  ADD COLUMN nin_reference   text;       -- the provider's reference for the check
CREATE INDEX driver_applications_nin_pending ON driver_applications (nin_checked_at) WHERE nin_status = 'pending';
