-- DEV ONLY. Rates read off the admin Trip Fees screens. Not production data.
-- Two different fixed UUIDs stand in for the creating and approving staff (nobody approves their own).
-- Waiting fee and free window are not shown on any screen: set to 0 until you decide them. [WAITING RATE]
INSERT INTO pricing_versions
  (category, effective_from, base_kobo, per_km_kobo, per_minute_kobo, tax_kobo, created_by, approved_by, approved_at)
VALUES
  ('comfort', '2026-01-01T00:00:00+01', 100000, 18000, 12000, 3000,
   '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002', now()),
  ('regular', '2026-01-01T00:00:00+01', 120000, 20000, 15000, 3000,
   '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002', now())
ON CONFLICT (category, zone, effective_from) DO NOTHING;
