-- Fuller driver onboarding: personal details, next of kin, uploaded proof documents, and the admin's confirmation of the
-- vehicle category after inspection.

-- ---------------------------------------------------------------- uploaded files
-- The bytes live in file storage (a folder today, a bucket later); this table says who owns each file and what it is.
-- Append-only: a replaced document is a new file, the old one stays for the record.
CREATE TABLE uploaded_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id),
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uploaded_files_owner ON uploaded_files (owner_id, created_at DESC);
CREATE TRIGGER uploaded_files_append_only BEFORE UPDATE OR DELETE ON uploaded_files
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------- the application
ALTER TABLE driver_applications
  ADD COLUMN email              text,
  ADD COLUMN contact_preference text CHECK (contact_preference IN ('whatsapp', 'email')),
  ADD COLUMN date_of_birth      date,
  ADD COLUMN nin                text,
  ADD COLUMN lassdri_number     text,
  ADD COLUMN address            text,
  ADD COLUMN next_of_kin_name         text,
  ADD COLUMN next_of_kin_phone        text,
  ADD COLUMN next_of_kin_relationship text,
  ADD COLUMN next_of_kin_address      text,
  -- the category the admin confirmed after looking at the vehicle; vehicle_category stays what the driver asked for
  ADD COLUMN approved_category      text REFERENCES asset_types(code),
  ADD COLUMN category_confirmed_by  uuid,
  ADD COLUMN category_confirmed_at  timestamptz;

-- A driver may ask for Regular or Comfort. Package delivery is not something a driver picks for themselves.
ALTER TABLE driver_applications ADD CONSTRAINT driver_applications_requested_category CHECK (vehicle_category IN ('regular', 'comfort'));

ALTER TABLE application_documents
  ADD COLUMN number  text,                                     -- licence number, NIN, policy number...
  ADD COLUMN file_id uuid REFERENCES uploaded_files(id);       -- the photo or scan that proves it
ALTER TABLE application_documents DROP CONSTRAINT IF EXISTS application_documents_kind_check;
ALTER TABLE application_documents ADD CONSTRAINT application_documents_kind_check
  CHECK (kind IN ('drivers_licence', 'nin', 'lassdri', 'vehicle_papers', 'insurance', 'inspection_certificate', 'vehicle_photo', 'road_worthiness', 'selfie', 'owner_consent'));

-- ---------------------------------------------------------------- the rule, enforced by the database
-- Whatever code writes to the table, an application cannot reach SUBMITTED without the personal details staff need, and
-- cannot be APPROVED unless a person confirmed the vehicle category and it is one of the active categories.
CREATE FUNCTION enforce_application_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'SUBMITTED' THEN
    IF coalesce(NEW.email, '') = '' OR coalesce(NEW.nin, '') = '' OR coalesce(NEW.address, '') = ''
       OR coalesce(NEW.next_of_kin_name, '') = '' OR coalesce(NEW.next_of_kin_phone, '') = '' OR coalesce(NEW.next_of_kin_address, '') = ''
       OR NEW.contact_preference IS NULL THEN
      RAISE EXCEPTION 'application % is missing personal details (email, NIN, address, next of kin, how to reach you)', NEW.id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'APPROVED' THEN
    IF NEW.approved_category IS NULL OR NEW.category_confirmed_by IS NULL OR NEW.category_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'application % cannot be approved before an admin confirms the vehicle category', NEW.id USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM asset_types WHERE code = NEW.approved_category AND active) THEN
      RAISE EXCEPTION 'category % is not active', NEW.approved_category USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_applications_rules BEFORE INSERT OR UPDATE ON driver_applications
  FOR EACH ROW EXECUTE FUNCTION enforce_application_rules();

-- A driver's vehicle must carry the category an admin approved, never one the driver picked alone: a vehicle made from an
-- application has to match that application's approved category.
-- (Vehicles an admin adds directly are not linked to an application and are unaffected.)
ALTER TABLE vehicles ADD COLUMN application_id uuid REFERENCES driver_applications(id);
CREATE FUNCTION enforce_vehicle_category() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved text;
BEGIN
  IF NEW.application_id IS NOT NULL THEN
    SELECT approved_category INTO approved FROM driver_applications WHERE id = NEW.application_id AND status = 'APPROVED';
    IF approved IS NULL OR approved <> NEW.category THEN
      RAISE EXCEPTION 'vehicle category must match the category an admin approved for the application' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicles_category_rule BEFORE INSERT ON vehicles
  FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_category();
