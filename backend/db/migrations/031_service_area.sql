-- Where drivers work, as a rule an admin can change (propose, then a different admin approves) like the others: a booking has to
-- start inside one of the areas and only drivers inside one are available. Where a trip ends does not matter. Lagos to begin with.
ALTER TABLE setting_versions DROP CONSTRAINT setting_versions_key_check;
ALTER TABLE setting_versions ADD CONSTRAINT setting_versions_key_check CHECK (key IN ('revenue', 'cancellation', 'service_area'));
INSERT INTO setting_versions (key, value, effective_from, created_by, approved_by, approved_at) VALUES
  ('service_area',
   '{"enabled": true, "areas": [{"name": "Lagos", "lat": 6.5244, "lng": 3.3792, "radiusKm": 45}]}',
   '1970-01-01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());
