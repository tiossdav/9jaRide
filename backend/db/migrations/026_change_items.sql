-- When staff ask a driver to fix something, they say which parts: the driver then updates only those and the rest stays as entered.
-- Values: about_you, next_of_kin, vehicle, or the kind of a document (selfie is the driver photo).
ALTER TABLE driver_applications ADD COLUMN change_items text[] NOT NULL DEFAULT '{}';
