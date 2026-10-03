-- Ride categories ("asset types") become data an admin can change, instead of three words fixed in the schema.
CREATE TABLE asset_types (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  label       text NOT NULL CHECK (length(label) BETWEEN 2 AND 40),
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO asset_types (code, label, sort_order) VALUES ('regular', 'Regular', 10), ('comfort', 'Comfort', 20), ('package', 'Send Package', 30);

-- Replace the fixed "regular, comfort or package" checks with a real link to the list above.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid::regclass::text IN ('vehicles', 'rides', 'pricing_versions', 'fare_quotes', 'ride_schedules', 'driver_applications')
       AND pg_get_constraintdef(c.oid) ILIKE '%regular%' AND pg_get_constraintdef(c.oid) ILIKE '%comfort%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE vehicles             ADD CONSTRAINT vehicles_category_fk             FOREIGN KEY (category)         REFERENCES asset_types(code);
ALTER TABLE rides                ADD CONSTRAINT rides_category_fk                FOREIGN KEY (category)         REFERENCES asset_types(code);
ALTER TABLE pricing_versions     ADD CONSTRAINT pricing_versions_category_fk     FOREIGN KEY (category)         REFERENCES asset_types(code);
ALTER TABLE fare_quotes          ADD CONSTRAINT fare_quotes_category_fk          FOREIGN KEY (category)         REFERENCES asset_types(code);
ALTER TABLE ride_schedules       ADD CONSTRAINT ride_schedules_category_fk       FOREIGN KEY (category)         REFERENCES asset_types(code);
ALTER TABLE driver_applications  ADD CONSTRAINT driver_applications_category_fk  FOREIGN KEY (vehicle_category) REFERENCES asset_types(code);
