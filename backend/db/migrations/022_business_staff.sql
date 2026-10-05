-- A business can sign in to the admin portal and manage only its own vehicles.
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_role_check;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check CHECK (role IN ('support', 'finance', 'admin', 'business'));
ALTER TABLE staff_users ADD COLUMN business_id uuid REFERENCES businesses(id);
ALTER TABLE staff_users ADD CONSTRAINT staff_users_business_scope CHECK ((role = 'business') = (business_id IS NOT NULL));
