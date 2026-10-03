-- Promo codes. Rules are data an admin edits: the kind of discount, the limits, who it applies to, and when.
CREATE TABLE promo_codes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{3,20}$'),
  description        text NOT NULL DEFAULT '',
  kind               text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- percent: basis points (1000 = 10%). fixed: kobo off the fare.
  value              bigint NOT NULL CHECK (value > 0),
  max_discount_kobo  bigint CHECK (max_discount_kobo > 0),
  min_fare_kobo      bigint NOT NULL DEFAULT 0 CHECK (min_fare_kobo >= 0),
  categories         text[],                       -- null: every category
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  max_uses           integer CHECK (max_uses > 0), -- null: unlimited
  per_rider_limit    integer NOT NULL DEFAULT 1 CHECK (per_rider_limit > 0),
  active             boolean NOT NULL DEFAULT true,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 10000),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE rides
  ADD COLUMN promo_code_id uuid REFERENCES promo_codes(id),
  ADD COLUMN promo_discount_kobo bigint CHECK (promo_discount_kobo >= 0);
CREATE INDEX rides_promo ON rides (promo_code_id) WHERE promo_code_id IS NOT NULL;

-- Where the money for discounts comes from: the platform pays them, never the driver.
INSERT INTO ledger_accounts (code, kind, allow_negative) VALUES ('platform:promo', 'bonus', true) ON CONFLICT (code) DO NOTHING;
