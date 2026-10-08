-- One driver per NIN, LASDRI number and driver's licence number, enforced by the database so two sign-ups at the same moment cannot
-- both win. Values are stored normalised (capitals, no spaces, hyphens or slashes; a NIN is digits only). A driver holds one value of each
-- kind at a time and can change it; another driver cannot take what is held.
CREATE TABLE driver_identifiers (
  kind       text NOT NULL CHECK (kind IN ('nin', 'lassdri', 'drivers_licence')),
  value      text NOT NULL CHECK (value <> ''),
  driver_id  uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value),
  UNIQUE (kind, driver_id)
);

-- What is already on file. If old data holds the same number for two drivers, the earliest application keeps it and the later one is
-- left out: staff can see it and the later driver is asked for the right number when they next change their application.
INSERT INTO driver_identifiers (kind, value, driver_id, created_at)
SELECT DISTINCT ON (kind, value) kind, value, driver_id, created_at FROM (
  SELECT 'nin' AS kind, regexp_replace(nin, '\D', '', 'g') AS value, driver_id, created_at FROM driver_applications WHERE coalesce(nin, '') <> ''
  UNION ALL
  SELECT 'lassdri', upper(regexp_replace(lassdri_number, '[\s\-/.]', '', 'g')), driver_id, created_at FROM driver_applications WHERE coalesce(lassdri_number, '') <> ''
  UNION ALL
  SELECT 'drivers_licence', upper(regexp_replace(d.number, '[\s\-/.]', '', 'g')), a.driver_id, a.created_at
    FROM application_documents d JOIN driver_applications a ON a.id = d.application_id WHERE d.kind = 'drivers_licence' AND coalesce(d.number, '') <> ''
) found WHERE value <> ''
ORDER BY kind, value, created_at
ON CONFLICT DO NOTHING;

-- A number plate is three letters, three digits, then two letters (ABC-123XY), stored without the hyphen. Rows written before this rule
-- are left as they are (NOT VALID); every new or changed row has to follow it.
ALTER TABLE vehicles ADD CONSTRAINT vehicles_plate_format CHECK (plate ~ '^[A-Z]{3}[0-9]{3}[A-Z]{2}$') NOT VALID;
ALTER TABLE fleet_vehicles ADD CONSTRAINT fleet_vehicles_plate_format CHECK (plate ~ '^[A-Z]{3}[0-9]{3}[A-Z]{2}$') NOT VALID;
